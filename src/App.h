#pragma once

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <Preferences.h>

#include "DccExBridge.h"
#include "LayoutRuntime.h"
#include "RuntimeStateStore.h"
#include "ApiServer.h"
#include "WsProtocol.h"

class App {
public:
  void begin();
  void loop();

private:
  Preferences _prefs;

  DccExBridge _dcc;
  LayoutRuntime _runtime;
  RuntimeStateStore _stateStore;

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

  void connectWifi();
  void loadConfiguration();
};
