#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <AsyncJson.h>
#include <ESPAsyncWebServer.h>

class ScriptInfoEndpoint {
public:
  explicit ScriptInfoEndpoint(
      AsyncWebServer& server);

private:
  struct ScriptInfoEntry {
    String executionId;
    String ownerId;
    String message;

    bool active() const {
      return !executionId.isEmpty();
    }

    void clear() {
      executionId = "";
      ownerId = "";
      message = "";
    }
  };

  static constexpr size_t MAX_ENTRIES = 32;
  static constexpr size_t MAX_EXECUTION_ID_LENGTH = 128;
  static constexpr size_t MAX_OWNER_ID_LENGTH = 192;
  static constexpr size_t MAX_MESSAGE_LENGTH = 512;

  AsyncWebServer& _server;
  AsyncEventSource _events{
      "/api/script-info/events"};

  ScriptInfoEntry _entries[MAX_ENTRIES];

  void setupRoutes();

  ScriptInfoEntry* findEntry(
      const String& executionId);

  ScriptInfoEntry* findFreeEntry();

  void sendSnapshot(
      AsyncEventSourceClient* client);

  void broadcastChange(
      const String& executionId,
      const String& ownerId,
      const String& message);

  void handlePost(
      AsyncWebServerRequest* request,
      JsonVariant& json);

  static void sendJson(
      AsyncWebServerRequest* request,
      int code,
      JsonDocument& document);
};
