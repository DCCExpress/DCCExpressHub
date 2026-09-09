#include "SerialConfigurator.h"

#include <WiFi.h>
#include <ESP.h>
#include <ctype.h>
#include <stdlib.h>

#include "CommandCenterEndpoint.h"
#include "Logger.h"

namespace {

void skipSpaces(const String& text, size_t& position) {
  while (
      position < text.length() &&
      isspace(static_cast<unsigned char>(text.charAt(position)))
  ) {
    ++position;
  }
}

bool parseAngleToken(
    const String& text,
    size_t& position,
    String& value,
    String& error) {
  skipSpaces(text, position);

  if (position >= text.length()) {
    error = "Missing argument";
    return false;
  }

  value = "";

  if (text.charAt(position) == '"') {
    ++position;
    bool escaped = false;

    while (position < text.length()) {
      const char c = text.charAt(position++);

      if (escaped) {
        if (c == '"' || c == '\\') {
          value += c;
        } else if (c == 'n') {
          value += '\n';
        } else if (c == 'r') {
          value += '\r';
        } else if (c == 't') {
          value += '\t';
        } else {
          value += c;
        }

        escaped = false;
        continue;
      }

      if (c == '\\') {
        escaped = true;
        continue;
      }

      if (c == '"') {
        return true;
      }

      value += c;
    }

    error = "Unterminated quoted argument";
    return false;
  }

  const size_t start = position;

  while (
      position < text.length() &&
      !isspace(static_cast<unsigned char>(text.charAt(position)))
  ) {
    ++position;
  }

  value = text.substring(start, position);

  if (value.isEmpty()) {
    error = "Missing argument";
    return false;
  }

  return true;
}

bool parsePort(const String& text, uint16_t& port) {
  if (text.isEmpty()) {
    return false;
  }

  char* end = nullptr;
  const long parsed = strtol(text.c_str(), &end, 10);

  if (
      end == text.c_str() ||
      *end != '\0' ||
      parsed < 1 ||
      parsed > 65535
  ) {
    return false;
  }

  port = static_cast<uint16_t>(parsed);
  return true;
}

String upperCopy(String value) {
  value.toUpperCase();
  return value;
}

}

void SerialConfigurator::begin() {
  _line.reserve(MAX_LINE_LENGTH);

  Logger::info("Serial configurator ready");

  Serial.println(
      "@HUBCFG {\"type\":\"ready\",\"protocol\":1,\"name\":\"DCCExpressHub\"}");
}

void SerialConfigurator::loop() {
  while (Serial.available()) {
    const char c = static_cast<char>(Serial.read());

    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      if (!_line.isEmpty()) {
        processLine(_line);
        _line.clear();
      }

      continue;
    }

    if (_line.length() >= MAX_LINE_LENGTH) {
      _line.clear();

      JsonDocument response;
      response["ok"] = false;
      response["message"] = "Serial command line too long";
      sendResponse(response);
      continue;
    }

    _line += c;
  }
}

void SerialConfigurator::copyRequestId(
    JsonDocument& response,
    JsonVariantConst requestId) {
  if (!requestId.isNull()) {
    response["id"].set(requestId);
  }
}

void SerialConfigurator::sendResponse(JsonDocument& response) {
  String json;
  serializeJson(response, json);

  Serial.print(RESPONSE_PREFIX);
  Serial.println(json);
}

void SerialConfigurator::sendError(
    JsonVariantConst id,
    const char* command,
    const String& message) {
  JsonDocument response;

  copyRequestId(response, id);

  response["ok"] = false;

  if (command && *command) {
    response["cmd"] = command;
  }

  response["message"] = message;
  sendResponse(response);
}

