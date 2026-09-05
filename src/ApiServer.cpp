#include "ApiServer.h"

#include <WiFi.h>
#include <stdlib.h>
#include "Logger.h"
#include "CommandCenterEndpoint.h"

namespace {
const char* cacheControlFor(const String& path) {
  if (path.endsWith(".json") ||
      path.endsWith(".ndjson")) {
    return "no-store";
  }

  if (path.endsWith(".js") ||
      path.endsWith(".css") ||
      path.endsWith(".html") ||
      path.endsWith(".map")) {
    return "no-cache";
  }

  if (path.endsWith(".png") ||
      path.endsWith(".jpg") ||
      path.endsWith(".jpeg") ||
      path.endsWith(".webp") ||
      path.endsWith(".gif") ||
      path.endsWith(".svg") ||
      path.endsWith(".ico")) {
    return "public, max-age=86400";
  }

  if (path.endsWith(".woff") ||
      path.endsWith(".woff2")) {
    return "public, max-age=31536000, immutable";
  }

  return "no-cache";
}

struct CommandCenterProbeResult {
  bool tcpConnected = false;
  bool dccExAlive = false;
  String reply;
  unsigned long elapsedMs = 0;
};

bool isValidCommandCenterHost(
    const String& host) {
  if (host.length() == 0 ||
      host.length() > 253) {
    return false;
  }

  for (size_t index = 0;
       index < host.length();
       ++index) {
    const char c = host.charAt(index);

    if (static_cast<uint8_t>(c) <= 32 ||
        c == '/' ||
        c == '\\' ||
        c == ':' ||
        c == '<' ||
        c == '>') {
      return false;
    }
  }

  return true;
}

bool readPostValue(
    AsyncWebServerRequest* request,
    const char* name,
    String& value) {
  if (!request->hasParam(
          name,
          true)) {
    return false;
  }

  value =
      request
          ->getParam(name, true)
          ->value();

  value.trim();
  return true;
}

bool parseEndpointFromRequest(
    AsyncWebServerRequest* request,
    String& host,
    uint16_t& port,
    String& error) {
  String portText;

  if (!readPostValue(
          request,
          "host",
          host) ||
      !readPostValue(
          request,
          "port",
          portText)) {
    error =
        "Missing host or port";
    return false;
  }

  if (!isValidCommandCenterHost(
          host)) {
    error =
        "Invalid host";
    return false;
  }

  char* end = nullptr;
  const long parsedPort =
      strtol(
          portText.c_str(),
          &end,
          10);

  if (end == portText.c_str() ||
      *end != '\0' ||
      parsedPort < 1 ||
      parsedPort > 65535) {
    error =
        "Port must be between 1 and 65535";
    return false;
  }

  port =
      static_cast<uint16_t>(
          parsedPort);

  return true;
}

bool parseBooleanValue(
    String value,
    bool& result) {
  value.trim();
  value.toLowerCase();

  if (value == "true" ||
      value == "1" ||
      value == "yes" ||
      value == "on") {
    result = true;
    return true;
  }

  if (value == "false" ||
      value == "0" ||
      value == "no" ||
      value == "off") {
    result = false;
    return true;
  }

  return false;
}

CommandCenterProbeResult probeDccExEndpoint(
    const String& host,
    uint16_t port) {
  CommandCenterProbeResult result;
  WiFiClient probe;

  const unsigned long started =
      millis();

  IPAddress resolved;

  if (!connectCommandCenterClient(
          probe,
          host,
          port,
          1200,
          &resolved)) {
    result.elapsedMs =
        millis() - started;
    return result;
  }

  result.tcpConnected = true;
  probe.setNoDelay(true);
  probe.print("<#>");

  bool insideFrame = false;
  String frame;
  frame.reserve(64);

  while (millis() - started < 2200) {
    while (probe.available()) {
      const char c =
          static_cast<char>(
              probe.read());

      if (!insideFrame) {
        if (c == '<') {
          insideFrame = true;
          frame = "<";
        }

        continue;
      }

      if (c == '<') {
        frame = "<";
        continue;
      }

      frame += c;

      if (c == '>') {
        insideFrame = false;
        result.reply = frame;

        if (frame.startsWith("<#")) {
          result.dccExAlive = true;
          result.elapsedMs =
              millis() - started;
          probe.stop();
          return result;
        }

        frame.clear();
      }

      if (frame.length() > 128) {
        insideFrame = false;
        frame.clear();
      }
    }

    if (!probe.connected() &&
        !probe.available()) {
      break;
    }

    delay(1);
  }

  result.elapsedMs =
      millis() - started;

  probe.stop();
  return result;
}

}

