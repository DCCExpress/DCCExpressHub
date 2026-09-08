#pragma once

#include <Arduino.h>
#include <functional>
#include <utility>

static constexpr uint8_t
    COMMAND_CENTER_MAX_TRACKS = 8;

struct CommandCenterStationInfo {
  String version;
  String processor;
  String hardware;
  String build;
  uint16_t maxLocos = 0;
};

struct CommandCenterTrackConfiguration {
  uint8_t index = 0;
  String mode;
};

struct CommandCenterCurrentTelemetry {
  int32_t values[
      COMMAND_CENTER_MAX_TRACKS] = {};
  size_t count = 0;
};

struct CommandCenterTripTelemetry {
  int32_t values[
      COMMAND_CENTER_MAX_TRACKS] = {};
  size_t count = 0;
};

enum class CommandCenterPowerTarget :
    uint8_t {
  All,
  Main,
  Programming,
  Joined,
  Track
};

struct CommandCenterPowerFeedback {
  bool on = false;

  CommandCenterPowerTarget target =
      CommandCenterPowerTarget::All;

  uint8_t trackIndex = 0;
};

struct CommandCenterLocoFeedback {
  uint16_t address = 0;
  uint8_t speed = 0;
  bool forward = true;
  uint32_t functionsMask = 0;
};

class ICommandCenter {
public:
  using RawInfoCallback =
      std::function<void(const String&)>;

  using StationInfoCallback =
      std::function<
          void(
              const CommandCenterStationInfo&)>;

  using TrackConfigurationCallback =
      std::function<
          void(
              const CommandCenterTrackConfiguration&)>;

  using CurrentTelemetryCallback =
      std::function<
          void(
              const CommandCenterCurrentTelemetry&)>;

  using TripTelemetryCallback =
      std::function<
          void(
              const CommandCenterTripTelemetry&)>;

  using PowerFeedbackCallback =
      std::function<
          void(
              const CommandCenterPowerFeedback&)>;

  using LocoFeedbackCallback =
      std::function<
          void(
              const CommandCenterLocoFeedback&)>;

  virtual ~ICommandCenter() = default;

  virtual void begin(
      const String& host,
      uint16_t port) = 0;

  virtual void loop() = 0;

  virtual bool ensureConnected() = 0;

  virtual void setEndpoint(
      const String& host,
      uint16_t port) = 0;

  virtual bool connected() = 0;

  virtual const String& host() const = 0;
  virtual uint16_t port() const = 0;

  virtual const char* type() const = 0;
  virtual const char* name() const = 0;

  virtual void onRawInfo(
      RawInfoCallback callback) = 0;

  virtual void onStationInfo(
      StationInfoCallback callback) = 0;

  virtual void onTrackConfiguration(
      TrackConfigurationCallback callback) = 0;

  virtual void onCurrentTelemetry(
      CurrentTelemetryCallback callback) = 0;

  virtual void onTripTelemetry(
      TripTelemetryCallback callback) = 0;

  virtual void onPowerFeedback(
      PowerFeedbackCallback callback) = 0;

  virtual void onLocoFeedback(
      LocoFeedbackCallback callback) = 0;

  virtual bool setTrackPower(
      bool on,
      bool includeProgramming = true) = 0;

  virtual bool setProgrammingPower(
      bool on) = 0;

  // Emergency control is intentionally a single toggle operation at the
  // Hub boundary. Concrete command-center wrappers may implement this as a
  // latched pause/resume pair (DCC-EX) or as a non-latched emergency stop
  // with a local release state (Z21).
  virtual bool emergencyStop() = 0;

  // Some command centers can expose an authoritative latched emergency/pause
  // state. Generic callers should only trust emergencyPaused() when this
  // returns true.
  virtual bool emergencyPauseStateKnown() const {
    return false;
  }

  virtual bool emergencyPaused() const {
    return false;
  }

  virtual bool setLoco(
      uint16_t address,
      uint8_t speed,
      bool forward) = 0;

  virtual bool requestLocoState(
      uint16_t address,
      bool logCommand = false) = 0;

  virtual bool setLocoFunction(
      uint16_t address,
      uint8_t functionNumber,
      bool active) = 0;

  virtual bool setTurnout(
      uint16_t address,
      bool closed) = 0;

  virtual bool setAccessory(
      uint16_t address,
      bool active) = 0;

  virtual bool setSignalAspect(
      uint16_t address,
      int16_t aspect) = 0;

  virtual bool setVPin(
      uint16_t vpin,
      bool active) = 0;

  virtual bool requestTrackConfiguration(
      bool logCommand = false) = 0;

  virtual bool requestCurrentTelemetry(
      bool logCommand = false) = 0;

  virtual bool requestTripTelemetry(
      bool logCommand = false) = 0;

  virtual bool supportsRawCommand() const {
    return false;
  }

  virtual bool sendRawCommand(
      String command,
      bool logCommand = true) {
    (void)command;
    (void)logCommand;
    return false;
  }

  // Compatibility shim for existing DCC-EX-specific recovery/config paths.
  // Generic code should use domain methods or sendRawCommand().
  virtual bool sendCommand(
      String command,
      bool logCommand = true) {
    return sendRawCommand(
        std::move(command),
        logCommand);
  }
};
