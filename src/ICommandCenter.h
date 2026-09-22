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

struct CommandCenterSensorFeedback {
  uint16_t address = 0;
  bool on = false;
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

  using SensorFeedbackCallback =
      std::function<
          void(
              const CommandCenterSensorFeedback&)>;

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

  // Generic physical sensor feedback. Implementations that do not expose
  // sensor feedback can keep the default no-op implementation.
  virtual void onSensorFeedback(
      SensorFeedbackCallback callback) {
    (void)callback;
  }

  virtual bool setTrackPower(
      bool on,
      bool includeProgramming = true) = 0;

  virtual bool setProgrammingPower(
      bool on) = 0;

  virtual bool emergencyStop() = 0;

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

  // Optional command-center snapshot of all known physical sensor states.
  virtual bool requestSensorSnapshot(
      bool logCommand = false) {
    (void)logCommand;
    return false;
  }

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

  virtual bool sendCommand(
      String command,
      bool logCommand = true) {
    return sendRawCommand(
        std::move(command),
        logCommand);
  }
};