ApiServer::ApiServer(
    AsyncWebSocket& ws,
    DccExBridge& dcc,
    LayoutRuntime& runtime,
    RuntimeStateStore& stateStore,
    Preferences& prefs,
    WsProtocol& wsProtocol)
    : _ws(ws),
      _dcc(dcc),
      _runtime(runtime),
      _stateStore(stateStore),
      _prefs(prefs),
      _wsProtocol(wsProtocol) {}

void ApiServer::sendJson(
    AsyncWebServerRequest* request,
    int code,
    JsonDocument& doc) {
  String body;
  serializeJson(doc, body);

  auto* response =
      request->beginResponse(
          code,
          "application/json",
          body);

  response->addHeader(
      "Cache-Control",
      "no-store");

  request->send(response);
}

const char* ApiServer::mimeFor(
    const String& path) {
  if (path.endsWith(".html"))
    return "text/html; charset=utf-8";
  if (path.endsWith(".js"))
    return "application/javascript; charset=utf-8";
  if (path.endsWith(".css"))
    return "text/css; charset=utf-8";
  if (path.endsWith(".json"))
    return "application/json; charset=utf-8";
  if (path.endsWith(".ndjson"))
    return "application/x-ndjson; charset=utf-8";
  if (path.endsWith(".svg"))
    return "image/svg+xml";
  if (path.endsWith(".png"))
    return "image/png";
  if (path.endsWith(".jpg") ||
      path.endsWith(".jpeg"))
    return "image/jpeg";
  if (path.endsWith(".webp"))
    return "image/webp";
  if (path.endsWith(".gif"))
    return "image/gif";
  if (path.endsWith(".ico"))
    return "image/x-icon";
  if (path.endsWith(".woff"))
    return "font/woff";
  if (path.endsWith(".woff2"))
    return "font/woff2";

  return "application/octet-stream";
}

bool ApiServer::safePath(
    const String& path) {
  return path.startsWith("/") &&
         path.indexOf("..") < 0 &&
         path.indexOf('\\') < 0;
}

void ApiServer::sendFsFile(
    AsyncWebServerRequest* request,
    const String& requestedPath) {
  String path = requestedPath;

  if (path == "/")
    path = "/index.html";

  if (!safePath(path)) {
    request->send(
        400,
        "text/plain",
        "Invalid path");
    return;
  }

  const String gz = path + ".gz";

  if (LittleFS.exists(gz)) {
    auto* response =
        request->beginResponse(
            LittleFS,
            gz,
            mimeFor(path),
            false);

    response->addHeader(
        "Content-Encoding",
        "gzip");

    response->addHeader(
        "Cache-Control",
        cacheControlFor(path));

    request->send(response);
    return;
  }

  if (LittleFS.exists(path)) {
    auto* response =
        request->beginResponse(
            LittleFS,
            path,
            mimeFor(path),
            false);

    response->addHeader(
        "Cache-Control",
        cacheControlFor(path));

    request->send(response);
    return;
  }

  request->send(
      404,
      "text/plain",
      "Not found");
}

