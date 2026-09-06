#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>

class DeviceConfigEndpoint {
public:
  explicit DeviceConfigEndpoint(
      AsyncWebServer& server);

private:
  static constexpr const char* FINAL_PATH =
      "/config/device-config.json";

  static constexpr const char* TEMP_PATH =
      "/config/device-config.json.tmp";

  static constexpr const char* BACKUP_PATH =
      "/config/device-config.json.bak";

  static constexpr size_t MAX_UPLOAD_BYTES =
      256 * 1024;

  AsyncWebServer& _server;

  File _upload;
  size_t _uploadExpected = 0;
  size_t _uploadWritten = 0;
  bool _uploadFailed = false;
  bool _uploadTooLarge = false;

  void setupRoutes();

  void handleBody(
      AsyncWebServerRequest* request,
      uint8_t* data,
      size_t len,
      size_t index,
      size_t total);

  static bool verifyFile(
      const char* path,
      String& error);

  static void sendJson(
      AsyncWebServerRequest* request,
      int code,
      JsonDocument& document);
};
