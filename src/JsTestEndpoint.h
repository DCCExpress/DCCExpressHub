#pragma once

#include <Arduino.h>
#include <ESPAsyncWebServer.h>

#include "ICommandCenter.h"
#include "JsSandbox.h"
#include "LayoutRuntime.h"

#ifndef HUB_JS_TEST
#define HUB_JS_TEST 0
#endif

class JsTestEndpoint {
public:
  JsTestEndpoint(
      AsyncWebServer& server,
      ICommandCenter& commandCenter,
      LayoutRuntime& runtime);

private:
#if HUB_JS_TEST
  JsSandbox _sandbox;
  bool _busy = false;
#endif
};