void ApiServer::handleLayoutBody(
    AsyncWebServerRequest* request,
    uint8_t* data,
    size_t len,
    size_t index,
    size_t total) {
  if (index == 0) {
    _layoutUploadExpected = total;
    _layoutUploadWritten = 0;
    _layoutUploadFailed = false;

    LittleFS.mkdir("/config");
    LittleFS.remove(
        "/config/layout.json.tmp");

    _layoutUpload =
        LittleFS.open(
            "/config/layout.json.tmp",
            "w");

    if (!_layoutUpload) {
      _layoutUploadFailed = true;
      Logger::error(
          "Cannot open layout temp file");
    }
  }

  if (!_layoutUploadFailed &&
      _layoutUpload) {
    const size_t written =
        _layoutUpload.write(
            data,
            len);

    _layoutUploadWritten += written;

    if (written != len)
      _layoutUploadFailed = true;
  }

  if (index + len != total)
    return;

  if (_layoutUpload) {
    _layoutUpload.flush();
    _layoutUpload.close();
  }

  JsonDocument response;

  if (_layoutUploadFailed ||
      _layoutUploadWritten !=
          _layoutUploadExpected) {
    LittleFS.remove(
        "/config/layout.json.tmp");

    response["ok"] = false;
    response["message"] =
        "Layout upload failed";

    sendJson(
        request,
        507,
        response);
    return;
  }

  if (!_runtime.rebuildFromLayout(
          "/config/layout.json.tmp")) {
    LittleFS.remove(
        "/config/layout.json.tmp");

    _runtime.rebuildFromLayout(
        "/config/layout.json");

    response["ok"] = false;
    response["message"] =
        "Invalid layout JSON";

    sendJson(
        request,
        400,
        response);
    return;
  }

  LittleFS.remove(
      "/config/layout.json.bak");

  if (LittleFS.exists(
          "/config/layout.json")) {
    LittleFS.rename(
        "/config/layout.json",
        "/config/layout.json.bak");
  }

  if (!LittleFS.rename(
          "/config/layout.json.tmp",
          "/config/layout.json")) {
    if (LittleFS.exists(
            "/config/layout.json.bak")) {
      LittleFS.rename(
          "/config/layout.json.bak",
          "/config/layout.json");
    }

    _runtime.rebuildFromLayout(
        "/config/layout.json");

    response["ok"] = false;
    response["message"] =
        "Layout atomic rename failed";

    sendJson(
        request,
        500,
        response);
    return;
  }

  _runtime.rebuildFromLayout(
      "/config/layout.json");

  Logger::info(
      "Layout saved: " +
      String(total) +
      " bytes; runtime " +
      String(_runtime.accessoryCount()) +
      " accessories / " +
      String(_runtime.sensorCount()) +
      " sensors");

  response["ok"] = true;
  response["bytes"] = total;
  response["accessories"] =
      _runtime.accessoryCount();
  response["sensors"] =
      _runtime.sensorCount();

  sendJson(
      request,
      200,
      response);

  _wsProtocol.broadcastRuntimeSnapshot();
}

