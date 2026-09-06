#include "DeviceConfigEndpoint.h"

#include "Logger.h"

DeviceConfigEndpoint::DeviceConfigEndpoint(
    AsyncWebServer& server)
    : _server(server) {
  setupRoutes();
}

void DeviceConfigEndpoint::sendJson(
    AsyncWebServerRequest* request,
    int code,
    JsonDocument& document) {
  String body;

  serializeJson(
      document,
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

bool DeviceConfigEndpoint::verifyFile(
    const char* path,
    String& error) {
  File file =
      LittleFS.open(
          path,
          "r");

  if (!file) {
    error =
        "Cannot open device configuration";
    return false;
  }

  JsonDocument document;

  const DeserializationError parseError =
      deserializeJson(
          document,
          file);

  file.close();

  if (parseError ||
      !document.is<JsonObject>()) {
    error =
        "Invalid device configuration JSON";
    return false;
  }

  const int version =
      document["version"] | 0;

  if (version != 1) {
    error =
        "Unsupported device configuration version";
    return false;
  }

  if (!document["devices"].is<JsonArray>()) {
    error =
        "Device configuration requires a devices array";
    return false;
  }

  for (JsonObjectConst device :
       document["devices"].as<JsonArrayConst>()) {
    const char* id =
        device["id"] | nullptr;

    const char* name =
        device["name"] | nullptr;

    const char* type =
        device["type"] | nullptr;

    if (!id ||
        !*id ||
        !name ||
        !*name ||
        !type ||
        !*type) {
      error =
          "Every device requires id, name and type";
      return false;
    }

    if (!device["enabled"].is<bool>() ||
        !device["address"].is<int>() ||
        !device["firstVpin"].is<int>() ||
        !device["pinCount"].is<int>()) {
      error =
          "Device configuration contains invalid required fields";
      return false;
    }

    const int address =
        device["address"].as<int>();

    const int firstVpin =
        device["firstVpin"].as<int>();

    const int pinCount =
        device["pinCount"].as<int>();

    if (address < 0 ||
        address > 0x7f ||
        firstVpin < 1 ||
        firstVpin > 32767 ||
        pinCount < 1 ||
        pinCount > 64 ||
        firstVpin + pinCount - 1 > 32767) {
      error =
          "Device address or VPIN range is invalid";
      return false;
    }
  }

  return true;
}

void DeviceConfigEndpoint::handleBody(
    AsyncWebServerRequest* request,
    uint8_t* data,
    size_t len,
    size_t index,
    size_t total) {
  if (index == 0) {
    _uploadExpected =
        total;

    _uploadWritten =
        0;

    _uploadFailed =
        false;

    _uploadTooLarge =
        total >
        MAX_UPLOAD_BYTES;

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
        _uploadFailed =
            true;
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
      _uploadFailed =
          true;
    }
  }

  if (index + len != total) {
    return;
  }

  if (_upload) {
    _upload.flush();
    _upload.close();
  }

  JsonDocument response;

  if (_uploadTooLarge) {
    LittleFS.remove(
        TEMP_PATH);

    response["ok"] =
        false;

    response["message"] =
        "Device configuration exceeds 256 KB";

    sendJson(
        request,
        413,
        response);
    return;
  }

  if (_uploadFailed ||
      _uploadWritten !=
          _uploadExpected) {
    LittleFS.remove(
        TEMP_PATH);

    response["ok"] =
        false;

    response["message"] =
        "Device configuration upload failed";

    sendJson(
        request,
        507,
        response);
    return;
  }

  String verifyError;

  if (!verifyFile(
          TEMP_PATH,
          verifyError)) {
    LittleFS.remove(
        TEMP_PATH);

    response["ok"] =
        false;

    response["message"] =
        verifyError;

    sendJson(
        request,
        400,
        response);
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

    response["ok"] =
        false;

    response["message"] =
        "Device configuration atomic rename failed";

    sendJson(
        request,
        500,
        response);
    return;
  }

  LittleFS.remove(
      BACKUP_PATH);

  Logger::info(
      "Device configuration saved: " +
      String(total) +
      " bytes");

  response["ok"] =
      true;

  response["bytes"] =
      total;

  response["message"] =
      "Device configuration saved";

  sendJson(
      request,
      200,
      response);
}

void DeviceConfigEndpoint::setupRoutes() {
  _server.on(
      "/api/device-config",
      HTTP_GET,
      [](
          AsyncWebServerRequest* request) {
        if (!LittleFS.exists(
                FINAL_PATH)) {
          auto* response =
              request->beginResponse(
                  200,
                  "application/json",
                  "{\"version\":1,\"devices\":[]}");

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
      "/api/device-config",
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
