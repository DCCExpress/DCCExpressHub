#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <functional>

#include "AutomationsEndpoint.h"
#include "DeviceConfigEndpoint.h"
#include "FileManagementEndpoint.h"
#include "FileStore.h"
#include "HubConfigStore.h"
#include "HubCapabilitiesEndpoint.h"
#include "ICommandCenter.h"
#include "JsSandboxEndpoint.h"
#include "LayoutRuntime.h"
#include "RuntimeStateStore.h"
#include "S88I2CMaster.h"
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
      S88I2CMaster& s88,
      SignalAutomationEngine& signalAutomation,
      std::function<bool()> onLocomotivesSaved = {})
      : _server(httpPort),
        _s88(s88),
        _automationsEndpoint(
            _server),
        _deviceConfigEndpoint(
            _server,
            _s88),
        _scriptInfoEndpoint(
            _server),
        _fileManagementEndpoint(
            _server),
        _hubCapabilitiesEndpoint(
            _server),
        _jsSandboxEndpoint(
            _server,
            commandCenter,
            runtime),
        _ws(ws),
        _dcc(commandCenter),
        _runtime(runtime),
        _stateStore(stateStore),
        _config(config),
        _wsProtocol(wsProtocol),
        _signalAutomation(signalAutomation),
        _onLocomotivesSaved(
            onLocomotivesSaved) {}

  void begin();

private:
  static constexpr const char* LAYOUT_PATH =
      "/config/layout.json";

  static constexpr const char* LOCOS_PATH =
      "/config/locos.json";

  static constexpr const char* SIGNAL_LOGIC_PATH =
      "/config/signal-logic.ndjson";

  AsyncWebServer _server;

  S88I2CMaster& _s88;

  AutomationsEndpoint _automationsEndpoint;
  DeviceConfigEndpoint _deviceConfigEndpoint;
  ScriptInfoEndpoint _scriptInfoEndpoint;
  FileManagementEndpoint _fileManagementEndpoint;
  HubCapabilitiesEndpoint _hubCapabilitiesEndpoint;
  JsSandboxEndpoint _jsSandboxEndpoint;

  AsyncWebSocket& _ws;

  ICommandCenter& _dcc;
  LayoutRuntime& _runtime;
  RuntimeStateStore& _stateStore;
  HubConfigStore& _config;
  WsProtocol& _wsProtocol;
  SignalAutomationEngine& _signalAutomation;

  std::function<bool()>
      _onLocomotivesSaved;

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
