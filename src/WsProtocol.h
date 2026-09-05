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
  void loop();
  void cleanupClients();

  void setPowerIncludesProgramming(
      bool value) {
    _powerIncludesProgramming = value;
  }

  bool powerIncludesProgramming() const {
    return _powerIncludesProgramming;
  }

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
  bool _powerIncludesProgramming = true;

  struct LocoState {
    uint16_t address = 0;
    uint8_t speed = 0;
    bool forward = true;
    uint32_t functionsMask = 0;
  };

  struct DccTrackState {
    bool configured = false;
    String mode;
    bool powerKnown = false;
    bool powerOn = false;
    int32_t currentMa = -1;
    int32_t tripMa = -1;
    bool overload = false;
  };

  static constexpr size_t MAX_LOCOS = 32;
  static constexpr uint8_t MAX_LOCO_FUNCTION = 28;
  static constexpr uint8_t MAX_DCC_TRACKS = 8;

  static constexpr unsigned long
      DCC_CURRENT_POLL_MS = 1000;

  static constexpr unsigned long
      HUB_STATUS_INTERVAL_MS = 1000;

  static constexpr unsigned long
      LOCO_STATE_SYNC_INTERVAL_MS = 25;

  LocoState _locos[MAX_LOCOS];
  size_t _locoCount = 0;

  uint16_t _locoSyncAddresses[MAX_LOCOS] = {};
  size_t _locoSyncCount = 0;
  size_t _locoSyncIndex = 0;
  unsigned long _nextLocoSyncAt = 0;

  DccTrackState _dccTracks[MAX_DCC_TRACKS];
  String _dccVersion;
  String _dccProcessor;
  String _dccHardware;
  String _dccBuild;
  uint16_t _dccMaxLocos = 0;
  bool _lastDccConnected = false;
  unsigned long _dccConnectedSinceAt = 0;
  unsigned long _dccCurrentUpdatedAt = 0;
  unsigned long _nextDccCurrentPollAt = 0;
  unsigned long _nextHubStatusAt = 0;

  uint8_t _wsClientCount = 0;

  void handleEvent(
      AsyncWebSocket* server,
      AsyncWebSocketClient* client,
      AwsEventType type,
      void* arg,
      uint8_t* data,
      size_t len);

  void handleMessage(
      AsyncWebSocketClient* client,
      const String& payload);

  void handleDccFrame(const String& frame);

  void send(
      AsyncWebSocketClient* client,
      const char* type,
      JsonVariantConst data);

  void broadcast(
      const char* type,
      JsonDocument& data);

  void sendCommandCenterInfo(
      AsyncWebSocketClient* client);

  void sendPowerInfo(
      AsyncWebSocketClient* client);

  void sendRuntimeSnapshot(
      AsyncWebSocketClient* client);

  void sendBlockStateSnapshot(
      AsyncWebSocketClient* client);

  void broadcastBlockStateSnapshot();

  void sendDccExStatus(
      AsyncWebSocketClient* client);

  void broadcastDccExStatus();
  void broadcastPowerInfo();

  void appendDccExStatus(
      JsonDocument& data);

  void appendHubStatus(
      JsonObject hub);

  void pollDccExTelemetry(
      unsigned long now);

  void handleDccConnectionState(
      unsigned long now);

  void beginConfiguredLocoStateSync(
      unsigned long now);

  void pollLocoStateSync(
      unsigned long now);

  bool requestLocoState(
      uint16_t address,
      bool logCommand = false);

  void recomputePowerStateFromTrackTelemetry();

  LocoState* getLoco(
      uint16_t address,
      bool create);

  void broadcastLoco(
      const LocoState& loco);
};
