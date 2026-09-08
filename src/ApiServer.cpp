#include "ApiServer.h"

#include <WiFi.h>
#include <stdlib.h>

#include "CommandCenterBuild.h"
#include "CommandCenterCapabilities.h"
#include "CommandCenterEndpoint.h"
#include "Logger.h"

namespace {

const char* cacheControlFor(
    const String& path) {
  if (
      path.endsWith(".json") ||
      path.endsWith(".ndjson")
  ) {
    return "no-store";
  }

  if (
      path.endsWith(".js") ||
      path.endsWith(".css") ||
      path.endsWith(".html") ||
      path.endsWith(".map")
  ) {
    return "no-cache";
  }

  if (
      path.endsWith(".png") ||
      path.endsWith(".jpg") ||
      path.endsWith(".jpeg") ||
      path.endsWith(".webp") ||
      path.endsWith(".gif") ||
      path.endsWith(".svg") ||
      path.endsWith(".ico")
  ) {
    return
        "public, max-age=86400";
  }

  if (
      path.endsWith(".woff") ||
      path.endsWith(".woff2")
  ) {
    return
        "public, max-age=31536000, immutable";
  }

  return "no-cache";
}

bool isValidCommandCenterHost(
    const String& host) {
  if (
      host.isEmpty() ||
      host.length() > 253
  ) {
    return false;
  }

  for (
      size_t index = 0;
      index < host.length();
      ++index
  ) {
    const char c =
        host.charAt(index);

    if (
        static_cast<uint8_t>(c) <= 32 ||
        c == '/' ||
        c == '\\' ||
        c == ':' ||
        c == '<' ||
        c == '>'
    ) {
      return false;
    }
  }

  return true;
}

bool readPostValue(
    AsyncWebServerRequest* request,
    const char* name,
    String& value) {
  if (
      !request->hasParam(
          name,
          true)
  ) {
    return false;
  }

  value =
      request
          ->getParam(
              name,
              true)
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

  if (
      !readPostValue(
          request,
          "host",
          host) ||
      !readPostValue(
          request,
          "port",
          portText)
  ) {
    error =
        "Missing host or port";

    return false;
  }

  if (
      !isValidCommandCenterHost(
          host)
  ) {
    error =
        "Invalid host";

    return false;
  }

  char* end =
      nullptr;

  const long parsedPort =
      strtol(
          portText.c_str(),
          &end,
          10);

  if (
      end ==
          portText.c_str() ||
      *end != '\0' ||
      parsedPort < 1 ||
      parsedPort > 65535
  ) {
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

  if (
      value == "true" ||
      value == "1" ||
      value == "yes" ||
      value == "on"
  ) {
    result =
        true;

    return true;
  }

  if (
      value == "false" ||
      value == "0" ||
      value == "no" ||
      value == "off"
  ) {
    result =
        false;

    return true;
  }

  return false;
}

}

void ApiServer::sendJson(
    AsyncWebServerRequest* request,
    int code,
    JsonDocument& doc) {
  String body;

  serializeJson(
      doc,
      body);

  auto* response =
      request->beginResponse(
          code,
          "application/json",
          body);

  response->addHeader(
      "Cache-Control",
      "no-store");

  request->send(
      response);
}

const char* ApiServer::mimeFor(
    const String& path) {
  if (
      path.endsWith(".html")
  ) {
    return
        "text/html; charset=utf-8";
  }

  if (
      path.endsWith(".js")
  ) {
    return
        "application/javascript; charset=utf-8";
  }

  if (
      path.endsWith(".css")
  ) {
    return
        "text/css; charset=utf-8";
  }

  if (
      path.endsWith(".json")
  ) {
    return
        "application/json; charset=utf-8";
  }

  if (
      path.endsWith(".ndjson")
  ) {
    return
        "application/x-ndjson; charset=utf-8";
  }

  if (
      path.endsWith(".svg")
  ) {
    return
        "image/svg+xml";
  }

  if (
      path.endsWith(".png")
  ) {
    return
        "image/png";
  }

  if (
      path.endsWith(".jpg") ||
      path.endsWith(".jpeg")
  ) {
    return
        "image/jpeg";
  }

  if (
      path.endsWith(".webp")
  ) {
    return
        "image/webp";
  }

  if (
      path.endsWith(".gif")
  ) {
    return
        "image/gif";
  }

  if (
      path.endsWith(".ico")
  ) {
    return
        "image/x-icon";
  }

  if (
      path.endsWith(".woff")
  ) {
    return
        "font/woff";
  }

  if (
      path.endsWith(".woff2")
  ) {
    return
        "font/woff2";
  }

  return
      "application/octet-stream";
}

bool ApiServer::safePath(
    const String& path) {
  return
      path.startsWith("/") &&
      path.indexOf("..") < 0 &&
      path.indexOf('\\') < 0;
}

void ApiServer::sendFsFile(
    AsyncWebServerRequest* request,
    const String& requestedPath) {
  String path =
      requestedPath;

  if (
      path == "/"
  ) {
    path =
        "/index.html";
  }

  if (
      !safePath(
          path)
  ) {
    request->send(
        400,
        "text/plain",
        "Invalid path");

    return;
  }

  const String gz =
      path +
      ".gz";

  if (
      LittleFS.exists(
          gz)
  ) {
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
        cacheControlFor(
            path));

    request->send(
        response);

    return;
  }

