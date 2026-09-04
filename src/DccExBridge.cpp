#include "DccExBridge.h"
#include "Logger.h"

void DccExBridge::begin(const String& host, uint16_t port) {
  setEndpoint(host, port);
  _frame.reserve(256);
}

void DccExBridge::setEndpoint(const String& host, uint16_t port) {
  _host = host;
  _port = port;
  _client.stop();
  _nextReconnectAt = 0;
}

bool DccExBridge::connected() {
  return _client.connected();
}

bool DccExBridge::ensureConnected() {
  if (_client.connected()) return true;

  _client.stop();
  Logger::info("DCC-EX connecting to " + _host + ":" + String(_port));

  if (!_client.connect(_host.c_str(), _port, 1200)) {
    Logger::warn("DCC-EX connection failed");
    _nextReconnectAt = millis() + RECONNECT_MS;
    return false;
  }

  _client.setNoDelay(true);
  _nextReconnectAt = 0;
  Logger::info("DCC-EX connected");

  // Ask for status/version once after connect.
  _client.print("<s>");
  return true;
}

bool DccExBridge::sendCommand(String command) {
  command.trim();
  if (command.isEmpty()) return false;

  if (!command.startsWith("<")) command = "<" + command;
  if (!command.endsWith(">")) command += ">";

  if (!ensureConnected()) return false;

  const size_t written = _client.print(command);
  if (written != command.length()) {
    Logger::warn("DCC-EX TX failed: " + command);
    return false;
  }

  Logger::info("DCC-EX TX " + command);
  return true;
}

void DccExBridge::processByte(char c) {
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
    Logger::info("DCC-EX RX " + _frame);

    if (_frameCallback) _frameCallback(_frame);

    _frame.clear();
    return;
  }

  if (_frame.length() > 1024) {
    Logger::warn("DCC-EX frame exceeded 1024 bytes; resync");
    _insideFrame = false;
    _frame.clear();
  }
}

void DccExBridge::loop() {
  if (!_client.connected()) {
    const unsigned long now = millis();
    if (_nextReconnectAt == 0 || static_cast<long>(now - _nextReconnectAt) >= 0) {
      ensureConnected();
    }
    return;
  }

  while (_client.available()) {
    processByte(static_cast<char>(_client.read()));
  }
}
