#pragma once

#include <ESPAsyncWebServer.h>

class HubCapabilitiesEndpoint {
public:
  explicit HubCapabilitiesEndpoint(
      AsyncWebServer& server);

private:
  void registerRoutes(
      AsyncWebServer& server);
};
