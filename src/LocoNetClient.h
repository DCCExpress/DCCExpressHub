#pragma once

#include <Arduino.h>
#include <WiFiClient.h>
#include <utility>

#include "ICommandCenter.h"

class LocoNetClient {
public:
  void configure(const String& host, uint16_t port = 1234);
  void start();
  void stop();
  void loop();
  bool connected() const;
  void onSensorFeedback(ICommandCenter::SensorFeedbackCallback callback) {
    _sensorFeedbackCallback = std::move(callback);
  }
  void onSensorSnapshotComplete(ICommandCenter::SensorSnapshotCompleteCallback callback) {
    _sensorSnapshotCompleteCallback = std::move(callback);
  }
  bool requestSensorSnapshot(bool force = true);
private:
  static constexpr uint16_t DEFAULT_LB_SERVER_PORT = 1234;
  static constexpr uint16_t BINARY_PORT = 5560;
  static constexpr unsigned long RECONNECT_MS = 2000;
  static constexpr unsigned long RESOLVE_RETRY_MS = 3000;
  static constexpr uint32_t CONNECT_TIMEOUT_MS = 150;
  static constexpr unsigned long INTERROGATE_INTERVAL_MS = 1000;
  static constexpr unsigned long SNAPSHOT_SETTLE_MS = 1500;
  static constexpr unsigned long BINARY_FALLBACK_DELAY_MS = 5000;
  String _host;
  uint16_t _port = DEFAULT_LB_SERVER_PORT;
  IPAddress _remoteIp;
  bool _enabled = false;
  bool _resolved = false;
  unsigned long _startedAt = 0;
  unsigned long _nextResolveAt = 0;
  WiFiClient _lbClient;
  bool _lbConnected = false;
  unsigned long _nextLbConnectAt = 0;
  unsigned long _lastLbTrafficAt = 0;
  unsigned long _lastInterrogateAt = 0;
  unsigned long _nextInterrogateStepAt = 0;
  uint8_t _interrogatePhase = 0;
  char _lbLine[256] = {};
  size_t _lbLineLength = 0;
  uint32_t _lbLinesObserved = 0;
  uint32_t _lbPacketsObserved = 0;
  WiFiClient _binaryClient;
  bool _binaryConnected = false;
  unsigned long _nextBinaryConnectAt = 0;
  uint8_t _binaryPacket[128] = {};
  size_t _binaryPacketLength = 0;
  size_t _binaryExpectedLength = 0;
  uint32_t _binaryPacketsObserved = 0;
  ICommandCenter::SensorFeedbackCallback _sensorFeedbackCallback;
  ICommandCenter::SensorSnapshotCompleteCallback _sensorSnapshotCompleteCallback;
  bool resolveRemote();
  void loopLbServer(unsigned long now);
  bool connectLbServer();
  void disconnectLbServer();
  void processLbServerIncoming();
  void processLbServerLine(const char* line);
  void loopBinary(unsigned long now);
  bool connectBinary();
  void disconnectBinary();
  void processBinaryIncoming();
  static size_t messageLength(const uint8_t* packet, size_t packetLength);
  void processPacket(const uint8_t* packet, size_t length);
  void processInputReport(const uint8_t* packet, size_t length);
  void startInterrogate(bool force);
  void processInterrogate(unsigned long now);
};
