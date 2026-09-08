#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>

#include "AutomationsEndpoint.h"
#include "DeviceConfigEndpoint.h"
#include "DccExBridge.h"
#include "HubConfigStore.h"
#include "ICommandCenter.h"
#include "LayoutRuntime.h"
#include "RuntimeStateStore.h"
#include "ScriptInfoEndpoint.h"
#include "WsProtocol.h"

class ApiServer {
public:
  // Existing constructor retained for source compatibility with ApiServer.cpp.
  ApiServer(
      uint16_t httpPort,
      AsyncWebSocket& ws,
      DccExBridge& dcc,
      LayoutRuntime& runtime,
      RuntimeStateStore& stateStore,
      HubConfigStore& config,
      WsProtocol& wsProtocol);

  // Generic constructor used by App/CommandCenterManager.
  ApiServer(
      uint16_t httpPort,
      AsyncWebSocket& ws,
      ICommandCenter& commandCenter,
      LayoutRuntime& runtime,
      RuntimeStateStore& stateStore,
      HubConfigStore& config,
      WsProtocol& wsProtocol)
      : _server(httpPort),
        _ws(ws),
        _dcc(commandCenter),
        _runtime(runtime),
        _stateStore(stateStore),
        _config(config),
        _wsProtocol(wsProtocol) {}

  void begin();

private:
  AsyncWebServer _server;

  AutomationsEndpoint _automationsEndpoint{
      _server};

  DeviceConfigEndpoint _deviceConfigEndpoint{
      _server};

  ScriptInfoEndpoint _scriptInfoEndpoint{
      _server};

  AsyncWebSocket& _ws;

  ICommandCenter& _dcc;
  LayoutRuntime& _runtime;
  RuntimeStateStore& _stateStore;
  HubConfigStore& _config;
  WsProtocol& _wsProtocol;

  File _layoutUpload;
  size_t _layoutUploadExpected = 0;
  size_t _layoutUploadWritten = 0;
  bool _layoutUploadFailed = false;

  File _locosUpload;
  size_t _locosUploadExpected = 0;
  size_t _locosUploadWritten = 0;
  bool _locosUploadFailed = false;

  File _signalLogicUpload;
  size_t _signalLogicUploadExpected = 0;
  size_t _signalLogicUploadWritten = 0;
  bool _signalLogicUploadFailed = false;

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
