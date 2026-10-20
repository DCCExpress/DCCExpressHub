#include <Arduino.h>
#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "AccessoryRuntime.h"
#include "ICommandCenter.h"
#include "MockCommandCenter.h"
#include "DccExSerialCommandCenter.h"

// TEST BENCH ONLY: fixed AP password, plain WS, no authentication.
static constexpr char AP_SSID[] = "Hub-ESP32-Test";
static constexpr char AP_PASS[] = "hub-test-1234";
static constexpr size_t MaxMessage = 256;
static constexpr size_t MaxIncomingCommands = 32;

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");
AccessoryRuntime runtime;
#ifndef HUB_USE_DCCEX_SERIAL
#define HUB_USE_DCCEX_SERIAL 0
#endif
#ifndef HUB_DCCEX_RX_PIN
#define HUB_DCCEX_RX_PIN 17
#endif
#ifndef HUB_DCCEX_TX_PIN
#define HUB_DCCEX_TX_PIN 18
#endif
HardwareSerial ccSerial(1);
MockCommandCenter mockCC;
DccExSerialCommandCenter dccExCC(ccSerial,HUB_DCCEX_RX_PIN,HUB_DCCEX_TX_PIN,115200);
ICommandCenter* commandCenter =
#if HUB_USE_DCCEX_SERIAL
  &dccExCC;
#else
  &mockCC;
#endif
void onFeedback(void* context,uint16_t address,bool raw) {
  static_cast<AccessoryRuntime*>(context)->UpdateFromHardware(address,raw);
}


// Network callbacks may execute outside Arduino loop().
// They enqueue compact requests; only loop() reads/writes Runtime.
enum class Action : uint8_t { Snapshot, Set, Feedback, Configure, Invalidate };
struct Incoming {
  Action action;
  uint32_t clientId;
  uint16_t address;
  bool value;
};
QueueHandle_t incoming;

const char* stateName(BinaryState s) {
  return s == BinaryState::On ? "on" :
         s == BinaryState::Off ? "off" : "unknown";
}

bool enqueue(const Incoming& in) {
  return xQueueSend(incoming, &in, 0) == pdTRUE;
}

void sendError(uint32_t clientId, const char* reason) {
  AsyncWebSocketClient* c = ws.client(clientId);
  if (!c || !c->canSend()) return;
  JsonDocument doc;
  doc["type"] = "error";
  doc["reason"] = reason;
  String json; serializeJson(doc, json);
  c->text(json);
}

void sendSnapshot(uint32_t clientId) {
  AsyncWebSocketClient* c = ws.client(clientId);
  if (!c || !c->canSend()) return;
  JsonDocument doc;
  doc["type"] = "snapshot";
  doc["commandCenter"] = commandCenter->name();
  doc["ccConnected"] = commandCenter->connected();
  doc["sequence"] = runtime.sequence();
  doc["overflow"] = runtime.overflowed();
  JsonArray arr = doc["accessories"].to<JsonArray>();
  for (size_t i=0; i<runtime.count(); ++i) {
    uint16_t address;
    if (!runtime.addressAt(i, address)) continue;
    AccessoryConfig config;
    if (!runtime.GetConfig(address, config)) continue;
    JsonObject a = arr.add<JsonObject>();
    a["address"] = address;
    a["inverted"] = config.inverted;
    a["state"] = stateName(runtime.GetValue(address));
  }
  String json; serializeJson(doc, json);
  c->text(json);
}

void sendChanged(const AccessoryChanged& e) {
  JsonDocument doc;
  doc["type"] = "accessory.changed";
  doc["address"] = e.address;
  doc["value"] = stateName(e.value);
  doc["sequence"] = e.sequence;
  String json; serializeJson(doc, json);
  ws.textAll(json);
}

