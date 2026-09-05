#include "DccExBridge.h"

#include "Logger.h"

void DccExBridge::begin(
    const String& host,
    uint16_t port) {
  setEndpoint(
      host,
      port);

  _frame.reserve(256);
}

void DccExBridge::resetHeartbeatState() {
  _heartbeatAlive = false;
  _connectedAt = 0;
  _lastHeartbeatReplyAt = 0;
  _nextHeartbeatAt = 0;
}

void DccExBridge::setEndpoint(
    const String& host,
    uint16_t port) {
  _host = host;
  _port = port;

  _client.stop();

  resetHeartbeatState();

  _nextReconnectAt = 0;
}

bool DccExBridge::connected() {
  return
      _client.connected() &&
      _heartbeatAlive;
}

bool DccExBridge::ensureConnected() {
  // IMPORTANT:
  // Do not use connected() here. connected() includes the application-level
  // heartbeat and is intentionally false until the first <# ...> response.
  if (_client.connected()) {
    return true;
  }

  _client.stop();

  resetHeartbeatState();

  Logger::info(
      "DCC-EX connecting to " +
      _host +
      ":" +
      String(_port));

  if (!_client.connect(
          _host.c_str(),
          _port,
          1200)) {
    Logger::warn(
        "DCC-EX connection failed");

    _nextReconnectAt =
        millis() +
        RECONNECT_MS;

    return false;
  }

  _client.setNoDelay(true);

  const unsigned long now =
      millis();

  _connectedAt = now;
  _nextReconnectAt = 0;

  Logger::info(
      "DCC-EX TCP connected; waiting for heartbeat");

  // Initial station information.
  _client.print("<s>");

  // First heartbeat immediately instead of waiting one second.
  sendHeartbeat();

  return true;
}

void DccExBridge::sendHeartbeat() {
  if (!_client.connected()) {
    return;
  }

  const size_t written =
      _client.print("<#>");

  if (written != 3) {
    Logger::warn(
        "DCC-EX heartbeat TX failed");
  }

  _nextHeartbeatAt =
      millis() +
      HEARTBEAT_INTERVAL_MS;
}

bool DccExBridge::sendCommand(
    String command,
    bool logCommand) {
  command.trim();

  if (command.isEmpty()) {
    return false;
  }

  if (!command.startsWith("<")) {
    command =
        "<" +
        command;
  }

  if (!command.endsWith(">")) {
    command += ">";
  }

  if (!ensureConnected()) {
    return false;
  }

  const size_t written =
      _client.print(command);

  if (written !=
      command.length()) {
    Logger::warn(
        "DCC-EX TX failed: " +
        command);

    return false;
  }

  if (logCommand) {
    Logger::info(
        "DCC-EX TX " +
        command);
  }

  return true;
}

void DccExBridge::processByte(
    char c) {
  if (!_insideFrame) {
    if (c == '<') {
      _insideFrame = true;
      _frame = "<";
    }

    return;
  }

  if (c == '<') {
    _frame = "<";
    return;
  }

  _frame += c;

  if (c == '>') {
    _insideFrame = false;

    const bool quietRx =
        _frame.startsWith("<#") ||
        _frame.startsWith("<jI") ||
        _frame.startsWith("<jG");

    if (!quietRx) {
      Logger::info(
          "DCC-EX RX " +
          _frame);
    }

    // <# noCabs> is the documented response to <#>.
    // Any valid reply proves that the application behind the TCP socket
    // is alive, not merely that the socket still exists.
    if (_frame.startsWith("<#")) {
      const unsigned long now =
          millis();

      const bool wasAlive =
          _heartbeatAlive;

      _heartbeatAlive = true;
      _lastHeartbeatReplyAt = now;

      if (!wasAlive) {
        Logger::info(
            "DCC-EX heartbeat ONLINE");
      }
    }

    if (_frameCallback) {
      _frameCallback(_frame);
    }

    _frame.clear();
    return;
  }

  if (_frame.length() > 1024) {
    Logger::warn(
        "DCC-EX frame exceeded 1024 bytes; resync");

    _insideFrame = false;
    _frame.clear();
  }
}

void DccExBridge::loop() {
  if (!_client.connected()) {
    if (_heartbeatAlive) {
      Logger::warn(
          "DCC-EX heartbeat OFFLINE: TCP disconnected");
    }

    resetHeartbeatState();

    const unsigned long now =
        millis();

    if (
        _nextReconnectAt == 0 ||
        static_cast<long>(
            now -
            _nextReconnectAt) >= 0) {
      ensureConnected();
    }

    return;
  }

  while (_client.available()) {
    processByte(
        static_cast<char>(
            _client.read()));
  }

  const unsigned long now =
      millis();

  if (
      _nextHeartbeatAt == 0 ||
      static_cast<long>(
          now -
          _nextHeartbeatAt) >= 0) {
    sendHeartbeat();
  }

  const unsigned long heartbeatBase =
      _lastHeartbeatReplyAt != 0
          ? _lastHeartbeatReplyAt
          : _connectedAt;

  if (
      heartbeatBase != 0 &&
      now - heartbeatBase >=
          HEARTBEAT_TIMEOUT_MS) {
    if (_heartbeatAlive) {
      _heartbeatAlive = false;

      Logger::warn(
          "DCC-EX heartbeat OFFLINE: reply timeout");
    }
  }

  if (
      heartbeatBase != 0 &&
      now - heartbeatBase >=
          HEARTBEAT_RECONNECT_MS) {
    Logger::warn(
        "DCC-EX heartbeat stale; forcing TCP reconnect");

    _client.stop();

    resetHeartbeatState();

    _nextReconnectAt =
        now +
        RECONNECT_MS;
  }
}
