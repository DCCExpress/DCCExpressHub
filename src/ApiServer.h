#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>

#include "DccExBridge.h"
#include "LayoutRuntime.h"
#include "RuntimeStateStore.h"
#include "WsProtocol.h"

class ApiServer {
public:
  ApiServer(
      AsyncWebSocket& ws,
      DccExBridge& dcc,
      LayoutRuntime& runtime,
      RuntimeStateStore& stateStore,
      WsProtocol& wsProtocol);

  void begin();

private:
  AsyncWebServer _server{80};
  AsyncWebSocket& _ws;

  DccExBridge& _dcc;
  LayoutRuntime& _runtime;
  RuntimeStateStore& _stateStore;
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

  static const char* mimeFor(const String& path);
  static bool safePath(const String& path);
  static void sendFsFile(
      AsyncWebServerRequest* request,
      const String& path);
};