bool SerialConfigurator::validHostname(const String& value) {
  if (value.isEmpty() || value.length() > 63) {
    return false;
  }

  if (
      value.charAt(0) == '-' ||
      value.charAt(value.length() - 1) == '-'
  ) {
    return false;
  }

  for (size_t index = 0; index < value.length(); ++index) {
    const char c = value.charAt(index);

    const bool ok =
        (c >= 'a' && c <= 'z') ||
        (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') ||
        c == '-';

    if (!ok) {
      return false;
    }
  }

  return true;
}

bool SerialConfigurator::validCommandCenterHost(const String& value) {
  if (value.isEmpty() || value.length() > 253) {
    return false;
  }

  // IP addresses and DNS/mDNS host names (for example dccex.local)
  // are intentionally accepted here.
  for (size_t index = 0; index < value.length(); ++index) {
    const char c = value.charAt(index);

    if (
        static_cast<uint8_t>(c) <= 32 ||
        c == '/' ||
        c == '\\' ||
        c == ':' ||
        c == '<' ||
        c == '>' ||
        c == '"' ||
        c == '\''
    ) {
      return false;
    }
  }

  return true;
}

bool SerialConfigurator::validIp(
    const String& value,
    bool allowEmpty) {
  if (value.isEmpty()) {
    return allowEmpty;
  }

  IPAddress parsed;
  return parsed.fromString(value);
}

bool SerialConfigurator::parseNetworkSettings(
    JsonObjectConst data,
    HubNetworkSettings& settings,
    String& error) {
  settings = _config.network();

  if (!data["ssid"].isNull()) {
    settings.wifiSsid = data["ssid"].as<String>();
    settings.wifiSsid.trim();
  }

  if (!data["password"].isNull()) {
    settings.wifiPassword = data["password"].as<String>();
  }

  if (data["clearPassword"] | false) {
    settings.wifiPassword = "";
  }

  if (!data["hostname"].isNull()) {
    settings.hostname = data["hostname"].as<String>();
    settings.hostname.trim();
  }

  if (!data["dhcp"].isNull()) {
    settings.dhcp = data["dhcp"].as<bool>();
  }

  if (!data["ip"].isNull()) {
    settings.ip = data["ip"].as<String>();
    settings.ip.trim();
  }

  if (!data["gateway"].isNull()) {
    settings.gateway = data["gateway"].as<String>();
    settings.gateway.trim();
  }

  if (!data["subnet"].isNull()) {
    settings.subnet = data["subnet"].as<String>();
    settings.subnet.trim();
  }

  if (!data["dns1"].isNull()) {
    settings.dns1 = data["dns1"].as<String>();
    settings.dns1.trim();
  }

  if (!data["dns2"].isNull()) {
    settings.dns2 = data["dns2"].as<String>();
    settings.dns2.trim();
  }

  if (!data["httpPort"].isNull()) {
    const long port = data["httpPort"].as<long>();

    if (port < 1 || port > 65535) {
      error = "Hub HTTP/WS port must be between 1 and 65535";
      return false;
    }

    settings.httpPort = static_cast<uint16_t>(port);
  }

  if (settings.wifiSsid.isEmpty()) {
    error = "Wi-Fi SSID is required";
    return false;
  }

  if (!validHostname(settings.hostname)) {
    error = "Hub hostname must contain only letters, digits and hyphens";
    return false;
  }

  if (!settings.dhcp) {
    if (
        !validIp(settings.ip, false) ||
        !validIp(settings.gateway, false) ||
        !validIp(settings.subnet, false) ||
        !validIp(settings.dns1, true) ||
        !validIp(settings.dns2, true)
    ) {
      error = "Invalid static IPv4 network settings";
      return false;
    }
  }

  return true;
}

bool SerialConfigurator::parseCommandCenterSettings(
    JsonObjectConst data,
    CommandCenterSettings& settings,
    String& error) {
  settings = _config.commandCenter();

  if (!data["host"].isNull()) {
    settings.host = data["host"].as<String>();
    settings.host.trim();
  }

  if (!data["port"].isNull()) {
    const long port = data["port"].as<long>();

    if (port < 1 || port > 65535) {
      error = "DCC-EX port must be between 1 and 65535";
      return false;
    }

    settings.port = static_cast<uint16_t>(port);
  }

  if (!data["powerIncludesProgramming"].isNull()) {
    settings.powerIncludesProgramming =
        data["powerIncludesProgramming"].as<bool>();
  }

  if (!validCommandCenterHost(settings.host)) {
    error = "Invalid DCC-EX host name or IP address";
    return false;
  }

  return true;
}

void SerialConfigurator::addStatus(JsonObject out) {
  out["wifiConnected"] = WiFi.status() == WL_CONNECTED;
  out["wifiSsid"] = WiFi.SSID();
  out["wifiIp"] = WiFi.localIP().toString();
  out["wifiGateway"] = WiFi.gatewayIP().toString();
  out["wifiSubnet"] = WiFi.subnetMask().toString();
  out["wifiDns"] = WiFi.dnsIP().toString();
  out["wifiRssiDbm"] = WiFi.RSSI();
  out["wifiMac"] = WiFi.macAddress();
  out["hubHostname"] = _config.network().hostname;
  out["hubHttpPort"] = _config.network().httpPort;
  out["hubUptimeMs"] = millis();
  out["hubFreeHeapBytes"] = ESP.getFreeHeap();

  out["csbHost"] = _dcc.host();
  out["csbPort"] = _dcc.port();
  out["csbConnected"] = _dcc.connected();

  IPAddress resolved;

  if (
      WiFi.status() == WL_CONNECTED &&
      resolveCommandCenterHost(_dcc.host(), resolved, 500)
  ) {
    out["csbResolvedIp"] = resolved.toString();
  } else {
    out["csbResolvedIp"] = "";
  }
}

void SerialConfigurator::addConfig(JsonObject out) {
  const auto& network = _config.network();

  JsonObject networkOut = out["network"].to<JsonObject>();

  networkOut["ssid"] = network.wifiSsid;

  // Generic JSON config intentionally does not expose the password.
  // The physical serial-only <WIFI?> and <STATUS?> commands do.
  networkOut["passwordStored"] = _config.wifiPasswordStored();

  networkOut["hostname"] = network.hostname;
  networkOut["dhcp"] = network.dhcp;
  networkOut["ip"] = network.ip;
  networkOut["gateway"] = network.gateway;
  networkOut["subnet"] = network.subnet;
  networkOut["dns1"] = network.dns1;
  networkOut["dns2"] = network.dns2;
  networkOut["httpPort"] = network.httpPort;

  const auto& commandCenter = _config.commandCenter();

  JsonObject csb = out["commandCenter"].to<JsonObject>();

  csb["host"] = commandCenter.host;
  csb["port"] = commandCenter.port;
  csb["powerIncludesProgramming"] =
      commandCenter.powerIncludesProgramming;
}

void SerialConfigurator::processJson(JsonDocument& request) {
  const char* command = request["cmd"] | "";
  const JsonVariantConst id = request["id"];
  const JsonObjectConst data = request["data"].as<JsonObjectConst>();

  if (strcmp(command, "hello") == 0) {
    JsonDocument response;

    copyRequestId(response, id);

    response["ok"] = true;
    response["cmd"] = "hello";
    response["protocol"] = 1;
    response["name"] = "DCCExpressHub";
    response["firmwareSerialConfig"] = true;

    sendResponse(response);
    return;
  }

  if (strcmp(command, "getConfig") == 0) {
    JsonDocument response;

    copyRequestId(response, id);

    response["ok"] = true;
    response["cmd"] = "getConfig";

    JsonObject config = response["config"].to<JsonObject>();
    addConfig(config);

    sendResponse(response);
    return;
  }

  if (strcmp(command, "status") == 0) {
    JsonDocument response;

    copyRequestId(response, id);

    response["ok"] = true;
    response["cmd"] = "status";

    JsonObject status = response["status"].to<JsonObject>();
    addStatus(status);

    sendResponse(response);
    return;
  }

  if (strcmp(command, "setNetwork") == 0) {
    HubNetworkSettings settings;
    String error;

    if (!parseNetworkSettings(data, settings, error)) {
      sendError(id, command, error);
      return;
    }

    const bool ok = _config.saveNetwork(settings);

    JsonDocument response;

    copyRequestId(response, id);

    response["ok"] = ok;
    response["cmd"] = "setNetwork";
    response["restartRequired"] = true;

    if (!ok) {
      response["message"] =
          "One or more network settings could not be persisted";
    }

    sendResponse(response);
    return;
  }

  if (strcmp(command, "setCommandCenter") == 0) {
    CommandCenterSettings settings;
    String error;

    if (!parseCommandCenterSettings(data, settings, error)) {
      sendError(id, command, error);
      return;
    }

    const bool persisted = _config.saveCommandCenter(settings);

    _wsProtocol.setPowerIncludesProgramming(
        settings.powerIncludesProgramming);

    const bool endpointChanged =
        settings.host != _dcc.host() ||
        settings.port != _dcc.port();

    if (endpointChanged) {
      _dcc.setEndpoint(settings.host, settings.port);
    }

    _wsProtocol.broadcastRuntimeSnapshot();

    JsonDocument response;

    copyRequestId(response, id);

    response["ok"] = persisted;
    response["cmd"] = "setCommandCenter";
    response["applied"] = true;

    if (!persisted) {
      response["message"] =
          "DCC-EX settings were applied but persistence reported an error";
    }

    sendResponse(response);
    return;
  }

  if (strcmp(command, "testCommandCenter") == 0) {
    CommandCenterSettings settings = _config.commandCenter();
    String error;

    if (
        !data.isNull() &&
        !parseCommandCenterSettings(data, settings, error)
    ) {
      sendError(id, command, error);
      return;
    }

    const CommandCenterProbeResult probe =
        probeDccExEndpoint(settings.host, settings.port);

    JsonDocument response;

    copyRequestId(response, id);

    response["ok"] = probe.dccExAlive;
    response["cmd"] = "testCommandCenter";
    response["resolved"] = probe.resolved;
    response["resolvedIp"] =
        probe.resolved ? probe.resolvedAddress.toString() : "";
    response["tcpConnected"] = probe.tcpConnected;
    response["dccExAlive"] = probe.dccExAlive;
    response["reply"] = probe.reply;
    response["elapsedMs"] = probe.elapsedMs;

    sendResponse(response);
    return;
  }

  if (strcmp(command, "dcc") == 0) {
    String raw = data["command"] | "";
    raw.trim();

    if (raw.isEmpty()) {
      sendError(id, command, "Missing DCC-EX command");
      return;
    }

    const bool sent = _dcc.sendCommand(raw);

    JsonDocument response;

    copyRequestId(response, id);

    response["ok"] = sent;
    response["cmd"] = "dcc";
    response["sent"] = raw;

    sendResponse(response);
    return;
  }

  if (strcmp(command, "restart") == 0) {
    JsonDocument response;

    copyRequestId(response, id);

    response["ok"] = true;
    response["cmd"] = "restart";
    response["message"] = "Restarting Hub";

    sendResponse(response);

    Serial.flush();
    delay(150);
    ESP.restart();
    return;
  }

  if (strcmp(command, "help") == 0) {
    JsonDocument response;

    copyRequestId(response, id);

    response["ok"] = true;
    response["cmd"] = "help";

    JsonArray commands = response["commands"].to<JsonArray>();

    commands.add("hello");
    commands.add("getConfig");
    commands.add("status");
    commands.add("setNetwork");
    commands.add("setCommandCenter");
    commands.add("testCommandCenter");
    commands.add("dcc");
    commands.add("restart");

    JsonArray angleCommands = response["angleCommands"].to<JsonArray>();

    angleCommands.add("<STATUS?>");
    angleCommands.add("<WIFI \"ssid\" \"password\">");
    angleCommands.add("<WIFI?>");
    angleCommands.add("<DCCEX \"host-or-ip\" 2560>");
    angleCommands.add("<DCCEX?>");
    angleCommands.add("<RESTART>");
    angleCommands.add("<HELP?>");

    sendResponse(response);
    return;
  }

  sendError(
      id,
      command,
      String("Unknown command: ") + command);
}

void SerialConfigurator::processPlainCommand(
    const String& rawLine) {
  String line = rawLine;
  line.trim();

  if (line.startsWith("<") && line.endsWith(">")) {
    String inner = line.substring(1, line.length() - 1);
    inner.trim();

    const String upper = upperCopy(inner);

    if (upper == "STATUS?") {
      const auto& network = _config.network();
      const auto& commandCenter = _config.commandCenter();

      JsonDocument response;
      response["ok"] = true;
      response["cmd"] = "STATUS?";

      JsonObject wifi = response["wifi"].to<JsonObject>();

      wifi["ssid"] = network.wifiSsid;
      wifi["password"] = network.wifiPassword;
      wifi["connected"] = WiFi.status() == WL_CONNECTED;
      wifi["ip"] = WiFi.localIP().toString();
      wifi["gateway"] = WiFi.gatewayIP().toString();
      wifi["subnet"] = WiFi.subnetMask().toString();
      wifi["dns"] = WiFi.dnsIP().toString();
      wifi["rssiDbm"] = WiFi.RSSI();
      wifi["mac"] = WiFi.macAddress();
      wifi["hostname"] = network.hostname;
      wifi["httpPort"] = network.httpPort;
      wifi["dhcp"] = network.dhcp;

      JsonObject dccEx = response["dccEx"].to<JsonObject>();

      dccEx["host"] = commandCenter.host;
      dccEx["port"] = commandCenter.port;
      dccEx["connected"] = _dcc.connected();
      dccEx["powerIncludesProgramming"] =
          commandCenter.powerIncludesProgramming;

      IPAddress resolved;

      if (
          WiFi.status() == WL_CONNECTED &&
          resolveCommandCenterHost(
              commandCenter.host,
              resolved,
              500)
      ) {
        dccEx["resolvedIp"] = resolved.toString();
      } else {
        dccEx["resolvedIp"] = "";
      }

      JsonObject hub = response["hub"].to<JsonObject>();
      hub["uptimeMs"] = millis();
      hub["freeHeapBytes"] = ESP.getFreeHeap();

      sendResponse(response);
      return;
    }

    if (upper == "WIFI?") {
      const auto& network = _config.network();

      JsonDocument response;
      response["ok"] = true;
      response["cmd"] = "WIFI?";
      response["ssid"] = network.wifiSsid;
      response["password"] = network.wifiPassword;
      response["connected"] = WiFi.status() == WL_CONNECTED;
      response["ip"] = WiFi.localIP().toString();
      response["hostname"] = network.hostname;
      response["restartRequired"] = false;

      sendResponse(response);
      return;
    }

    if (upper == "DCCEX?") {
      const auto& commandCenter = _config.commandCenter();

      JsonDocument response;
      response["ok"] = true;
      response["cmd"] = "DCCEX?";
      response["host"] = commandCenter.host;
      response["port"] = commandCenter.port;
      response["connected"] = _dcc.connected();
      response["powerIncludesProgramming"] =
          commandCenter.powerIncludesProgramming;

      IPAddress resolved;

      if (
          WiFi.status() == WL_CONNECTED &&
          resolveCommandCenterHost(
              commandCenter.host,
              resolved,
              500)
      ) {
        response["resolvedIp"] = resolved.toString();
      } else {
        response["resolvedIp"] = "";
      }

      sendResponse(response);
      return;
    }

    if (upper == "RESTART") {
      JsonDocument request;
      request["cmd"] = "restart";
      processJson(request);
      return;
    }

    if (upper == "HELP?") {
      JsonDocument request;
      request["cmd"] = "help";
      processJson(request);
      return;
    }

    const int firstSpace = inner.indexOf(' ');

    const String command =
        upperCopy(
            firstSpace < 0
                ? inner
                : inner.substring(0, firstSpace));

    String arguments =
        firstSpace < 0
            ? ""
            : inner.substring(firstSpace + 1);

    arguments.trim();

    if (command == "WIFI") {
      size_t position = 0;

      String ssid;
      String password;
      String error;

      if (
          !parseAngleToken(
              arguments,
              position,
              ssid,
              error) ||
          !parseAngleToken(
              arguments,
              position,
              password,
              error)
      ) {
        JsonDocument response;
        response["ok"] = false;
        response["cmd"] = "WIFI";
        response["message"] =
            error +
            ". Syntax: <WIFI \"ssid\" \"password\">";
        sendResponse(response);
        return;
      }

      skipSpaces(arguments, position);

      if (position != arguments.length()) {
        JsonDocument response;
        response["ok"] = false;
        response["cmd"] = "WIFI";
        response["message"] =
            "Unexpected extra argument. Syntax: "
            "<WIFI \"ssid\" \"password\">";
        sendResponse(response);
        return;
      }

      JsonDocument input;
      input["ssid"] = ssid;
      input["password"] = password;

      HubNetworkSettings settings;
      String validationError;

      if (
          !parseNetworkSettings(
              input.as<JsonObjectConst>(),
              settings,
              validationError)
      ) {
        JsonDocument response;
        response["ok"] = false;
        response["cmd"] = "WIFI";
        response["message"] = validationError;
        sendResponse(response);
        return;
      }

      const bool ok = _config.saveNetwork(settings);

      JsonDocument response;
      response["ok"] = ok;
      response["cmd"] = "WIFI";
      response["ssid"] = settings.wifiSsid;
      response["restartRequired"] = true;

      if (!ok) {
        response["message"] =
            "Wi-Fi settings could not be persisted";
      }

      sendResponse(response);
      return;
    }

    if (command == "DCCEX") {
      size_t position = 0;

      String host;
      String portText;
      String error;

      if (
          !parseAngleToken(
              arguments,
              position,
              host,
              error) ||
          !parseAngleToken(
              arguments,
              position,
              portText,
              error)
      ) {
        JsonDocument response;
        response["ok"] = false;
        response["cmd"] = "DCCEX";
        response["message"] =
            error +
            ". Syntax: <DCCEX \"host-or-ip\" 2560>";
        sendResponse(response);
        return;
      }

      skipSpaces(arguments, position);

      if (position != arguments.length()) {
        JsonDocument response;
        response["ok"] = false;
        response["cmd"] = "DCCEX";
        response["message"] =
            "Unexpected extra argument. Syntax: "
            "<DCCEX \"host-or-ip\" 2560>";
        sendResponse(response);
        return;
      }

      uint16_t port = 0;

      if (!parsePort(portText, port)) {
        JsonDocument response;
        response["ok"] = false;
        response["cmd"] = "DCCEX";
        response["message"] =
            "DCC-EX port must be between 1 and 65535";
        sendResponse(response);
        return;
      }

      JsonDocument input;
      input["host"] = host;
      input["port"] = port;

      CommandCenterSettings settings;
      String validationError;

      if (
          !parseCommandCenterSettings(
              input.as<JsonObjectConst>(),
              settings,
              validationError)
      ) {
        JsonDocument response;
        response["ok"] = false;
        response["cmd"] = "DCCEX";
        response["message"] = validationError;
        sendResponse(response);
        return;
      }

      const bool persisted = _config.saveCommandCenter(settings);

      _wsProtocol.setPowerIncludesProgramming(
          settings.powerIncludesProgramming);

      const bool endpointChanged =
          settings.host != _dcc.host() ||
          settings.port != _dcc.port();

      if (endpointChanged) {
        _dcc.setEndpoint(settings.host, settings.port);
      }

      _wsProtocol.broadcastRuntimeSnapshot();

      JsonDocument response;
      response["ok"] = persisted;
      response["cmd"] = "DCCEX";
      response["host"] = settings.host;
      response["port"] = settings.port;
      response["applied"] = true;

      if (!persisted) {
        response["message"] =
            "DCC-EX settings were applied but could not be persisted";
      }

      sendResponse(response);
      return;
    }

    JsonDocument response;
    response["ok"] = false;
    response["message"] =
        "Angle commands: <STATUS?>, "
        "<WIFI \"ssid\" \"password\">, <WIFI?>, "
        "<DCCEX \"host-or-ip\" 2560>, <DCCEX?>, "
        "<RESTART>, <HELP?>";
    sendResponse(response);
    return;
  }

  String lower = line;
  lower.toLowerCase();

  JsonDocument request;

  if (lower == "help") {
    request["cmd"] = "help";
    processJson(request);
    return;
  }

  if (lower == "status") {
    request["cmd"] = "status";
    processJson(request);
    return;
  }

  if (lower == "config") {
    request["cmd"] = "getConfig";
    processJson(request);
    return;
  }

  if (lower == "restart") {
    request["cmd"] = "restart";
    processJson(request);
    return;
  }

  if (lower.startsWith("dcc ")) {
    request["cmd"] = "dcc";
    request["data"]["command"] = line.substring(4);
    processJson(request);
    return;
  }

  JsonDocument response;
  response["ok"] = false;
  response["message"] =
      "Plain commands: help, status, config, restart, "
      "dcc <command>. Angle commands: <HELP?>";
  sendResponse(response);
}

void SerialConfigurator::processLine(String line) {
  line.trim();

  if (line.isEmpty()) {
    return;
  }

  if (line.startsWith("{")) {
    JsonDocument request;

    const DeserializationError error =
        deserializeJson(request, line);

    if (error) {
      JsonDocument response;
      response["ok"] = false;
      response["message"] =
          String("Invalid JSON: ") +
          error.c_str();
      sendResponse(response);
      return;
    }

    processJson(request);
    return;
  }

  processPlainCommand(line);
}
