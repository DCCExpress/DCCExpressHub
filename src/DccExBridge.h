#pragma once

#include <Arduino.h>
#include <WiFiClient.h>
#include <functional>

class DccExBridge {
public:
  using FrameCallback =
      std::function<void(const String&)>;

  void begin(
      const String& host,
      uint16_t port);

  void loop();

  // Authoritative DCC-EX application-level connection state.
  // True only while the TCP socket is up AND <#> replies are arriving.
  bool connected();

  bool ensureConnected();
  bool sendCommand(
      String command,
      bool logCommand = true);

  void setEndpoint(
      const String& host,
      uint16_t port);

  const String& host() const {
    return _host;
  }

  uint16_t port() const {
    return _port;
  }

  void onFrame(FrameCallback callback) {
    _frameCallback =
        std::move(callback);
  }

private:
  WiFiClient _client;

  String _host;
  uint16_t _port = 2560;

  bool _insideFrame = false;
  String _frame;

  FrameCallback _frameCallback;

  bool _heartbeatAlive = false;

  unsigned long _connectedAt = 0;
  unsigned long _lastHeartbeatReplyAt = 0;
  unsigned long _nextHeartbeatAt = 0;
  unsigned long _nextReconnectAt = 0;

  static constexpr unsigned long
      RECONNECT_MS = 3000;

  static constexpr unsigned long
      HEARTBEAT_INTERVAL_MS = 1000;

  // Missing roughly three consecutive replies means DCC-EX is offline.
  static constexpr unsigned long
      HEARTBEAT_TIMEOUT_MS = 3000;

  // If the socket stays half-open for longer, force a fresh TCP reconnect.
  static constexpr unsigned long
      HEARTBEAT_RECONNECT_MS = 6000;

  void processByte(char c);
  void sendHeartbeat();
  void resetHeartbeatState();
};
