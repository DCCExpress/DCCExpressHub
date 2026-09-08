#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>

#include "FileStore.h"

class DeviceConfigEndpoint {
public:
  explicit DeviceConfigEndpoint(
      AsyncWebServer& server);

private:
  static constexpr const char* FINAL_PATH =
      "/config/device-config.json";

  static constexpr size_t MAX_UPLOAD_BYTES =
      256 * 1024;

  AsyncWebServer& _server;
  FileStore _files{LittleFS};
  AtomicFileUpload _upload;

  void setupRoutes();

  void handleBody(
      AsyncWebServerRequest* request,
      uint8_t* data,
      size_t len,
      size_t index,
      size_t total);

  bool verifyTemp(
      String& error);

  static void sendJson(
      AsyncWebServerRequest* request,
      int code,
      JsonDocument& document);
};
