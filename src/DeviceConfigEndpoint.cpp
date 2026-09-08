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

bool DeviceConfigEndpoint::verifyTemp(
    String& error) {
  const String path =
      _upload.tempPath();

  File file =
      _files.openRead(
          path.c_str());

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

  if (
      parseError ||
      !document.is<JsonObject>()
  ) {
    error =
        "Invalid device configuration JSON";
    return false;
  }

  if (
      (document["version"] | 0) != 1
  ) {
    error =
        "Unsupported device configuration version";
    return false;
  }

  if (
      !document["devices"]
           .is<JsonArray>()
  ) {
    error =
        "Device configuration requires a devices array";
    return false;
  }

  for (
      JsonObjectConst device :
      document["devices"]
          .as<JsonArrayConst>()
  ) {
    const char* id =
        device["id"] | nullptr;

    const char* name =
        device["name"] | nullptr;

    const char* type =
        device["type"] | nullptr;

    if (
        !id || !*id ||
        !name || !*name ||
        !type || !*type
    ) {
      error =
          "Every device requires id, name and type";
      return false;
    }

    if (
        !device["enabled"].is<bool>() ||
        !device["address"].is<int>() ||
        !device["firstVpin"].is<int>() ||
        !device["pinCount"].is<int>()
    ) {
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

    if (
        address < 0 ||
        address > 0x7f ||
        firstVpin < 1 ||
        firstVpin > 32767 ||
        pinCount < 1 ||
        pinCount > 64 ||
        firstVpin +
                pinCount -
                1 >
            32767
    ) {
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

  JsonDocument response;

  if (_upload.tooLarge()) {
    _upload.abort();

    response["ok"] = false;
    response["message"] =
        "Device configuration exceeds 256 KB";

    sendJson(
        request,
        413,
        response);
    return;
  }

  if (!_upload.finish()) {
    _upload.abort();

    response["ok"] = false;
    response["message"] =
        "Device configuration upload failed";

    sendJson(
        request,
        507,
        response);
    return;
  }

  String verifyError;

  if (
      !verifyTemp(
          verifyError)
  ) {
    _upload.abort();

    response["ok"] = false;
    response["message"] =
        verifyError;

    sendJson(
        request,
        400,
        response);
    return;
  }

  if (!_upload.commit()) {
    response["ok"] = false;
    response["message"] =
        "Device configuration atomic rename failed";

    sendJson(
        request,
        500,
        response);
    return;
  }

  Logger::info(
      "Device configuration saved: " +
      String(total) +
      " bytes");

  response["ok"] = true;
  response["bytes"] = total;
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
