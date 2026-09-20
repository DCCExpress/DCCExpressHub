#include "HubCapabilitiesEndpoint.h"

#include <ArduinoJson.h>

#include "HubCapabilities.h"

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
      request->beginResponse(
          status,
          "application/json",
          body);

  response->addHeader(
      "Cache-Control",
      "no-store");

  request->send(
      response);
}

}  // namespace

HubCapabilitiesEndpoint::
    HubCapabilitiesEndpoint(
        AsyncWebServer& server) {
  registerRoutes(
      server);
}

void HubCapabilitiesEndpoint::
    registerRoutes(
        AsyncWebServer& server) {
  server.on(
      "/api/capabilities",
      HTTP_GET,
      [](
          AsyncWebServerRequest* request) {
        JsonDocument document;

        document["ok"] =
            true;

        document["javascriptAutomation"] =
            HubCapabilities::
                javascriptAutomation();

        document["fileManager"] =
            HubCapabilities::
                fileManager();

        document["deviceConfiguration"] =
            HubCapabilities::
                deviceConfiguration();

        document["gamepad"] =
            HubCapabilities::
                gamepad();

        document["s88"] =
            HubCapabilities::
                s88();

        document["programmingTrack"] =
            HubCapabilities::
                programmingTrack();

        sendJson(
            request,
            200,
            document);
      });
}
