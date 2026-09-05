#pragma once

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>

class AutomationsEndpoint {
public:
  explicit AutomationsEndpoint(
      AsyncWebServer& server);

private:
  static constexpr const char* FINAL_PATH =
      "/config/automations.json";

  static constexpr const char* TEMP_PATH =
      "/config/automations.json.tmp";

  static constexpr const char* BACKUP_PATH =
      "/config/automations.json.bak";

  static constexpr size_t MAX_UPLOAD_BYTES =
      512 * 1024;

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
      const String& body);
};
