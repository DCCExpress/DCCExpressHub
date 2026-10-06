#pragma once

#include <Arduino.h>
#include <FS.h>
#include <vector>

#include "ICommandCenter.h"

class ConfiguredCommandCenter final
    : public ICommandCenter {
public:
  explicit ConfiguredCommandCenter(
      ICommandCenter& inner)
      : _inner(inner) {}

  bool beginLocomotiveConfiguration(
      fs::FS& fs,
      const char* path =
          "/config/locos.json");

  bool reloadLocomotiveConfiguration();

  bool locomotiveDirectionInverted(
      uint16_t address) const;

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

  const char* feedbackLinkName() const override;

  bool feedbackLinkConnected() const override;

  void setFeedbackEndpoint(
      const String& host,
      uint16_t port) override;

  String feedbackHost() const override;

  uint16_t feedbackPort() const override;

  void setCommandIntervalMs(
      uint16_t intervalMs) override;

  uint16_t commandIntervalMs() const override;

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

  void onSensorFeedback(
      SensorFeedbackCallback callback) override;

  void onSensorSnapshotComplete(
      SensorSnapshotCompleteCallback callback) override;

  bool setTrackPower(
      bool on,
      bool includeProgramming = true) override;

  bool setProgrammingPower(
      bool on) override;

  bool emergencyStop() override;

  bool emergencyPauseStateKnown() const override;

  bool emergencyPaused() const override;

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

  bool requestSensorSnapshot(
      bool logCommand = false) override;

  void onProgrammingFeedback(
      ProgrammingFeedbackCallback callback) override;

  bool readServiceCv(
      uint16_t cv) override;

  bool writeServiceCv(
      uint16_t cv,
      uint8_t value) override;

  bool readPomCv(
      uint16_t address,
      uint16_t cv) override;

  bool writePomCv(
      uint16_t address,
      uint16_t cv,
      uint8_t value) override;

  bool readAccessoryPomCv(
      uint16_t decoderAddress,
      uint16_t cv) override;

  bool writeAccessoryPomCv(
      uint16_t decoderAddress,
      uint16_t cv,
      uint8_t value) override;

  bool supportsRawCommand() const override;

  bool sendRawCommand(
      String command,
      bool logCommand = true) override;

  bool sendCommand(
      String command,
      bool logCommand = true) override;

private:
  ICommandCenter& _inner;

  fs::FS* _fs = nullptr;

  String _locosPath =
      "/config/locos.json";

  std::vector<uint16_t>
      _invertedLocoAddresses;

  LocoFeedbackCallback
      _locoFeedbackCallback;

  bool mapDirection(
      uint16_t address,
      bool forward) const;
};
