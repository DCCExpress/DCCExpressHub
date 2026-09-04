#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>

#include "DccExBridge.h"
#include "LayoutRuntime.h"
#include "RuntimeStateStore.h"

class WsProtocol {
public:
  WsProtocol(
      AsyncWebSocket& ws,
      DccExBridge& dcc,
      LayoutRuntime& runtime,
      RuntimeStateStore& stateStore);

  void begin();
  void cleanupClients();

  void broadcastRuntimeSnapshot();
  void broadcastRawInfo(const String& raw);

private:
  AsyncWebSocket& _ws;
  DccExBridge& _dcc;
  LayoutRuntime& _runtime;
  RuntimeStateStore& _stateStore;

  bool _trackPower = false;
  bool _programmingPower = false;
  bool _emergencyStop = false;

  struct LocoState {
    uint16_t address = 0;
    uint8_t speed = 0;
    bool forward = true;
  };
  static constexpr size_t MAX_LOCOS = 32;
  LocoState _locos[MAX_LOCOS];
  size_t _locoCount = 0;

  void handleEvent(
      AsyncWebSocket* server,
      AsyncWebSocketClient* client,
      AwsEventType type,
      void* arg,
      uint8_t* data,
      size_t len);

  void handleMessage(AsyncWebSocketClient* client, const String& payload);
  void handleDccFrame(const String& frame);

  void send(AsyncWebSocketClient* client, const char* type, JsonVariantConst data);
  void broadcast(const char* type, JsonDocument& data);

  void sendCommandCenterInfo(AsyncWebSocketClient* client);
  void sendPowerInfo(AsyncWebSocketClient* client);
  void sendRuntimeSnapshot(AsyncWebSocketClient* client);
  void broadcastPowerInfo();

  LocoState* getLoco(uint16_t address, bool create);
  void broadcastLoco(const LocoState& loco);
};
