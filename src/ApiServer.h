#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>

#include "AutomationsEndpoint.h"
#include "DeviceConfigEndpoint.h"
#include "FileManagementEndpoint.h"
#include "FileStore.h"
#include "HubConfigStore.h"
#include "ICommandCenter.h"
#include "LayoutRuntime.h"
#include "RuntimeStateStore.h"
#include "ScriptInfoEndpoint.h"
#include "SignalAutomationEngine.h"
#include "WsProtocol.h"

class ApiServer {
public:
  ApiServer(
      uint16_t httpPort,
      AsyncWebSocket& ws,
      ICommandCenter& commandCenter,
      LayoutRuntime& runtime,
      RuntimeStateStore& stateStore,
      HubConfigStore& config,
      WsProtocol& wsProtocol,
      SignalAutomationEngine& signalAutomation)
      : _server(httpPort),
        _ws(ws),
        _dcc(commandCenter),
        _runtime(runtime),
        _stateStore(stateStore),
        _config(config),
        _wsProtocol(wsProtocol),
        _signalAutomation(signalAutomation) {}

  void begin();

private:
  static constexpr const char* LAYOUT_PATH =
      "/config/layout.json";

  static constexpr const char* LOCOS_PATH =
      "/config/locos.json";

  static constexpr const char* SIGNAL_LOGIC_PATH =
      "/config/signal-logic.ndjson";

  AsyncWebServer _server;

  AutomationsEndpoint _automationsEndpoint{
      _server};

  DeviceConfigEndpoint _deviceConfigEndpoint{
      _server};

  ScriptInfoEndpoint _scriptInfoEndpoint{
      _server};

  FileManagementEndpoint _fileManagementEndpoint{
      _server};

  AsyncWebSocket& _ws;

  ICommandCenter& _dcc;
  LayoutRuntime& _runtime;
  RuntimeStateStore& _stateStore;
  HubConfigStore& _config;
  WsProtocol& _wsProtocol;
  SignalAutomationEngine& _signalAutomation;

  FileStore _files{
      LittleFS};

  AtomicFileUpload _layoutUpload;
  AtomicFileUpload _locosUpload;
  AtomicFileUpload _signalLogicUpload;

  void setupApi();
  void setupStaticFiles();

  void handleLayoutBody(
      AsyncWebServerRequest* request,
      uint8_t* data,
      size_t len,
      size_t index,
      size_t total);

  void handleLocosBody(
      AsyncWebServerRequest* request,
      uint8_t* data,
      size_t len,
      size_t index,
      size_t total);

  void handleSignalLogicBody(
      AsyncWebServerRequest* request,
      uint8_t* data,
      size_t len,
      size_t index,
      size_t total);

  bool verifyLocosTemp();
  bool verifySignalLogicTemp();

  static void sendJson(
      AsyncWebServerRequest* request,
      int code,
      JsonDocument& doc);

  static const char* mimeFor(
      const String& path);

  static bool safePath(
      const String& path);

  static void sendFsFile(
      AsyncWebServerRequest* request,
      const String& path);
};
