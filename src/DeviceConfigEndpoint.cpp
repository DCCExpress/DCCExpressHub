#include "DeviceConfigEndpoint.h"

#include "Logger.h"

DeviceConfigEndpoint::DeviceConfigEndpoint(
    AsyncWebServer& server,
    S88I2CMaster& s88)
    : _server(server),
      _s88(s88) {
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

  uint16_t s88Count =
      0;

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

    const bool isS88 =
        typeText ==
        "s88adapter";

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

    if (
        !isS88 &&
        !isLegacy
    ) {
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

    if (isS88) {
      ++s88Count;

      if (
          s88Count > 1
      ) {
        error =
            "Only one S88 adapter is currently supported";
        return false;
      }

      // The adapter owns its S88 byte count. The Hub persists only the
      // adapter I2C address (plus the generic enabled flag). Old files may
      // still contain baseAddress/groupCount/byteCount; they are ignored.
    } else {
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
        const int firstVpin =
            device["firstVpin"]
                .as<int>();

        const int pinCount =
            device["pinCount"]
                .as<int>();

        const int lastVpin =
            firstVpin +
            pinCount -
            1;

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
            lastVpin >=
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

void DeviceConfigEndpoint::sendS88Status(
    AsyncWebServerRequest* request) {
  JsonDocument document;

  document["enabled"] =
      _s88.enabled();

  document["online"] =
      _s88.slavePresent();

  document["snapshotKnown"] =
      _s88.snapshotKnown();

  document["dataFresh"] =
      _s88.dataFresh();

  document["ready"] =
      _s88.ready();

  document["adapterInfoKnown"] =
      _s88.adapterInfoKnown();

  document["protocolVersion"] =
      _s88.protocolVersion();

  document["firmwareVersion"] =
      _s88.firmwareVersion();

  document["firmwareMajor"] =
      _s88.firmwareMajor();

  document["firmwareMinor"] =
      _s88.firmwareMinor();

  document["firmwarePatch"] =
      _s88.firmwarePatch();

  document["maxByteCount"] =
      _s88.adapterMaxByteCount();

  document["capabilities"] =
      _s88.adapterCapabilities();

  document["address"] =
      _s88.slaveAddress();

  char addressHex[5];

  snprintf(
      addressHex,
      sizeof(addressHex),
      "0x%02X",
      _s88.slaveAddress());

  document["addressHex"] =
      addressHex;

  document["baseAddress"] =
      _s88.baseSensorAddress();

  document["groupCount"] =
      _s88.groupCount();

  document["byteCount"] =
      _s88.byteCount();

  document["sensorCount"] =
      _s88.sensorCount();

  JsonArray groups =
      document["groups"]
          .to<JsonArray>();

  for (
      uint8_t groupIndex = 0;
      groupIndex <
          _s88.groupCount();
      ++groupIndex
  ) {
    JsonObject group =
        groups.add<JsonObject>();

    group["index"] =
        static_cast<uint8_t>(
            groupIndex +
            1);

    group["baseAddress"] =
        static_cast<uint16_t>(
            _s88.baseSensorAddress() +
            static_cast<uint16_t>(
                groupIndex) *
                S88I2CMaster::BITS_PER_BYTE);

    const uint8_t snapshotGroup =
        static_cast<uint8_t>(
            groupIndex /
            2U);

    const uint8_t shift =
        static_cast<uint8_t>(
            (
                groupIndex %
                2U
            ) *
            8U);

    group["activeBits"] =
        static_cast<uint8_t>(
            (
                _s88.activeBitsForSnapshotGroup(
                    snapshotGroup) >>
                shift
            ) &
            0xffU);

    group["knownBits"] =
        _s88.dataFresh()
            ? 0xffU
            : 0U;
  }

  sendJson(
      request,
      200,
      document);
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

  const bool s88Applied =
      _s88.reloadConfiguration(
          LittleFS);

  Logger::info(
      "Device configuration saved: " +
      String(total) +
      " bytes");

  response["ok"] =
      true;

  response["bytes"] =
      total;

  response["s88Applied"] =
      s88Applied;

  response["s88Online"] =
      _s88.slavePresent();

  response["message"] =
      s88Applied
          ? "Device configuration saved; S88 I2C address applied live"
          : "Device configuration saved; S88 runtime fell back to defaults";

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

  _server.on(
      "/api/s88-status",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        sendS88Status(
            request);
      });
}
