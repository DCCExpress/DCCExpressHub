#pragma once

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <Preferences.h>

#include "DccExBridge.h"
#include "LayoutRuntime.h"
#include "RuntimeStateStore.h"
#include "ApiServer.h"
#include "WsProtocol.h"
#include "HubDisplay.h"
#include "SignalAutomationEngine.h"

class App {
public:
  void begin();
  void loop();

private:
  Preferences _prefs;
  DccExBridge _dcc;
  LayoutRuntime _runtime;
  RuntimeStateStore _stateStore;
  HubDisplay _display;

  String _commandCenterHost;
  uint16_t _commandCenterPort = 0;
  bool _lastCommandCenterConnected = false;

  AsyncWebSocket _ws{"/ws"};

  WsProtocol _wsProtocol{
      _ws,
      _dcc,
      _runtime,
      _stateStore};

  ApiServer _apiServer{
      _ws,
      _dcc,
      _runtime,
      _stateStore,
      _wsProtocol};

  SignalAutomationEngine _signalAutomation{
      _dcc,
      _runtime,
      _ws};

  void connectWifi();
  void loadConfiguration();
  void updateDisplay();
};
