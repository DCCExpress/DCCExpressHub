#pragma once

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <memory>

#include "ApiServer.h"
#include "CompiledCommandCenter.h"
#include "HubConfigStore.h"
#include "HubDisplay.h"
#include "LayoutRuntime.h"
#include "RuntimeStateStore.h"
#include "S88I2CMaster.h"
#include "SerialConfigurator.h"
#include "SignalAutomationEngine.h"
#include "WsProtocol.h"

class App {
public:
  void begin();
  void loop();

private:
  HubConfigStore _config;

  CompiledCommandCenter _commandCenter;

  LayoutRuntime _runtime;
  RuntimeStateStore _stateStore;
  HubDisplay _display;

  S88I2CMaster _s88I2c;

  bool _lastCommandCenterConnected = false;
  unsigned long _lastS88WsSnapshotAt = 0;

  AsyncWebSocket _ws{"/ws"};

  WsProtocol _wsProtocol{
      _ws,
      static_cast<ICommandCenter&>(
          _commandCenter),
      _runtime,
      _stateStore};

  SerialConfigurator _serialConfigurator{
      _config,
      static_cast<ICommandCenter&>(
          _commandCenter),
      _wsProtocol};

  std::unique_ptr<ApiServer>
      _apiServer;

  SignalAutomationEngine _signalAutomation{
      static_cast<ICommandCenter&>(
          _commandCenter),
      _runtime,
      _ws};

  void connectWifi();
  void loadConfiguration();
  void updateDisplay();

  void broadcastS88SensorChanged(
      uint16_t address,
      bool occupied);

  void broadcastS88Snapshot();
  void updateS88WebSocket();
};
