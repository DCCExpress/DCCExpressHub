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

  JsonArrayConst devices =
      document["devices"]
          .as<JsonArrayConst>();

  for (
      size_t index = 0;
      index <
          devices.size();
      ++index
  ) {
    JsonObjectConst device =
        devices[index]
            .as<JsonObjectConst>();

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
        !device["address"].is<int>()
    ) {
      error =
          "Device configuration contains invalid required fields";
      return false;
    }

    const String typeText =
        String(type);

    const bool isPca =
        typeText ==
        "pca9685";

    const bool isMcp =
        typeText ==
        "mcp23017";

    const bool isPcf8 =
        typeText ==
        "pcf8574";

    const bool isPcf16 =
        typeText ==
        "pcf8575";

    const bool isLegacy =
        isPca ||
        isMcp ||
        isPcf8 ||
        isPcf16;

    if (!isLegacy) {
      error =
          "Unsupported device type: " +
          typeText;
      return false;
    }

    const int address =
        device["address"]
            .as<int>();

    if (
        address < 0x08 ||
        address > 0x77
    ) {
      error =
          "I2C address must be between 0x08 and 0x77";
      return false;
    }

    if (
        !device["firstVpin"].is<int>() ||
        !device["pinCount"].is<int>()
    ) {
      error =
          "HAL device requires firstVpin and pinCount";
      return false;
    }

    const int firstVpin =
        device["firstVpin"]
            .as<int>();

    const int pinCount =
        device["pinCount"]
            .as<int>();

    const int expectedPinCount =
        isPcf8
            ? 8
            : 16;

    if (
        firstVpin < 40 ||
        firstVpin > 32767 ||
        pinCount !=
            expectedPinCount ||
        firstVpin +
                pinCount -
                1 >
            32767
    ) {
      error =
          "HAL device VPIN range or pin count is invalid";
      return false;
    }

    if (
        isPca &&
        (
            address < 0x40 ||
            address > 0x7d
        )
    ) {
      error =
          "PCA9685 I2C address must be between 0x40 and 0x7D";
      return false;
    }

    if (
        !isPca &&
        (
            address < 0x20 ||
            address > 0x27
        )
    ) {
      error =
          "Configured digital I2C expander address must be between 0x20 and 0x27";
      return false;
    }

    // Pairwise validation keeps the persisted file safe even if the browser
    // UI is bypassed or an old client submits malformed data.
    for (
        size_t previousIndex = 0;
        previousIndex <
            index;
        ++previousIndex
    ) {
      JsonObjectConst previous =
          devices[previousIndex]
              .as<JsonObjectConst>();

      const char* previousId =
          previous["id"] |
          "";

      if (
          String(previousId) ==
          String(id)
      ) {
        error =
            "Device IDs must be unique";
        return false;
      }

      const bool enabled =
          device["enabled"]
              .as<bool>();

      const bool previousEnabled =
          previous["enabled"] |
          false;

      if (
          enabled &&
          previousEnabled &&
          previous["address"].is<int>() &&
          previous["address"].as<int>() ==
              address
      ) {
        error =
            "Enabled devices cannot share the same I2C address";
        return false;
      }

      const String previousType =
          String(
              previous["type"] |
              "");

      const bool previousIsLegacy =
          previousType ==
              "pca9685" ||
          previousType ==
              "mcp23017" ||
          previousType ==
              "pcf8574" ||
          previousType ==
              "pcf8575";

      if (
          enabled &&
          previousEnabled &&
          isLegacy &&
          previousIsLegacy &&
          previous["firstVpin"].is<int>() &&
          previous["pinCount"].is<int>()
      ) {
        const int previousFirst =
            previous["firstVpin"]
                .as<int>();

        const int previousLast =
            previousFirst +
            previous["pinCount"]
                .as<int>() -
            1;

        if (
            firstVpin <=
                previousLast &&
            firstVpin +
                    pinCount -
                    1 >=
                previousFirst
        ) {
          error =
              "Enabled HAL device VPIN ranges cannot overlap";
          return false;
        }
      }
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
      index + len !=
      total
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