void ApiServer::handleLocosBody(
    AsyncWebServerRequest* request,
    uint8_t* data,
    size_t len,
    size_t index,
    size_t total) {
  if (index == 0) {
    _locosUploadExpected = total;
    _locosUploadWritten = 0;
    _locosUploadFailed = false;

    LittleFS.mkdir("/config");
    LittleFS.remove(
        "/config/locos.json.tmp");

    _locosUpload =
        LittleFS.open(
            "/config/locos.json.tmp",
            "w");

    if (!_locosUpload) {
      _locosUploadFailed = true;
      Logger::error(
          "Cannot open locos temp file");
    }
  }

  if (!_locosUploadFailed &&
      _locosUpload) {
    const size_t written =
        _locosUpload.write(
            data,
            len);

    _locosUploadWritten += written;

    if (written != len)
      _locosUploadFailed = true;
  }

  if (index + len != total)
    return;

  if (_locosUpload) {
    _locosUpload.flush();
    _locosUpload.close();
  }

  JsonDocument response;

  if (_locosUploadFailed ||
      _locosUploadWritten !=
          _locosUploadExpected) {
    LittleFS.remove(
        "/config/locos.json.tmp");

    response["ok"] = false;
    response["message"] =
        "Locomotive upload failed";

    sendJson(
        request,
        507,
        response);
    return;
  }

  File verify =
      LittleFS.open(
          "/config/locos.json.tmp",
          "r");

  if (!verify) {
    LittleFS.remove(
        "/config/locos.json.tmp");

    response["ok"] = false;
    response["message"] =
        "Cannot verify locomotive file";

    sendJson(
        request,
        500,
        response);
    return;
  }

  JsonDocument check;
  const DeserializationError error =
      deserializeJson(
          check,
          verify);

  verify.close();

  if (error ||
      !check.is<JsonArray>()) {
    LittleFS.remove(
        "/config/locos.json.tmp");

    response["ok"] = false;
    response["message"] =
        "Expected locomotive JSON array";

    sendJson(
        request,
        400,
        response);
    return;
  }

  LittleFS.remove(
      "/config/locos.json.bak");

  if (LittleFS.exists(
          "/config/locos.json")) {
    LittleFS.rename(
        "/config/locos.json",
        "/config/locos.json.bak");
  }

  if (!LittleFS.rename(
          "/config/locos.json.tmp",
          "/config/locos.json")) {
    if (LittleFS.exists(
            "/config/locos.json.bak")) {
      LittleFS.rename(
          "/config/locos.json.bak",
          "/config/locos.json");
    }

    response["ok"] = false;
    response["message"] =
        "Locomotive atomic rename failed";

    sendJson(
        request,
        500,
        response);
    return;
  }

  Logger::info(
      "Locomotives saved: " +
      String(total) +
      " bytes");

  response["ok"] = true;
  response["bytes"] = total;

  sendJson(
      request,
      200,
      response);
}

