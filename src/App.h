#pragma once

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <memory>

#include "ApiServer.h"
#include "DccExBridge.h"
#include "HubConfigStore.h"
#include "HubDisplay.h"
#include "LayoutRuntime.h"
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

  DccExBridge _dcc;
  LayoutRuntime _runtime;
  RuntimeStateStore _stateStore;
  HubDisplay _display;

  bool _lastCommandCenterConnected = false;

  AsyncWebSocket _ws{"/ws"};

  WsProtocol _wsProtocol{
      _ws,
      _dcc,
      _runtime,
      _stateStore};

  SerialConfigurator _serialConfigurator{
      _config,
      _dcc,
      _wsProtocol};

  std::unique_ptr<ApiServer>
      _apiServer;

  SignalAutomationEngine _signalAutomation{
      _dcc,
      _runtime,
      _ws};

  void connectWifi();
  void loadConfiguration();
  void updateDisplay();
};
