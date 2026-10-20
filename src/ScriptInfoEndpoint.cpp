#include "ScriptInfoEndpoint.h"

#include "Logger.h"

ScriptInfoEndpoint::ScriptInfoEndpoint(
    AsyncWebServer& server)
    : _server(server) {
  setupRoutes();
}

void ScriptInfoEndpoint::sendJson(
    AsyncWebServerRequest* request,
    int code,
    JsonDocument& document) {
  String body;
  serializeJson(
      document,
      body);

  auto* response =
      request->beginResponse(
          code,
          "application/json",
          body);

  response->addHeader(
      "Cache-Control",
      "no-store");

  request->send(
      response);
}

ScriptInfoEndpoint::ScriptInfoEntry*
ScriptInfoEndpoint::findEntry(
    const String& executionId) {
  for (auto& entry : _entries) {
    if (
        entry.active() &&
        entry.executionId == executionId) {
      return &entry;
    }
  }

  return nullptr;
}

ScriptInfoEndpoint::ScriptInfoEntry*
ScriptInfoEndpoint::findFreeEntry() {
  for (auto& entry : _entries) {
    if (!entry.active()) {
      return &entry;
    }
  }

  return nullptr;
}

void ScriptInfoEndpoint::sendSnapshot(
    AsyncEventSourceClient* client) {
  if (!client) {
    return;
  }

  JsonDocument document;
  JsonArray items =
      document["items"].to<JsonArray>();

  for (const auto& entry : _entries) {
    if (!entry.active()) {
      continue;
    }

    JsonObject item =
        items.add<JsonObject>();

    item["executionId"] =
        entry.executionId;

    item["ownerId"] =
        entry.ownerId;

    item["message"] =
        entry.message;
  }

  String body;
  serializeJson(
      document,
      body);

  client->send(
      body.c_str(),
      "snapshot",
      millis());
}

void ScriptInfoEndpoint::broadcastChange(
    const String& executionId,
    const String& ownerId,
    const String& message) {
  JsonDocument document;

  document["executionId"] =
      executionId;

  document["ownerId"] =
      ownerId;

  document["message"] =
      message;

  String body;
  serializeJson(
      document,
      body);

  _events.send(
      body.c_str(),
      "changed",
      millis());
}

void ScriptInfoEndpoint::handlePost(
    AsyncWebServerRequest* request,
    JsonVariant& json) {
  JsonDocument response;

  if (!json.is<JsonObject>()) {
    response["ok"] =
        false;

    response["message"] =
        "JSON object expected";

    sendJson(
        request,
        400,
        response);

    return;
  }

  JsonObjectConst input =
      json.as<JsonObjectConst>();

  String executionId =
      input["executionId"] | "";

  String ownerId =
      input["ownerId"] | "";

  String message =
      input["message"] | "";

  const bool force =
      input["force"] | false;

  executionId.trim();
  ownerId.trim();

  if (
      executionId.isEmpty() ||
      executionId.length() >
          MAX_EXECUTION_ID_LENGTH) {
    response["ok"] =
        false;

    response["message"] =
        "Invalid executionId";

    sendJson(
        request,
        400,
        response);

    return;
  }

  if (
      ownerId.isEmpty() ||
      ownerId.length() >
          MAX_OWNER_ID_LENGTH) {
    response["ok"] =
        false;

    response["message"] =
        "Invalid ownerId";

    sendJson(
        request,
        400,
        response);

    return;
  }

  if (
      message.length() >
      MAX_MESSAGE_LENGTH) {
    response["ok"] =
        false;

    response["message"] =
        "Script info message is too long";

    sendJson(
        request,
        413,
        response);

    return;
  }

  ScriptInfoEntry* entry =
      findEntry(
          executionId);

  if (message.isEmpty()) {
    /*
     * Normal cleanup is owner-safe: an old run is not allowed to erase a
     * newer run's message. `force` is used only when a new run starts, to
     * clear a stale message left behind by a crashed/disconnected browser.
     */
    if (
        entry &&
        (
            force ||
            entry->ownerId == ownerId
        )) {
      entry->clear();

      broadcastChange(
          executionId,
          ownerId,
          "");

      Logger::info(
          "Script info cleared: " +
          executionId);
    }

    response["ok"] =
        true;

    response["cleared"] =
        entry != nullptr;

    sendJson(
        request,
        200,
        response);

    return;
  }

  if (!entry) {
    entry =
        findFreeEntry();

    if (!entry) {
      response["ok"] =
          false;

      response["message"] =
          "Script info runtime store is full";

      sendJson(
          request,
          507,
          response);

      return;
    }
  }

  entry->executionId =
      executionId;

  entry->ownerId =
      ownerId;

  entry->message =
      message;

  broadcastChange(
      entry->executionId,
      entry->ownerId,
      entry->message);

  Logger::info(
      "Script info updated: " +
      executionId);

  response["ok"] =
      true;

  sendJson(
      request,
      200,
      response);
}

void ScriptInfoEndpoint::setupRoutes() {
  _events.onConnect(
      [this](
          AsyncEventSourceClient* client) {
        sendSnapshot(
            client);
      });

  _server.addHandler(
      &_events);

  _server.on(
      "/api/script-info",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        JsonDocument document;
        JsonArray items =
            document["items"].to<JsonArray>();

        for (const auto& entry : _entries) {
          if (!entry.active()) {
            continue;
          }

          JsonObject item =
              items.add<JsonObject>();

          item["executionId"] =
              entry.executionId;

          item["ownerId"] =
              entry.ownerId;

          item["message"] =
              entry.message;
        }

        sendJson(
            request,
            200,
            document);
      });

  auto* jsonHandler =
      new AsyncCallbackJsonWebHandler(
          "/api/script-info",
          [this](
              AsyncWebServerRequest* request,
              JsonVariant& json) {
            handlePost(
                request,
                json);
          });

  jsonHandler->setMethod(
      HTTP_POST);

  _server.addHandler(
      jsonHandler);
}
