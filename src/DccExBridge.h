#pragma once

#include <Arduino.h>
#include <WiFiClient.h>
#include <functional>

class DccExBridge {
public:
  using FrameCallback = std::function<void(const String&)>;

  void begin(const String& host, uint16_t port);
  void loop();

  bool connected();
  bool ensureConnected();
  bool sendCommand(String command);

  void setEndpoint(const String& host, uint16_t port);
  const String& host() const { return _host; }
  uint16_t port() const { return _port; }

  void onFrame(FrameCallback callback) { _frameCallback = std::move(callback); }

private:
  WiFiClient _client;
  String _host;
  uint16_t _port = 2560;

  bool _insideFrame = false;
  String _frame;
  FrameCallback _frameCallback;

  unsigned long _nextReconnectAt = 0;
  static constexpr unsigned long RECONNECT_MS = 3000;

  void processByte(char c);
};
