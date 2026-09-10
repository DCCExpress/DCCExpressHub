#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>

#include "FileStore.h"
#include "S88I2CMaster.h"

class DeviceConfigEndpoint {
public:
  DeviceConfigEndpoint(
      AsyncWebServer& server,
      S88I2CMaster& s88);

private:
  static constexpr const char* FINAL_PATH =
      "/config/device-config.json";

  static constexpr size_t MAX_UPLOAD_BYTES =
      256 * 1024;

  AsyncWebServer& _server;
  S88I2CMaster& _s88;

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

  void sendS88Status(
      AsyncWebServerRequest* request);

  static void sendJson(
      AsyncWebServerRequest* request,
      int code,
      JsonDocument& document);
};
