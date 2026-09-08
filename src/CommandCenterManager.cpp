#include "CommandCenterManager.h"

#include "CommandCenterFactory.h"
#include "Logger.h"

const String&
CommandCenterManager::emptyHost() {
  static String value;
  return value;
}

bool CommandCenterManager::begin(
    const String& typeValue,
    const String& hostValue,
    uint16_t portValue) {
  return select(
      typeValue,
      hostValue,
      portValue);
}

bool CommandCenterManager::select(
    const String& typeValue,
    const String& hostValue,
    uint16_t portValue) {
  String normalized =
      CommandCenterFactory::normalizeType(
          typeValue);

  if (
      !CommandCenterFactory::supports(
          normalized)
  ) {
    Logger::error(
        "Unsupported command center type: " +
        normalized);

    return false;
  }

  auto next =
      CommandCenterFactory::create(
          normalized);

  if (!next) {
    Logger::error(
        "Cannot create command center type: " +
        normalized);

    return false;
  }

  _implementation =
      std::move(next);

  _selectedType =
      normalized;

  _host =
      hostValue;

  _port =
      portValue;

  bindCallbacks();

  _implementation->begin(
      _host,
      _port);

  Logger::info(
      "Command center selected: " +
      _selectedType +
      " " +
      _host +
      ":" +
      String(_port));

  return true;
}

void CommandCenterManager::bindCallbacks() {
  if (!_implementation) {
    return;
  }

  _implementation->onRawInfo(
      _rawInfoCallback);

  _implementation->onStationInfo(
      _stationInfoCallback);

  _implementation->onTrackConfiguration(
      _trackConfigurationCallback);

  _implementation->onCurrentTelemetry(
      _currentTelemetryCallback);

  _implementation->onTripTelemetry(
      _tripTelemetryCallback);

  _implementation->onPowerFeedback(
      _powerFeedbackCallback);

  _implementation->onLocoFeedback(
      _locoFeedbackCallback);
}

void CommandCenterManager::begin(
    const String& hostValue,
    uint16_t portValue) {
  if (!_implementation) {
    select(
        _selectedType,
        hostValue,
        portValue);

    return;
  }

  _host =
      hostValue;

  _port =
      portValue;

  _implementation->begin(
      hostValue,
      portValue);
}

void CommandCenterManager::loop() {
  if (_implementation) {
    _implementation->loop();
  }
}

bool CommandCenterManager::ensureConnected() {
  return
      _implementation &&
      _implementation
          ->ensureConnected();
}

void CommandCenterManager::setEndpoint(
    const String& hostValue,
    uint16_t portValue) {
  String inferredType =
      _selectedType;

  if (
      portValue == 21105 ||
      portValue == 21106
  ) {
    inferredType =
        "z21";
  } else if (
      portValue == 2560
  ) {
    inferredType =
        "dcc-ex";
  }

  if (
      inferredType !=
          _selectedType &&
      CommandCenterFactory::supports(
          inferredType)
  ) {
    select(
        inferredType,
        hostValue,
        portValue);

    return;
  }

  _host =
      hostValue;

  _port =
      portValue;

  if (_implementation) {
    _implementation->setEndpoint(
        hostValue,
        portValue);
  }
}

bool CommandCenterManager::connected() {
  return
      _implementation &&
      _implementation
          ->connected();
}

const String& CommandCenterManager::host() const {
  return
      _implementation
          ? _implementation->host()
          : (
                _host.isEmpty()
                    ? emptyHost()
                    : _host
            );
}

uint16_t CommandCenterManager::port() const {
  return
      _implementation
          ? _implementation->port()
          : _port;
}

const char* CommandCenterManager::type() const {
  return
      _implementation
          ? _implementation->type()
          : _selectedType.c_str();
}

const char* CommandCenterManager::name() const {
  return
      _implementation
          ? _implementation->name()
          : "Command Center";
}

void CommandCenterManager::onRawInfo(
    RawInfoCallback callback) {
  _rawInfoCallback =
      std::move(callback);

  if (_implementation) {
    _implementation->onRawInfo(
        _rawInfoCallback);
  }
}

void CommandCenterManager::onStationInfo(
    StationInfoCallback callback) {
  _stationInfoCallback =
      std::move(callback);

  if (_implementation) {
    _implementation->onStationInfo(
        _stationInfoCallback);
  }
}