// Strict small JSON messages and fixed command queue prevent runtime mutation
// on the async network task. Reject fragmented frames for this prototype.
void onWsEvent(AsyncWebSocket* serverPtr, AsyncWebSocketClient* client,
               AwsEventType type, void* arg, uint8_t* data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    enqueue({Action::Snapshot, client->id(), 0, false});
    return;
  }
  if (type != WS_EVT_DATA) return;

  auto* info = static_cast<AwsFrameInfo*>(arg);
  if (!info || !info->final || info->index != 0 ||
      info->len != len || info->opcode != WS_TEXT || len > MaxMessage) {
    sendError(client->id(), "invalid_frame");
    return;
  }
  JsonDocument msg;
  if (deserializeJson(msg, data, len)) {
    sendError(client->id(), "invalid_json");
    return;
  }
  const char* action = msg["type"] | "";
  if (strcmp(action, "snapshot.get") == 0) {
    if (!enqueue({Action::Snapshot, client->id(), 0, false}))
      sendError(client->id(), "queue_full");
    return;
  }
  Action op;
  if (strcmp(action, "accessory.set") == 0) op = Action::Set;
  else if (strcmp(action, "accessory.feedback") == 0) op = Action::Feedback;
  else if (strcmp(action, "accessory.config") == 0) op = Action::Configure;
  else if (strcmp(action, "accessory.invalidate") == 0) op = Action::Invalidate;
  else { sendError(client->id(), "unknown_command"); return; }

  if (!msg["address"].is<uint16_t>()) {
    sendError(client->id(), "invalid_address");
    return;
  }
  uint16_t addr = msg["address"].as<uint16_t>();
  const char* key = op == Action::Feedback ? "raw" :
                    op == Action::Configure ? "inverted" : "value";
  bool value = false;
  if (op != Action::Invalidate) {
    if (!msg[key].is<bool>()) {sendError(client->id(), "invalid_value");return;}
    value = msg[key].as<bool>();
  }
  if (!enqueue({op, client->id(), addr, value}))
    sendError(client->id(), "queue_full");
}

void processIncoming() {
  Incoming cmd;
  while (xQueueReceive(incoming, &cmd, 0) == pdTRUE) {
    bool ok = false;
    switch (cmd.action) {
      case Action::Snapshot: sendSnapshot(cmd.clientId); continue;
      case Action::Set: ok = runtime.SetValue(cmd.address, cmd.value); break;
      case Action::Feedback: ok = runtime.UpdateFromHardware(cmd.address, cmd.value); break;
      case Action::Configure: ok = runtime.SetConfig({cmd.address, cmd.value}); break;
      case Action::Invalidate: ok = runtime.Invalidate(cmd.address); break;
    }
    if (!ok) {sendError(cmd.clientId, "operation_rejected");continue;}
    // Acknowledge acceptance, not physical execution.
    AsyncWebSocketClient* c = ws.client(cmd.clientId);
    if (c && c->canSend()) c->text("{\"type\":\"accepted\"}");
    if (cmd.action == Action::Configure) sendSnapshot(cmd.clientId);
  }
}

void processCommandCenter() {
  commandCenter->loop();
  AccessoryCommand c;
  if (!runtime.peekCommand(c)) return;
  if (!commandCenter->connected()) return;
  if (commandCenter->sendAccessory(c.address,c.rawValue)) {
    AccessoryCommand discarded;
    runtime.popCommand(discarded);
  }
}

void processEvents() {
  AccessoryChanged e;
  while (runtime.popEvent(e)) {
    Serial.printf("[Changed] address=%u value=%s seq=%lu\n",
      e.address, stateName(e.value), (unsigned long)e.sequence);
    sendChanged(e);
  }
  if (runtime.overflowed()) {
    // Never silently pretend that consumers received all transitions.
    static bool warned = false;
    if (!warned) {
      warned = true;
      ws.textAll("{\"type\":\"resync.required\"}");
      Serial.println("[SAFETY] Event overflow: automatic operation forbidden");
    }
  }
}

void setup() {
  Serial.begin(115200);
  incoming = xQueueCreate(MaxIncomingCommands, sizeof(Incoming));
  if (!incoming) { Serial.println("Queue allocation failed"); abort(); }
  runtime.SetConfig({20, true});
  runtime.SetConfig({21, false});
  commandCenter->onAccessoryFeedback(onFeedback,&runtime);
  commandCenter->begin();
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  server.on("/api/health", HTTP_GET, [](AsyncWebServerRequest* request) {
    request->send(200, "application/json", "{\"status\":\"ok\",\"mode\":\"mock\"}");
  });
  server.begin();
  Serial.printf("AP %s at %s ; ws://192.168.4.1/ws\n",
      AP_SSID, WiFi.softAPIP().toString().c_str());
}

void loop() {
  processIncoming();
  processCommandCenter();
  processEvents();
  ws.cleanupClients();
  delay(1);
}
