#pragma once

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <memory>

#include "ApiServer.h"
#include "CompiledCommandCenter.h"
#include "ConfiguredCommandCenter.h"
#include "HubConfigStore.h"
#include "HubDisplay.h"
#include "LayoutRuntime.h"
#include "LocoCounterRuntime.h"
#include "RuntimeStateStore.h"
#include "SerialConfigurator.h"
#include "SignalAutomationEngine.h"
#include "WsProtocol.h"

class App {
public:
  void begin();
  void loop();

private:
  HubConfigStore _config;

  CompiledCommandCenter _physicalCommandCenter;

  ConfiguredCommandCenter _commandCenter{
      static_cast<ICommandCenter&>(
          _physicalCommandCenter)};

  LayoutRuntime _runtime;
  RuntimeStateStore _stateStore;
  LocoCounterRuntime _locoCounters;
  HubDisplay _display;

  bool _lastCommandCenterConnected = false;

  AsyncWebSocket _ws{"/ws"};

  WsProtocol _wsProtocol{
      _ws,
      static_cast<ICommandCenter&>(
          _commandCenter),
      _runtime,
      _stateStore,
      _locoCounters};

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
};
