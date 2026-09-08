#pragma once

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>

#include "FileStore.h"

class AutomationsEndpoint {
public:
  explicit AutomationsEndpoint(
      AsyncWebServer& server);

private:
  static constexpr const char* FINAL_PATH =
      "/config/automations.json";

  static constexpr size_t MAX_UPLOAD_BYTES =
      512 * 1024;

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
      const String& body);
};
