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

  request->send(
      response);
}

bool AutomationsEndpoint::backupCurrent() {
  // IMPORTANT: an automation POST already owns FINAL_PATH.tmp here.
  // FileStore::openRead(FINAL_PATH) runs recover(), and recover() treats a
  // final+temp pair as stale transaction debris and removes the temp file.
  // That would delete the just-uploaded, already validated candidate before
  // AtomicFileUpload::commit() gets a chance to commit it.
  //
  // Read the currently committed final directly while this transaction is
  // active; recovery belongs before beginWrite(), not in the middle of it.
  File source =
      LittleFS.open(
          FINAL_PATH,
          "r");

  if (!source) {
    // First save: there is no previous committed document yet.
    return true;
  }

  LittleFS.remove(
      PREVIOUS_PATH);

  File target =
      LittleFS.open(
          PREVIOUS_PATH,
          "w");

  if (!target) {
    source.close();

    Logger::error(
        "Automations backup could not be opened");

    return false;
  }

  uint8_t buffer[512];
  bool ok = true;

  while (source.available()) {
    const size_t read =
        source.read(
            buffer,
            sizeof(buffer));

    if (read == 0) {
      break;
    }

    if (
        target.write(
            buffer,
            read) != read
    ) {
      ok = false;
      break;
    }
  }

  target.flush();
  target.close();
  source.close();

  if (!ok) {
    LittleFS.remove(
        PREVIOUS_PATH);

    Logger::error(
        "Automations backup copy failed");

    return false;
  }

  Logger::info(
      "Automations previous snapshot saved");

  return true;
}

bool AutomationsEndpoint::verifyTemp(
    String& error) {
  const String path =
      _upload.tempPath();

  File file =
      _files.openRead(
          path.c_str());

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

  if (
      !document.is<
          JsonObject>()
  ) {
    error =
        "Automation root must be an object";
    return false;
  }

  if (
      (document["version"] | 0) != 1
  ) {
    error =
        "Unsupported automation storage version";
    return false;
  }

  if (
      !document["scripts"]
           .is<JsonArray>()
  ) {
    error =
        "Automation scripts must be an array";
    return false;
  }

  for (
      JsonVariant item :
      document["scripts"]
          .as<JsonArray>()
  ) {
    if (
        !item.is<JsonObject>()
    ) {
      error =
          "Automation script entry must be an object";
      return false;
    }

    JsonObject script =
        item.as<JsonObject>();

    if (
        !script["id"].is<const char*>() ||
        !script["name"].is<const char*>() ||
        !script["script"].is<const char*>()
    ) {
      error =
          "Automation script requires id, name and script strings";
      return false;
    }

    const String id =
        script["id"].as<String>();

    const String name =
        script["name"].as<String>();

    if (
        id.isEmpty() ||
        id.length() > 160
    ) {
      error =
          "Automation id is invalid";
      return false;
    }

    if (
        name.isEmpty() ||
        name.length() > 160
    ) {
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
    _upload.begin(
        _files,
        FINAL_PATH,
        total,
        MAX_UPLOAD_BYTES);
  }

  if (
      !_upload.tooLarge() &&
      !_upload.failed()
  ) {
    _upload.write(
        data,
        len);
  }

  if (
      index + len != total
  ) {
    return;
  }

  if (_upload.tooLarge()) {
    _upload.abort();

    sendJson(
        request,
        413,
        "{\"ok\":false,\"message\":\"Automation storage exceeds 512 KB\"}");
    return;
  }

  if (!_upload.finish()) {
    _upload.abort();

    sendJson(
        request,
        507,
        "{\"ok\":false,\"message\":\"Automation upload failed\"}");
    return;
  }

  String verifyError;

  if (
      !verifyTemp(
          verifyError)
  ) {
    _upload.abort();

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

  if (!backupCurrent()) {
    _upload.abort();

    sendJson(
        request,
        500,
        "{\"ok\":false,\"message\":\"Automation previous-version backup failed\"}");
    return;
  }

  if (!_upload.commit()) {
    sendJson(
        request,
        500,
        "{\"ok\":false,\"message\":\"Automation atomic rename failed\"}");
    return;
  }

  Logger::info(
      "Automations saved: " +
      String(total) +
      " bytes");

  JsonDocument response;
  response["ok"] = true;
  response["bytes"] = total;

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
      [this](
          AsyncWebServerRequest* request) {
        if (
            !_files.exists(
                FINAL_PATH)
        ) {
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
      "/api/automations/previous",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        File previous =
            LittleFS.open(
                PREVIOUS_PATH,
                "r");

        if (!previous) {
          sendJson(
              request,
              404,
              "{\"ok\":false,\"message\":\"No previous automation snapshot\"}");
          return;
        }

        previous.close();

        auto* response =
            request->beginResponse(
                LittleFS,
                PREVIOUS_PATH,
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
