#include "AutomationsEndpoint.h"

#include <ArduinoJson.h>

#include "Logger.h"

AutomationsEndpoint::AutomationsEndpoint(
    AsyncWebServer& server)
    : _server(server) {
  setupRoutes();
}

void AutomationsEndpoint::sendJson(
    AsyncWebServerRequest* request,
    int code,
    const String& body) {
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

bool AutomationsEndpoint::verifyFile(
    const char* path,
    String& error) {
  File file =
      LittleFS.open(
          path,
          "r");

  if (!file) {
    error =
        "Cannot open automation file";
    return false;
  }

  JsonDocument document;

  const DeserializationError parseError =
      deserializeJson(
          document,
          file);

  file.close();

  if (parseError) {
    error =
        "Invalid automation JSON";
    return false;
  }

  if (!document.is<JsonObject>()) {
    error =
        "Automation root must be an object";
    return false;
  }

  const int version =
      document["version"] | 0;

  if (version != 1) {
    error =
        "Unsupported automation storage version";
    return false;
  }

  if (!document["scripts"].is<JsonArray>()) {
    error =
        "Automation scripts must be an array";
    return false;
  }

  JsonArray scripts =
      document["scripts"].as<JsonArray>();

  for (JsonVariant item : scripts) {
    if (!item.is<JsonObject>()) {
      error =
          "Automation script entry must be an object";
      return false;
    }

    JsonObject script =
        item.as<JsonObject>();

    if (!script["id"].is<const char*>() ||
        !script["name"].is<const char*>() ||
        !script["script"].is<const char*>()) {
      error =
          "Automation script requires id, name and script strings";
      return false;
    }

    const String id =
        script["id"].as<String>();

    const String name =
        script["name"].as<String>();

    if (id.length() == 0 ||
        id.length() > 160) {
      error =
          "Automation id is invalid";
      return false;
    }

    if (name.length() == 0 ||
        name.length() > 160) {
      error =
          "Automation name is invalid";
      return false;
    }
  }

  return true;
}

void AutomationsEndpoint::handleBody(
    AsyncWebServerRequest* request,
    uint8_t* data,
    size_t len,
    size_t index,
    size_t total) {
  if (index == 0) {
    _uploadExpected = total;
    _uploadWritten = 0;
    _uploadFailed = false;
    _uploadTooLarge =
        total > MAX_UPLOAD_BYTES;

    LittleFS.mkdir(
        "/config");

    LittleFS.remove(
        TEMP_PATH);

    if (!_uploadTooLarge) {
      _upload =
          LittleFS.open(
              TEMP_PATH,
              "w");

      if (!_upload) {
        _uploadFailed = true;

        Logger::error(
            "Cannot open automation temp file");
      }
    }
  }

  if (!_uploadTooLarge &&
      !_uploadFailed &&
      _upload) {
    const size_t written =
        _upload.write(
            data,
            len);

    _uploadWritten +=
        written;

    if (written != len) {
      _uploadFailed = true;
    }
  }

  if (index + len != total) {
    return;
  }

  if (_upload) {
    _upload.flush();
    _upload.close();
  }

  if (_uploadTooLarge) {
    LittleFS.remove(
        TEMP_PATH);

    sendJson(
        request,
        413,
        "{\"ok\":false,\"message\":\"Automation storage exceeds 512 KB\"}");
    return;
  }

  if (_uploadFailed ||
      _uploadWritten !=
          _uploadExpected) {
    LittleFS.remove(
        TEMP_PATH);

    sendJson(
        request,
        507,
        "{\"ok\":false,\"message\":\"Automation upload failed\"}");
    return;
  }

  String verifyError;

  if (!verifyFile(
          TEMP_PATH,
          verifyError)) {
    LittleFS.remove(
        TEMP_PATH);

    JsonDocument response;
    response["ok"] = false;
    response["message"] =
        verifyError;

    String body;
    serializeJson(
        response,
        body);

    sendJson(
        request,
        400,
        body);
    return;
  }

  LittleFS.remove(
      BACKUP_PATH);

  if (LittleFS.exists(
          FINAL_PATH)) {
    LittleFS.rename(
        FINAL_PATH,
        BACKUP_PATH);
  }

  if (!LittleFS.rename(
          TEMP_PATH,
          FINAL_PATH)) {
    if (LittleFS.exists(
            BACKUP_PATH)) {
      LittleFS.rename(
          BACKUP_PATH,
          FINAL_PATH);
    }

    sendJson(
        request,
        500,
        "{\"ok\":false,\"message\":\"Automation atomic rename failed\"}");
    return;
  }

  LittleFS.remove(
      BACKUP_PATH);

  Logger::info(
      "Automations saved: " +
      String(total) +
      " bytes");

  JsonDocument response;
  response["ok"] = true;
  response["bytes"] =
      total;

  String body;
  serializeJson(
      response,
      body);

  sendJson(
      request,
      200,
      body);
}

void AutomationsEndpoint::setupRoutes() {
  _server.on(
      "/api/automations",
      HTTP_GET,
      [](
          AsyncWebServerRequest* request) {
        if (!LittleFS.exists(
                FINAL_PATH)) {
          auto* response =
              request->beginResponse(
                  200,
                  "application/json",
                  "{\"version\":1,\"scripts\":[]}");

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
                FINAL_PATH,
                "application/json",
                false);

        response->addHeader(
            "Cache-Control",
            "no-store");

        request->send(
            response);
      });

  _server.on(
      "/api/automations",
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
        handleBody(
            request,
            data,
            len,
            index,
            total);
      });
}