  if (
      LittleFS.exists(
          path)
  ) {
    auto* response =
        request->beginResponse(
            LittleFS,
            path,
            mimeFor(path),
            false);

    response->addHeader(
        "Cache-Control",
        cacheControlFor(
            path));

    request->send(
        response);

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
  if (
      index == 0
  ) {
    _layoutUpload.begin(
        _files,
        LAYOUT_PATH,
        total);
  }

  if (
      !_layoutUpload.failed()
  ) {
    _layoutUpload.write(
        data,
        len);
  }

  if (
      index + len !=
      total
  ) {
    return;
  }

  JsonDocument response;

  if (
      !_layoutUpload.finish()
  ) {
    _layoutUpload.abort();

    response["ok"] =
        false;

    response["message"] =
        "Layout upload failed";

    sendJson(
        request,
        507,
        response);

    return;
  }

  const String tempPath =
      _layoutUpload.tempPath();

  if (
      !_runtime.rebuildFromLayout(
          tempPath.c_str())
  ) {
    _layoutUpload.abort();

    _runtime.rebuildFromLayout(
        LAYOUT_PATH);

    response["ok"] =
        false;

    response["message"] =
        "Invalid layout JSON";

    sendJson(
        request,
        400,
        response);

    return;
  }

  if (
      !_layoutUpload.commit()
  ) {
    _runtime.rebuildFromLayout(
        LAYOUT_PATH);

    response["ok"] =
        false;

    response["message"] =
        "Layout atomic rename failed";

    sendJson(
        request,
        500,
        response);

    return;
  }

  _runtime.rebuildFromLayout(
      LAYOUT_PATH);

  Logger::info(
      "Layout saved: " +
      String(total) +
      " bytes; runtime " +
      String(
          _runtime.accessoryCount()) +
      " accessories / " +
      String(
          _runtime.sensorCount()) +
      " sensors");

  response["ok"] =
      true;

  response["bytes"] =
      total;

  response["accessories"] =
      _runtime.accessoryCount();

  response["sensors"] =
      _runtime.sensorCount();

  sendJson(
      request,
      200,
      response);

  _wsProtocol
      .broadcastRuntimeSnapshot();
}

bool ApiServer::verifyLocosTemp() {
  const String tempPath =
      _locosUpload.tempPath();

  File file =
      _files.openRead(
          tempPath.c_str());

  if (!file) {
    return false;
  }

  JsonDocument document;

  const DeserializationError error =
      deserializeJson(
          document,
          file);

  file.close();

  return
      !error &&
      document.is<JsonArray>();
}

void ApiServer::handleLocosBody(
    AsyncWebServerRequest* request,
    uint8_t* data,
    size_t len,
    size_t index,
    size_t total) {
  if (
      index == 0
  ) {
    _locosUpload.begin(
        _files,
        LOCOS_PATH,
        total);
  }

  if (
      !_locosUpload.failed()
  ) {
    _locosUpload.write(
        data,
        len);
  }

  if (
      index + len !=
      total
  ) {
    return;
  }

  JsonDocument response;

  if (
      !_locosUpload.finish()
  ) {
    _locosUpload.abort();

    response["ok"] =
        false;

    response["message"] =
        "Locomotive upload failed";

    sendJson(
        request,
        507,
        response);

    return;
  }

  if (
      !verifyLocosTemp()
  ) {
    _locosUpload.abort();

    response["ok"] =
        false;

    response["message"] =
        "Expected locomotive JSON array";

    sendJson(
        request,
        400,
        response);

    return;
  }

  if (
      !_locosUpload.commit()
  ) {
    response["ok"] =
        false;

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

  response["ok"] =
      true;

  response["bytes"] =
      total;

  sendJson(
      request,
      200,
      response);
}

bool ApiServer::verifySignalLogicTemp() {
  const String tempPath =
      _signalLogicUpload.tempPath();

  // IMPORTANT: validate the uncommitted candidate with the exact same parser
  // and semantic checks used by SignalAutomationEngine::reload().
  // No invalid v1/malformed rule file can replace the last committed file.
  return
      _signalAutomation
          .validateFile(
              tempPath.c_str());
}

void ApiServer::handleSignalLogicBody(
    AsyncWebServerRequest* request,
    uint8_t* data,
    size_t len,
    size_t index,
    size_t total) {
  if (
      index == 0
  ) {
    _signalLogicUpload.begin(
        _files,
        SIGNAL_LOGIC_PATH,
        total);
  }

  if (
      !_signalLogicUpload.failed()
  ) {
    _signalLogicUpload.write(
        data,
        len);
  }

  if (
      index + len !=
      total
  ) {
    return;
  }

  JsonDocument response;

  if (
      !_signalLogicUpload.finish()
  ) {
    _signalLogicUpload.abort();

    response["ok"] =
        false;

    response["message"] =
        "Signal automation upload failed";

    sendJson(
        request,
        507,
        response);

    return;
  }

  if (
      !verifySignalLogicTemp()
  ) {
    _signalLogicUpload.abort();

    response["ok"] =
        false;

    response["message"] =
        "Invalid signal automation NDJSON v2";

    sendJson(
        request,
        400,
        response);

    return;
  }

  if (
      !_signalLogicUpload.commit()
  ) {
    response["ok"] =
        false;

    response["message"] =
        "Signal automation atomic rename failed";

    sendJson(
        request,
        500,
        response);

    return;
  }

  if (
      !_signalAutomation.reload()
  ) {
    response["ok"] =
        false;

    response["message"] =
        "Signal automation committed but runtime reload failed";

    sendJson(
        request,
        500,
        response);

    return;
  }

  _signalAutomation.evaluate();

  Logger::info(
      "Signal automation saved and reloaded: " +
      String(total) +
      " bytes");

  response["ok"] =
      true;

  response["bytes"] =
      total;

  sendJson(
      request,
      200,
      response);
}

void ApiServer::setupApi() {
  DefaultHeaders::Instance()
      .addHeader(
          "Access-Control-Allow-Origin",
          "*");

  DefaultHeaders::Instance()
      .addHeader(
          "Access-Control-Allow-Headers",
          "Content-Type");

  _server.on(
      "/api/command-center-info",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        JsonDocument doc;

        doc["ok"] =
            true;

        doc["type"] =
            CommandCenterBuild::type();

        doc["name"] =
            CommandCenterBuild::name();

        doc["defaultPort"] =
            CommandCenterBuild::defaultPort();

        doc["connected"] =
            _dcc.connected();

        JsonObject capabilities =
            doc["capabilities"]
                .to<JsonObject>();

        capabilities["trackPower"] =
            true;

        capabilities["programmingTrackPower"] =
            CommandCenterCapabilities
                ::programmingTrackPower();

        capabilities["rawCommand"] =
            CommandCenterCapabilities
                ::rawCommand();

        capabilities["vPin"] =
            CommandCenterCapabilities
                ::vPin();

        capabilities["extendedAccessory"] =
            CommandCenterCapabilities
                ::extendedAccessory();

        capabilities["currentTelemetry"] =
            CommandCenterCapabilities
                ::currentTelemetry();

        capabilities["trackConfiguration"] =
            CommandCenterCapabilities
                ::trackConfiguration();

        capabilities["locomotiveControl"] =
            CommandCenterCapabilities
                ::locomotiveControl();

        capabilities["locomotiveFunctions"] =
            CommandCenterCapabilities
                ::locomotiveFunctions();

        capabilities["turnoutControl"] =
            CommandCenterCapabilities
                ::turnoutControl();

        capabilities["basicAccessory"] =
            CommandCenterCapabilities
                ::basicAccessory();

        capabilities["signalAspect"] =
            CommandCenterCapabilities
                ::signalAspect();

        sendJson(
            request,
            200,
            doc);
      });

  _server.on(
      "/api/command-center-config",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        JsonDocument doc;

        doc["ok"] =
            true;

        doc["host"] =
            _dcc.host();

        doc["port"] =
            _dcc.port();

        doc["powerIncludesProgramming"] =
            _wsProtocol
                .powerIncludesProgramming();

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
        uint16_t port =
            0;

        String error;
        JsonDocument doc;

        if (
            !parseEndpointFromRequest(
                request,
                host,
                port,
                error)
        ) {
          doc["ok"] =
              false;

          doc["message"] =
              error;

          sendJson(
              request,
              400,
              doc);

          return;
        }

        String powerText;

        bool powerIncludesProgramming =
            _wsProtocol
                .powerIncludesProgramming();

        if (
            !readPostValue(
                request,
                "powerIncludesProgramming",
                powerText) ||
            !parseBooleanValue(
                powerText,
                powerIncludesProgramming)
        ) {
          doc["ok"] =
              false;

          doc["message"] =
              "Invalid powerIncludesProgramming value";

          sendJson(
              request,
              400,
              doc);

          return;
        }

        CommandCenterSettings settings =
            _config.commandCenter();

        settings.host =
            host;

        settings.port =
            port;

        settings.powerIncludesProgramming =
            powerIncludesProgramming;

        const bool persisted =
            _config.saveCommandCenter(
                settings);

        _wsProtocol
            .setPowerIncludesProgramming(
                powerIncludesProgramming);

        const bool endpointChanged =
            host !=
                _dcc.host() ||
            port !=
                _dcc.port();

        if (
            endpointChanged
        ) {
          Logger::info(
              "Command center endpoint changed to " +
              host +
              ":" +
              String(port));

          _dcc.setEndpoint(
              host,
              port);
        }

        _wsProtocol
            .broadcastRuntimeSnapshot();

        doc["ok"] =
            persisted;

        doc["host"] =
            _dcc.host();

        doc["port"] =
            _dcc.port();

        doc["powerIncludesProgramming"] =
            _wsProtocol
                .powerIncludesProgramming();

        doc["connected"] =
            _dcc.connected();

        if (
            !persisted
        ) {
          doc["message"] =
              "Command center settings were applied but persistence reported an error";
        }

        sendJson(
            request,
            persisted
                ? 200
                : 500,
            doc);
      });