void ApiServer::handleSignalLogicBody(
    AsyncWebServerRequest* request,
    uint8_t* data,
    size_t len,
    size_t index,
    size_t total) {
  static constexpr const char* FINAL_PATH =
      "/config/signal-logic.ndjson";
  static constexpr const char* TEMP_PATH =
      "/config/signal-logic.ndjson.tmp";
  static constexpr const char* BACKUP_PATH =
      "/config/signal-logic.ndjson.bak";

  if (index == 0) {
    _signalLogicUploadExpected = total;
    _signalLogicUploadWritten = 0;
    _signalLogicUploadFailed = false;

    LittleFS.mkdir("/config");
    LittleFS.remove(TEMP_PATH);

    _signalLogicUpload =
        LittleFS.open(
            TEMP_PATH,
            "w");

    if (!_signalLogicUpload) {
      _signalLogicUploadFailed = true;
      Logger::error(
          "Cannot open signal logic temp file");
    }
  }

  if (!_signalLogicUploadFailed &&
      _signalLogicUpload) {
    const size_t written =
        _signalLogicUpload.write(
            data,
            len);

    _signalLogicUploadWritten += written;

    if (written != len)
      _signalLogicUploadFailed = true;
  }

  if (index + len != total)
    return;

  if (_signalLogicUpload) {
    _signalLogicUpload.flush();
    _signalLogicUpload.close();
  }

  JsonDocument response;

  if (_signalLogicUploadFailed ||
      _signalLogicUploadWritten !=
          _signalLogicUploadExpected) {
    LittleFS.remove(TEMP_PATH);

    response["ok"] = false;
    response["message"] =
        "Signal automation upload failed";

    sendJson(
        request,
        507,
        response);
    return;
  }

  File verify =
      LittleFS.open(
          TEMP_PATH,
          "r");

  if (!verify) {
    LittleFS.remove(TEMP_PATH);

    response["ok"] = false;
    response["message"] =
        "Cannot verify signal automation file";

    sendJson(
        request,
        500,
        response);
    return;
  }

  bool valid = true;
  bool hasMeta = false;
  size_t rowCount = 0;

  while (verify.available()) {
    String line =
        verify.readStringUntil('\n');
    line.trim();

    if (line.length() == 0)
      continue;

    JsonDocument row;
    const DeserializationError error =
        deserializeJson(
            row,
            line);

    if (error ||
        !row.is<JsonObject>()) {
      valid = false;
      break;
    }

    ++rowCount;

    const char* kind =
        row["kind"] | "";

    if (rowCount == 1) {
      if (String(kind) != "meta") {
        valid = false;
        break;
      }

      const int version =
          row["version"] | 0;

      if (version != 1 &&
          version != 2) {
        valid = false;
        break;
      }

      hasMeta = true;
    }
  }

  verify.close();

  if (!valid ||
      !hasMeta ||
      rowCount == 0) {
    LittleFS.remove(TEMP_PATH);

    response["ok"] = false;
    response["message"] =
        "Invalid signal automation NDJSON";

    sendJson(
        request,
        400,
        response);
    return;
  }

  LittleFS.remove(BACKUP_PATH);

  if (LittleFS.exists(FINAL_PATH)) {
    LittleFS.rename(
        FINAL_PATH,
        BACKUP_PATH);
  }

  if (!LittleFS.rename(
          TEMP_PATH,
          FINAL_PATH)) {
    if (LittleFS.exists(BACKUP_PATH)) {
      LittleFS.rename(
          BACKUP_PATH,
          FINAL_PATH);
    }

    response["ok"] = false;
    response["message"] =
        "Signal automation atomic rename failed";

    sendJson(
        request,
        500,
        response);
    return;
  }

  LittleFS.remove(BACKUP_PATH);

  Logger::info(
      "Signal automation saved: " +
      String(total) +
      " bytes");

  response["ok"] = true;
  response["bytes"] = total;

  sendJson(
      request,
      200,
      response);
}

