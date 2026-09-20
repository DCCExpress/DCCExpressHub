#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>

#include "ICommandCenter.h"
#include "JsSandbox.h"
#include "LayoutRuntime.h"

#ifndef HUB_JS_SANDBOX
#define HUB_JS_SANDBOX 0
#endif

class JsSandboxEndpoint {
public:
  JsSandboxEndpoint(
      AsyncWebServer& server,
      ICommandCenter& commandCenter,
      LayoutRuntime& runtime);

private:
#if HUB_JS_SANDBOX
  static constexpr const char* SOURCE_PATH =
      "/scripts/sandbox.js";

  JsSandbox _sandbox;

  static void sendJson(
      AsyncWebServerRequest* request,
      int status,
      JsonDocument& document);

  static String defaultSource();

  void registerRoutes(
      AsyncWebServer& server);

  void sendStatus(
      AsyncWebServerRequest* request);
#endif
};
