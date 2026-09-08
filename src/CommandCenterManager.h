#pragma once

#include <Arduino.h>
#include <memory>
#include <utility>

#include "ICommandCenter.h"

class CommandCenterManager
    : public ICommandCenter {
public:
  bool begin(
      const String& type,
      const String& host,
      uint16_t port);

  bool select(
      const String& type,
      const String& host,
      uint16_t port);

  String selectedType() const {
    return _selectedType;
  }

  bool hasImplementation() const {
    return
        static_cast<bool>(
            _implementation);
  }

  void begin(
      const String& host,
      uint16_t port) override;

  void loop() override;

  bool ensureConnected() override;

  void setEndpoint(
      const String& host,
      uint16_t port) override;

  bool connected() override;

  const String& host() const override;
  uint16_t port() const override;

  const char* type() const override;
  const char* name() const override;

  void onRawInfo(
      RawInfoCallback callback) override;

  void onStationInfo(
      StationInfoCallback callback) override;

  void onTrackConfiguration(
      TrackConfigurationCallback callback) override;

  void onCurrentTelemetry(
      CurrentTelemetryCallback callback) override;

  void onTripTelemetry(
      TripTelemetryCallback callback) override;

  void onPowerFeedback(
      PowerFeedbackCallback callback) override;

  void onLocoFeedback(
      LocoFeedbackCallback callback) override;

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

  bool supportsRawCommand() const override;

  bool sendRawCommand(
      String command,
      bool logCommand = true) override;

  bool sendCommand(
      String command,
      bool logCommand = true) override;

private:
  std::unique_ptr<ICommandCenter>
      _implementation;

  String _selectedType =
      "dcc-ex";

  String _host;
  uint16_t _port = 0;

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

  void bindCallbacks();

  static const String&
  emptyHost();
};