void CommandCenterManager::onTrackConfiguration(
    TrackConfigurationCallback callback) {
  _trackConfigurationCallback =
      std::move(callback);

  if (_implementation) {
    _implementation->onTrackConfiguration(
        _trackConfigurationCallback);
  }
}

void CommandCenterManager::onCurrentTelemetry(
    CurrentTelemetryCallback callback) {
  _currentTelemetryCallback =
      std::move(callback);

  if (_implementation) {
    _implementation->onCurrentTelemetry(
        _currentTelemetryCallback);
  }
}

void CommandCenterManager::onTripTelemetry(
    TripTelemetryCallback callback) {
  _tripTelemetryCallback =
      std::move(callback);

  if (_implementation) {
    _implementation->onTripTelemetry(
        _tripTelemetryCallback);
  }
}

void CommandCenterManager::onPowerFeedback(
    PowerFeedbackCallback callback) {
  _powerFeedbackCallback =
      std::move(callback);

  if (_implementation) {
    _implementation->onPowerFeedback(
        _powerFeedbackCallback);
  }
}

void CommandCenterManager::onLocoFeedback(
    LocoFeedbackCallback callback) {
  _locoFeedbackCallback =
      std::move(callback);

  if (_implementation) {
    _implementation->onLocoFeedback(
        _locoFeedbackCallback);
  }
}

bool CommandCenterManager::setTrackPower(
    bool on,
    bool includeProgramming) {
  return
      _implementation &&
      _implementation
          ->setTrackPower(
              on,
              includeProgramming);
}

bool CommandCenterManager::setProgrammingPower(
    bool on) {
  return
      _implementation &&
      _implementation
          ->setProgrammingPower(
              on);
}

bool CommandCenterManager::emergencyStop() {
  return
      _implementation &&
      _implementation
          ->emergencyStop();
}

bool CommandCenterManager::setLoco(
    uint16_t address,
    uint8_t speed,
    bool forward) {
  return
      _implementation &&
      _implementation
          ->setLoco(
              address,
              speed,
              forward);
}

bool CommandCenterManager::requestLocoState(
    uint16_t address,
    bool logCommand) {
  return
      _implementation &&
      _implementation
          ->requestLocoState(
              address,
              logCommand);
}

bool CommandCenterManager::setLocoFunction(
    uint16_t address,
    uint8_t functionNumber,
    bool active) {
  return
      _implementation &&
      _implementation
          ->setLocoFunction(
              address,
              functionNumber,
              active);
}

bool CommandCenterManager::setTurnout(
    uint16_t address,
    bool closed) {
  return
      _implementation &&
      _implementation
          ->setTurnout(
              address,
              closed);
}

bool CommandCenterManager::setAccessory(
    uint16_t address,
    bool active) {
  return
      _implementation &&
      _implementation
          ->setAccessory(
              address,
              active);
}

bool CommandCenterManager::setSignalAspect(
    uint16_t address,
    int16_t aspect) {
  return
      _implementation &&
      _implementation
          ->setSignalAspect(
              address,
              aspect);
}

bool CommandCenterManager::setVPin(
    uint16_t vpin,
    bool active) {
  return
      _implementation &&
      _implementation
          ->setVPin(
              vpin,
              active);
}

bool CommandCenterManager::requestTrackConfiguration(
    bool logCommand) {
  return
      _implementation &&
      _implementation
          ->requestTrackConfiguration(
              logCommand);
}

bool CommandCenterManager::requestCurrentTelemetry(
    bool logCommand) {
  return
      _implementation &&
      _implementation
          ->requestCurrentTelemetry(
              logCommand);
}

bool CommandCenterManager::requestTripTelemetry(
    bool logCommand) {
  return
      _implementation &&
      _implementation
          ->requestTripTelemetry(
              logCommand);
}

bool CommandCenterManager::supportsRawCommand() const {
  return
      _implementation &&
      _implementation
          ->supportsRawCommand();
}

bool CommandCenterManager::sendRawCommand(
    String command,
    bool logCommand) {
  return
      _implementation &&
      _implementation
          ->sendRawCommand(
              std::move(command),
              logCommand);
}

bool CommandCenterManager::sendCommand(
    String command,
    bool logCommand) {
  return
      _implementation &&
      _implementation
          ->sendCommand(
              std::move(command),
              logCommand);
}
