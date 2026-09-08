#pragma once

#include <Arduino.h>
#include <utility>
#include <WiFiClient.h>

#include "ICommandCenter.h"

class DccExBridge
    : public ICommandCenter {
public:
  void begin(
      const String& host,
      uint16_t port) override;

  void loop() override;

  bool connected() override;
  bool ensureConnected() override;

  void setEndpoint(
      const String& host,
      uint16_t port) override;

  const String& host() const override {
    return _host;
  }

  uint16_t port() const override {
    return _port;
  }

  const char* type() const override {
    return "dcc-ex-tcp";
  }

  const char* name() const override {
    return "DCC-EX CommandStation";
  }

  void onRawInfo(
      RawInfoCallback callback) override {
    _rawInfoCallback =
        std::move(callback);
  }

  void onStationInfo(
      StationInfoCallback callback) override {
    _stationInfoCallback =
        std::move(callback);
  }

  void onTrackConfiguration(
      TrackConfigurationCallback callback) override {
    _trackConfigurationCallback =
        std::move(callback);
  }

  void onCurrentTelemetry(
      CurrentTelemetryCallback callback) override {
    _currentTelemetryCallback =
        std::move(callback);
  }

  void onTripTelemetry(
      TripTelemetryCallback callback) override {
    _tripTelemetryCallback =
        std::move(callback);
  }

  void onPowerFeedback(
      PowerFeedbackCallback callback) override {
    _powerFeedbackCallback =
        std::move(callback);
  }

  void onLocoFeedback(
      LocoFeedbackCallback callback) override {
    _locoFeedbackCallback =
        std::move(callback);
  }

  bool setTrackPower(
      bool on,
      bool includeProgramming = true) override;

  bool setProgrammingPower(
      bool on) override;

  bool emergencyStop() override;

  bool setLoco(
      uint16_t address,
      uint8_t speed,
      bool forward) override;

  bool requestLocoState(
      uint16_t address,
      bool logCommand = false) override;

  bool setLocoFunction(
      uint16_t address,
      uint8_t functionNumber,
      bool active) override;

  bool setTurnout(
      uint16_t address,
      bool closed) override;

  bool setAccessory(
      uint16_t address,
      bool active) override;

  bool setSignalAspect(
      uint16_t address,
      int16_t aspect) override;

  bool setVPin(
      uint16_t vpin,
      bool active) override;

  bool requestTrackConfiguration(
      bool logCommand = false) override;

  bool requestCurrentTelemetry(
      bool logCommand = false) override;

  bool requestTripTelemetry(
      bool logCommand = false) override;

  bool supportsRawCommand() const override {
    return true;
  }

  bool sendRawCommand(
      String command,
      bool logCommand = true) override;

  // Backward compatibility for existing DCC-EX-specific code.
  bool sendCommand(
      String command,
      bool logCommand = true) override;

private:
  WiFiClient _client;

  String _host;
  uint16_t _port = 2560;

  bool _insideFrame = false;
  String _frame;

  RawInfoCallback
      _rawInfoCallback;

  StationInfoCallback
      _stationInfoCallback;

  TrackConfigurationCallback
      _trackConfigurationCallback;

  CurrentTelemetryCallback
      _currentTelemetryCallback;

  TripTelemetryCallback
      _tripTelemetryCallback;

  PowerFeedbackCallback
      _powerFeedbackCallback;

  LocoFeedbackCallback
      _locoFeedbackCallback;

  CommandCenterStationInfo
      _stationInfo;

  bool _heartbeatAlive = false;

  unsigned long _connectedAt = 0;
  unsigned long _lastHeartbeatReplyAt = 0;
  unsigned long _nextHeartbeatAt = 0;
  unsigned long _nextReconnectAt = 0;

  static constexpr unsigned long
      RECONNECT_MS = 3000;

  static constexpr unsigned long
      HEARTBEAT_INTERVAL_MS = 1000;

  static constexpr unsigned long
      HEARTBEAT_TIMEOUT_MS = 3000;

  static constexpr unsigned long
      HEARTBEAT_RECONNECT_MS = 6000;

  void processByte(char c);
  void processFrame(
      const String& frame);

  void emitStationInfo();

  void sendHeartbeat();
  void resetHeartbeatState();

  static size_t parseIntegerList(
      const String& text,
      int32_t* values,
      size_t maxValues);

  static String cleanVersion(
      String value);
};
