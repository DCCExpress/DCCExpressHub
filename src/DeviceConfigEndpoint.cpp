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

  uint8_t s88Count =
      0;

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
        !device["address"].is<int>()
    ) {
      error =
          "Device configuration contains invalid required fields";
      return false;
    }

    const int address =
        device["address"].as<int>();

    if (
        address < 0x08 ||
        address > 0x77
    ) {
      error =
          "I2C address must be between 0x08 and 0x77";
      return false;
    }

    const String typeText =
        String(type);

    if (
        typeText ==
        "s88adapter"
    ) {
      ++s88Count;

      if (
          s88Count > 1
      ) {
        error =
            "Only one S88 adapter is currently supported";
        return false;
      }

      if (
          !device["baseAddress"].is<int>() ||
          !device["groupCount"].is<int>() ||
          !device["byteCount"].is<int>()
      ) {
        error =
            "S88 adapter requires baseAddress, groupCount and byteCount";
        return false;
      }

      const int baseAddress =
          device["baseAddress"].as<int>();

      const int groupCount =
          device["groupCount"].as<int>();

      const int byteCount =
          device["byteCount"].as<int>();

      const int sensorCount =
          groupCount *
          S88I2CMaster::BITS_PER_GROUP;

      if (
          groupCount < 1 ||
          groupCount >
              S88I2CMaster::MAX_GROUPS ||
          byteCount !=
              groupCount ||
          baseAddress < 1 ||
          baseAddress +
                  sensorCount -
                  1 >
              65535
      ) {
        error =
            "Invalid S88 group, byte or base-address configuration";
        return false;
      }

      continue;
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
        device["firstVpin"].as<int>();

    const int pinCount =
        device["pinCount"].as<int>();

    if (
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
          "HAL device VPIN range is invalid";
      return false;
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

  document["adapterConfigurationSent"] =
      _s88.adapterConfigurationSent();

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
                S88I2CMaster::BITS_PER_GROUP);

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
        _s88.snapshotKnown()
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
          ? "Device configuration saved; S88 settings applied live"
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