void ApiServer::setupApi() {
  DefaultHeaders::Instance().addHeader(
      "Access-Control-Allow-Origin",
      "*");

  DefaultHeaders::Instance().addHeader(
      "Access-Control-Allow-Headers",
      "Content-Type");

  _server.on(
      "/api/command-center-config",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        JsonDocument doc;
        doc["ok"] = true;
        doc["host"] = _dcc.host();
        doc["port"] = _dcc.port();
        doc["powerIncludesProgramming"] =
            _wsProtocol.powerIncludesProgramming();
        doc["connected"] =
            _dcc.connected();

        sendJson(
            request,
            200,
            doc);
      });

  _server.on(
      "/api/command-center-config",
      HTTP_POST,
      [this](
          AsyncWebServerRequest* request) {
        String host;
        uint16_t port = 0;
        String error;

        JsonDocument doc;

        if (!parseEndpointFromRequest(
                request,
                host,
                port,
                error)) {
          doc["ok"] = false;
          doc["message"] = error;

          sendJson(
              request,
              400,
              doc);
          return;
        }

        String powerText;
        bool powerIncludesProgramming =
            _wsProtocol.powerIncludesProgramming();

        if (!readPostValue(
                request,
                "powerIncludesProgramming",
                powerText) ||
            !parseBooleanValue(
                powerText,
                powerIncludesProgramming)) {
          doc["ok"] = false;
          doc["message"] =
              "Invalid powerIncludesProgramming value";

          sendJson(
              request,
              400,
              doc);
          return;
        }

        _prefs.putString(
            "csbHost",
            host);

        _prefs.putUShort(
            "csbPort",
            port);

        _prefs.putBool(
            "powerProg",
            powerIncludesProgramming);

        _wsProtocol.setPowerIncludesProgramming(
            powerIncludesProgramming);

        const bool endpointChanged =
            host != _dcc.host() ||
            port != _dcc.port();

        if (endpointChanged) {
          Logger::info(
              "EX-CSB1 endpoint changed to " +
              host +
              ":" +
              String(port));

          _dcc.setEndpoint(
              host,
              port);
        }

        _wsProtocol.broadcastRuntimeSnapshot();

        doc["ok"] = true;
        doc["host"] = _dcc.host();
        doc["port"] = _dcc.port();
        doc["powerIncludesProgramming"] =
            _wsProtocol.powerIncludesProgramming();
        doc["connected"] =
            _dcc.connected();

        sendJson(
            request,
            200,
            doc);
      });

  _server.on(
      "/api/command-center-test",
      HTTP_POST,
      [](
          AsyncWebServerRequest* request) {
        String host;
        uint16_t port = 0;
        String error;

        JsonDocument doc;

        if (!parseEndpointFromRequest(
                request,
                host,
                port,
                error)) {
          doc["ok"] = false;
          doc["message"] = error;

          sendJson(
              request,
              400,
              doc);
          return;
        }

        const CommandCenterProbeResult probe =
            probeDccExEndpoint(
                host,
                port);

        doc["ok"] =
            probe.dccExAlive;
        doc["tcpConnected"] =
            probe.tcpConnected;
        doc["dccExAlive"] =
            probe.dccExAlive;
        doc["reply"] =
            probe.reply;
        doc["elapsedMs"] =
            probe.elapsedMs;

        if (!probe.tcpConnected) {
          doc["message"] =
              "TCP connection failed";
        } else if (!probe.dccExAlive) {
          doc["message"] =
              "TCP connected, but DCC-EX did not answer <#>";
        }

        sendJson(
            request,
            probe.dccExAlive
                ? 200
                : 502,
            doc);
      });

  _server.on(
      "/api/status",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        JsonDocument doc;

        doc["ok"] = true;
        doc["wifiConnected"] =
            WiFi.status() ==
            WL_CONNECTED;
        doc["wifiSsid"] =
            WiFi.SSID();
        doc["deviceIp"] =
            WiFi.localIP().toString();
        doc["rssi"] =
            WiFi.RSSI();
        doc["csbConnected"] =
            _dcc.connected();
        doc["csbHost"] =
            _dcc.host();
        doc["csbPort"] =
            _dcc.port();
        doc["uptimeMs"] =
            millis();
        doc["freeHeapBytes"] =
            ESP.getFreeHeap();
        doc["accessories"] =
            _runtime.accessoryCount();
        doc["sensors"] =
            _runtime.sensorCount();

        sendJson(
            request,
            200,
            doc);
      });

  _server.on(
      "/api/layout",
      HTTP_GET,
      [](
          AsyncWebServerRequest* request) {
        if (!LittleFS.exists(
                "/config/layout.json")) {
          auto* response =
              request->beginResponse(
                  200,
                  "application/json",
                  "{}");
          response->addHeader(
              "Cache-Control",
              "no-store");
          request->send(response);
          return;
        }

        auto* response =
            request->beginResponse(
                LittleFS,
                "/config/layout.json",
                "application/json",
                false);

        response->addHeader(
            "Cache-Control",
            "no-store");

        request->send(response);
      });

  _server.on(
      "/api/layout",
      HTTP_POST,
      [](AsyncWebServerRequest*) {},
      nullptr,
      [this](
          AsyncWebServerRequest* request,
          uint8_t* data,
          size_t len,
          size_t index,
          size_t total) {
        handleLayoutBody(
            request,
            data,
            len,
            index,
            total);
      });

  _server.on(
      "/api/locos",
      HTTP_GET,
      [](
          AsyncWebServerRequest* request) {
        if (!LittleFS.exists(
                "/config/locos.json")) {
          auto* response =
              request->beginResponse(
                  200,
                  "application/json",
                  "[]");
          response->addHeader(
              "Cache-Control",
              "no-store");
          request->send(response);
          return;
        }

        auto* response =
            request->beginResponse(
                LittleFS,
                "/config/locos.json",
                "application/json",
                false);

        response->addHeader(
            "Cache-Control",
            "no-store");

        request->send(response);
      });

  _server.on(
      "/api/locos",
      HTTP_POST,
      [](AsyncWebServerRequest*) {},
      nullptr,
      [this](
          AsyncWebServerRequest* request,
          uint8_t* data,
          size_t len,
          size_t index,
          size_t total) {
        handleLocosBody(
            request,
            data,
            len,
            index,
            total);
      });

  _server.on(
      "/api/signal-logic",
      HTTP_GET,
      [](
          AsyncWebServerRequest* request) {
        static constexpr const char* PATH =
            "/config/signal-logic.ndjson";

        if (!LittleFS.exists(PATH)) {
          auto* response =
              request->beginResponse(
                  404,
                  "text/plain; charset=utf-8",
                  "Not found");
          response->addHeader(
              "Cache-Control",
              "no-store");
          request->send(response);
          return;
        }

        auto* response =
            request->beginResponse(
                LittleFS,
                PATH,
                "application/x-ndjson; charset=utf-8",
                false);

        response->addHeader(
            "Cache-Control",
            "no-store");

        request->send(response);
      });

  _server.on(
      "/api/signal-logic",
      HTTP_POST,
      [](AsyncWebServerRequest*) {},
      nullptr,
      [this](
          AsyncWebServerRequest* request,
          uint8_t* data,
          size_t len,
          size_t index,
          size_t total) {
        handleSignalLogicBody(
            request,
            data,
            len,
            index,
            total);
      });

  _server.on(
      "/api/files/text",
      HTTP_GET,
      [](
          AsyncWebServerRequest* request) {
        if (!request->hasParam(
                "path")) {
          request->send(
              400,
              "text/plain",
              "Missing path");
          return;
        }

        String path =
            request
                ->getParam("path")
                ->value();

        if (!safePath(path)) {
          request->send(
              400,
              "text/plain",
              "Invalid path");
          return;
        }

        if (!LittleFS.exists(path)) {
          auto* response =
              request->beginResponse(
                  200,
                  "text/plain; charset=utf-8",
                  "");
          response->addHeader(
              "Cache-Control",
              "no-store");
          request->send(response);
          return;
        }

        auto* response =
            request->beginResponse(
                LittleFS,
                path,
                "text/plain; charset=utf-8",
                false);

        response->addHeader(
            "Cache-Control",
            "no-store");

        request->send(response);
      });

  _server.on(
      "/fsinfo",
      HTTP_GET,
      [](
          AsyncWebServerRequest* request) {
        JsonDocument doc;

        doc["totalBytes"] =
            LittleFS.totalBytes();
        doc["usedBytes"] =
            LittleFS.usedBytes();
        doc["freeBytes"] =
            LittleFS.totalBytes() -
            LittleFS.usedBytes();

        sendJson(
            request,
            200,
            doc);
      });

  _server.on(
      "/list",
      HTTP_GET,
      [](
          AsyncWebServerRequest* request) {
        String path = "/";

        if (request->hasParam(
                "path")) {
          path =
              request
                  ->getParam("path")
                  ->value();
        }

        if (!safePath(path)) {
          request->send(
              400,
              "application/json",
              "{}");
          return;
        }

        File dir =
            LittleFS.open(path);

        JsonDocument doc;
        doc["path"] = path;

        JsonArray entries =
            doc["entries"]
                .to<JsonArray>();

        if (dir &&
            dir.isDirectory()) {
          File item =
              dir.openNextFile();

          while (item) {
            const String itemPath =
                String(item.name());

            String name =
                itemPath;

            const int slash =
                name.lastIndexOf('/');

            if (slash >= 0)
              name =
                  name.substring(
                      slash + 1);

            JsonObject out =
                entries
                    .add<JsonObject>();

            out["name"] =
                name;

            out["path"] =
                itemPath.startsWith("/")
                    ? itemPath
                    : (path == "/"
                           ? "/" + name
                           : path + "/" + name);

            out["type"] =
                item.isDirectory()
                    ? "directory"
                    : "file";

            out["size"] =
                item.isDirectory()
                    ? 0
                    : item.size();

            item =
                dir.openNextFile();
          }
        }

        sendJson(
            request,
            200,
            doc);
      });

  _server.on(
      "/delete",
      HTTP_DELETE,
      [](
          AsyncWebServerRequest* request) {
        if (!request->hasParam(
                "path")) {
          request->send(
              400,
              "application/json",
              "{\"ok\":false}");
          return;
        }

        const String path =
            request
                ->getParam("path")
                ->value();

        if (!safePath(path) ||
            path ==
                "/config/layout.json" ||
            path ==
                "/state/runtime-state.json") {
          request->send(
              403,
              "application/json",
              "{\"ok\":false}");
          return;
        }

        const bool ok =
            LittleFS.remove(path);

        request->send(
            ok ? 200 : 404,
            "application/json",
            ok
                ? "{\"ok\":true}"
                : "{\"ok\":false}");
      });

  _server.on(
      "/api/runtime",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        JsonDocument doc;
        doc["ok"] = true;

        JsonArray accessories =
            doc["accessories"]
                .to<JsonArray>();

        for (const auto& item :
             _runtime.accessories()) {
          JsonObject out =
              accessories
                  .add<JsonObject>();

          out["id"] =
              item.id;
          out["address"] =
              item.address;

          switch (item.kind) {
            case RuntimeAccessoryKind::Turnout:
              out["kind"] =
                  "turnout";
              out["closed"] =
                  item.closed;
              break;

            case RuntimeAccessoryKind::Signal:
              out["kind"] =
                  "signal";

              if (item.aspect >= 0)
                out["aspect"] =
                    item.aspect;
              else
                out["aspect"] =
                    nullptr;
              break;

            case RuntimeAccessoryKind::Accessory:
              out["kind"] =
                  "accessory";
              out["active"] =
                  item.active;
              break;

            case RuntimeAccessoryKind::VPin:
              out["kind"] =
                  "vpin";
              out["active"] =
                  item.active;
              break;
          }
        }

        JsonArray sensors =
            doc["sensors"]
                .to<JsonArray>();

        for (const auto& item :
             _runtime.sensors()) {
          JsonObject out =
              sensors
                  .add<JsonObject>();

          out["id"] =
              item.id;
          out["address"] =
              item.address;
          out["on"] =
              item.on;
        }

        sendJson(
            request,
            200,
            doc);
      });
}

void ApiServer::setupStaticFiles() {
  _server.on(
      "/",
      HTTP_GET,
      [](
          AsyncWebServerRequest* request) {
        sendFsFile(
            request,
            "/index.html");
      });

  _server.onNotFound(
      [](
          AsyncWebServerRequest* request) {
        if (request->url()
                .startsWith("/api/")) {
          request->send(
              404,
              "application/json",
              "{\"ok\":false,"
              "\"message\":\"API route not found\"}");
          return;
        }

        const String url =
            request->url();

        if (LittleFS.exists(url) ||
            LittleFS.exists(
                url + ".gz")) {
          sendFsFile(
              request,
              url);
          return;
        }

        sendFsFile(
            request,
            "/index.html");
      });
}

void ApiServer::begin() {
  setupApi();
  setupStaticFiles();

  _wsProtocol.begin();
  _server.addHandler(&_ws);

  _server.begin();

  Logger::info(
      "HTTP/WS server started on port 80");
}