  _server.on(
      "/api/command-center-test",
      HTTP_POST,
      [](
          AsyncWebServerRequest* request) {
        String host;
        uint16_t port =
            0;

        String error;
        JsonDocument doc;

        if (
            !parseEndpointFromRequest(
                request,
                host,
                port,
                error)
        ) {
          doc["ok"] =
              false;

          doc["message"] =
              error;

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

        if (
            !probe.tcpConnected
        ) {
          doc["message"] =
              "Command center connection failed";
        } else if (
            !probe.dccExAlive
        ) {
          doc["message"] =
              "Command center did not answer";
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

        doc["ok"] =
            true;

        doc["wifiConnected"] =
            WiFi.status() ==
            WL_CONNECTED;

        doc["wifiSsid"] =
            WiFi.SSID();

        doc["deviceIp"] =
            WiFi.localIP()
                .toString();

        doc["rssi"] =
            WiFi.RSSI();

        doc["csbConnected"] =
            _dcc.connected();

        doc["csbHost"] =
            _dcc.host();

        doc["csbPort"] =
            _dcc.port();

        doc["hubHostname"] =
            _config.network()
                .hostname;

        doc["hubHttpPort"] =
            _config.network()
                .httpPort;

        doc["hubDhcp"] =
            _config.network()
                .dhcp;

        doc["uptimeMs"] =
            millis();

        doc["freeHeapBytes"] =
            ESP.getFreeHeap();

        doc["accessories"] =
            _runtime
                .accessoryCount();

        doc["sensors"] =
            _runtime
                .sensorCount();

        sendJson(
            request,
            200,
            doc);
      });

  _server.on(
      "/api/layout",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        if (
            !_files.exists(
                LAYOUT_PATH)
        ) {
          auto* response =
              request->beginResponse(
                  200,
                  "application/json",
                  "{}");

          response->addHeader(
              "Cache-Control",
              "no-store");

          request->send(
              response);

          return;
        }

        auto* response =
            request->beginResponse(
                LittleFS,
                LAYOUT_PATH,
                "application/json",
                false);

        response->addHeader(
            "Cache-Control",
            "no-store");

        request->send(
            response);
      });

  _server.on(
      "/api/layout",
      HTTP_POST,
      [](
          AsyncWebServerRequest*) {},
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
      [this](
          AsyncWebServerRequest* request) {
        if (
            !_files.exists(
                LOCOS_PATH)
        ) {
          auto* response =
              request->beginResponse(
                  200,
                  "application/json",
                  "[]");

          response->addHeader(
              "Cache-Control",
              "no-store");

          request->send(
              response);

          return;
        }

        auto* response =
            request->beginResponse(
                LittleFS,
                LOCOS_PATH,
                "application/json",
                false);

        response->addHeader(
            "Cache-Control",
            "no-store");

        request->send(
            response);
      });

  _server.on(
      "/api/locos",
      HTTP_POST,
      [](
          AsyncWebServerRequest*) {},
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
      [this](
          AsyncWebServerRequest* request) {
        if (
            !_files.exists(
                SIGNAL_LOGIC_PATH)
        ) {
          auto* response =
              request->beginResponse(
                  404,
                  "text/plain; charset=utf-8",
                  "Not found");

          response->addHeader(
              "Cache-Control",
              "no-store");

          request->send(
              response);

          return;
        }

        auto* response =
            request->beginResponse(
                LittleFS,
                SIGNAL_LOGIC_PATH,
                "application/x-ndjson; charset=utf-8",
                false);

        response->addHeader(
            "Cache-Control",
            "no-store");

        request->send(
            response);
      });

  _server.on(
      "/api/signal-logic",
      HTTP_POST,
      [](
          AsyncWebServerRequest*) {},
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
        if (
            !request->hasParam(
                "path")
        ) {
          request->send(
              400,
              "text/plain",
              "Missing path");

          return;
        }

        String path =
            request
                ->getParam(
                    "path")
                ->value();

        if (
            !safePath(
                path)
        ) {
          request->send(
              400,
              "text/plain",
              "Invalid path");

          return;
        }

        if (
            !LittleFS.exists(
                path)
        ) {
          auto* response =
              request->beginResponse(
                  200,
                  "text/plain; charset=utf-8",
                  "");

          response->addHeader(
              "Cache-Control",
              "no-store");

          request->send(
              response);

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

        request->send(
            response);
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
        String path =
            "/";

        if (
            request->hasParam(
                "path")
        ) {
          path =
              request
                  ->getParam(
                      "path")
                  ->value();
        }

        if (
            !safePath(
                path)
        ) {
          request->send(
              400,
              "application/json",
              "{}");

          return;
        }

        File dir =
            LittleFS.open(
                path);

        JsonDocument doc;

        doc["path"] =
            path;

        JsonArray entries =
            doc["entries"]
                .to<JsonArray>();

        if (
            dir &&
            dir.isDirectory()
        ) {
          File item =
              dir.openNextFile();

          while (item) {
            const String itemPath =
                String(
                    item.name());

            String name =
                itemPath;

            const int slash =
                name.lastIndexOf(
                    '/');

            if (
                slash >= 0
            ) {
              name =
                  name.substring(
                      slash +
                      1);
            }

            JsonObject out =
                entries
                    .add<JsonObject>();

            out["name"] =
                name;

            out["path"] =
                itemPath.startsWith("/")
                    ? itemPath
                    : (
                          path == "/"
                              ? "/" +
                                    name
                              : path +
                                    "/" +
                                    name
                      );

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

  // Keep the existing DELETE endpoint for backwards compatibility.
  _server.on(
      "/delete",
      HTTP_DELETE,
      [](
          AsyncWebServerRequest* request) {
        if (
            !request->hasParam(
                "path")
        ) {
          request->send(
              400,
              "application/json",
              "{\"ok\":false}");

          return;
        }

        const String path =
            request
                ->getParam(
                    "path")
                ->value();

        if (
            !safePath(
                path) ||
            path ==
                LAYOUT_PATH ||
            path ==
                "/state/runtime-state.json"
        ) {
          request->send(
              403,
              "application/json",
              "{\"ok\":false}");

          return;
        }

        File target =
            LittleFS.open(
                path);

        if (!target) {
          request->send(
              404,
              "application/json",
              "{\"ok\":false}");

          return;
        }

        const bool isDirectory =
            target.isDirectory();

        target.close();

        const bool ok =
            isDirectory
                ? LittleFS.rmdir(
                      path)
                : LittleFS.remove(
                      path);

        request->send(
            ok
                ? 200
                : (
                      isDirectory
                          ? 409
                          : 404
                  ),
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

        doc["ok"] =
            true;

        JsonArray accessories =
            doc["accessories"]
                .to<JsonArray>();

        for (
            const auto& item :
            _runtime.accessories()
        ) {
          JsonObject out =
              accessories
                  .add<JsonObject>();

          out["id"] =
              item.id;

          out["address"] =
              item.address;

          switch (
              item.kind
          ) {
            case RuntimeAccessoryKind::Turnout:
              out["kind"] =
                  "turnout";

              out["closed"] =
                  item.closed;

              break;

            case RuntimeAccessoryKind::Signal:
              out["kind"] =
                  "signal";

              if (
                  item.aspect >=
                  0
              ) {
                out["aspect"] =
                    item.aspect;
              } else {
                out["aspect"] =
                    nullptr;
              }

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

        for (
            const auto& item :
            _runtime.sensors()
        ) {
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
        if (
            request->url()
                .startsWith(
                    "/api/")
        ) {
          request->send(
              404,
              "application/json",
              "{\"ok\":false,\"message\":\"API route not found\"}");

          return;
        }

        const String url =
            request->url();

        if (
            LittleFS.exists(
                url) ||
            LittleFS.exists(
                url +
                ".gz")
        ) {
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

  _server.addHandler(
      &_ws);

  _server.begin();

  Logger::info(
      "HTTP/WS server started");
}
