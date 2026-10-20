#include "JsTestEndpoint.h"

#if HUB_JS_TEST

#include <ArduinoJson.h>

#include "Logger.h"

namespace {

void sendJson(
    AsyncWebServerRequest* request,
    int status,
    JsonDocument& document) {
  String body;

  serializeJson(
      document,
      body);

  auto* response =
      request
          ->beginResponse(
              status,
              "application/json",
              body);

  response
      ->addHeader(
          "Cache-Control",
          "no-store");

  request
      ->send(
          response);
}

}

JsTestEndpoint::JsTestEndpoint(
    AsyncWebServer& server,
    ICommandCenter& commandCenter,
    LayoutRuntime& runtime)
    : _sandbox(
          commandCenter,
          runtime) {
  server.on(
      "/api/dev/js-test",
      HTTP_POST,
      [this](
          AsyncWebServerRequest* request) {
        JsonDocument response;

        if (_busy) {
          response["ok"] =
              false;

          response["message"] =
              "JavaScript smoke test is already running";

          sendJson(
              request,
              409,
              response);

          return;
        }

        _busy =
            true;

        const uint32_t freeHeapBefore =
            ESP.getFreeHeap();

        const uint32_t freePsramBefore =
            ESP.getFreePsram();

        Logger::warn(
            "JS smoke test requested: loco 18 F0");

        String error;

        const unsigned long started =
            millis();

        const bool ok =
            _sandbox
                .runLightingSmokeTest(
                    error);

        const unsigned long elapsed =
            millis() -
            started;

        const uint32_t freeHeapAfter =
            ESP.getFreeHeap();

        const uint32_t freePsramAfter =
            ESP.getFreePsram();

        _busy =
            false;

        response["ok"] =
            ok;

        response["test"] =
            "loco18-f0-toggle";

        response["elapsedMs"] =
            elapsed;

        response["freeHeapBefore"] =
            freeHeapBefore;

        response["freeHeapAfter"] =
            freeHeapAfter;

        response["freePsramBefore"] =
            freePsramBefore;

        response["freePsramAfter"] =
            freePsramAfter;

        if (!ok) {
          response["message"] =
              error;
        }

        sendJson(
            request,
            ok
                ? 200
                : 500,
            response);
      });
}

#else

JsTestEndpoint::JsTestEndpoint(
    AsyncWebServer&,
    ICommandCenter&,
    LayoutRuntime&) {}

#endif
