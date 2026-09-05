#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "DccExBridge.h"
#include "HubConfigStore.h"
#include "WsProtocol.h"

class SerialConfigurator {
public:
  SerialConfigurator(
      HubConfigStore& config,
      DccExBridge& dcc,
      WsProtocol& wsProtocol)
      : _config(config),
        _dcc(dcc),
        _wsProtocol(wsProtocol) {}

  void begin();
  void loop();

private:
  static constexpr const char*
      RESPONSE_PREFIX = "@HUBCFG ";

  static constexpr size_t
      MAX_LINE_LENGTH = 1536;

  HubConfigStore& _config;
  DccExBridge& _dcc;
  WsProtocol& _wsProtocol;

  String _line;

  void processLine(
      String line);

  void processJson(
      JsonDocument& request);

  void processPlainCommand(
      const String& line);

  void sendResponse(
      JsonDocument& response);

  void sendError(
      JsonVariantConst id,
      const char* command,
      const String& message);

  void addStatus(
      JsonObject out);

  void addConfig(
      JsonObject out);

  bool parseNetworkSettings(
      JsonObjectConst data,
      HubNetworkSettings& settings,
      String& error);

  bool parseCommandCenterSettings(
      JsonObjectConst data,
      CommandCenterSettings& settings,
      String& error);

  static bool validHostname(
      const String& value);

  static bool validCommandCenterHost(
      const String& value);

  static bool validIp(
      const String& value,
      bool allowEmpty);

  static void copyRequestId(
      JsonDocument& response,
      JsonVariantConst requestId);
};
