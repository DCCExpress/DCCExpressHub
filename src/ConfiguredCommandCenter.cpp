#include "ConfiguredCommandCenter.h"

#include <ArduinoJson.h>
#include <algorithm>
#include <utility>

#include "Logger.h"

bool ConfiguredCommandCenter::beginLocomotiveConfiguration(
    fs::FS& fs,
    const char* path) {
  _fs =
      &fs;

  _locosPath =
      path && *path
          ? path
          : "/config/locos.json";

  return reloadLocomotiveConfiguration();
}

bool ConfiguredCommandCenter::reloadLocomotiveConfiguration() {
  if (!_fs) {
    Logger::warn(
        "Locomotive direction config reload requested before filesystem setup");

    return false;
  }

  if (
      !_fs->exists(
          _locosPath.c_str())
  ) {
    _invertedLocoAddresses.clear();

    Logger::info(
        "Locomotive direction config: no locos.json; inversion disabled");

    return true;
  }

  File file =
      _fs->open(
          _locosPath.c_str(),
          FILE_READ);

  if (!file) {
    Logger::warn(
        "Locomotive direction config: cannot open " +
        _locosPath);

    return false;
  }

  JsonDocument filter;

  filter[0]["address"] =
      true;

  filter[0]["invert"] =
      true;

  JsonDocument document;

  const DeserializationError error =
      deserializeJson(
          document,
          file,
          DeserializationOption::Filter(
              filter));

  file.close();

  if (
      error ||
      !document.is<JsonArray>()
  ) {
    Logger::warn(
        "Locomotive direction config: invalid " +
        _locosPath);

    return false;
  }

  std::vector<uint16_t>
      nextInvertedAddresses;

  for (
      JsonObjectConst item :
      document.as<JsonArrayConst>()
  ) {
    const long addressValue =
        item["address"] |
        0L;

    if (
        addressValue <= 0 ||
        addressValue > 10239
    ) {
      continue;
    }

    const bool inverted =
        item["invert"] |
        false;

    if (!inverted) {
      continue;
    }

    const uint16_t address =
        static_cast<uint16_t>(
            addressValue);

    if (
        std::find(
            nextInvertedAddresses.begin(),
            nextInvertedAddresses.end(),
            address) ==
        nextInvertedAddresses.end()
    ) {
      nextInvertedAddresses.push_back(
          address);
    }
  }

  _invertedLocoAddresses.swap(
      nextInvertedAddresses);

  Logger::info(
      "Locomotive direction config reloaded: " +
      String(
          _invertedLocoAddresses.size()) +
      " inverted locomotive(s)");

  return true;
}

bool ConfiguredCommandCenter::locomotiveDirectionInverted(
    uint16_t address) const {
  return
      std::find(
          _invertedLocoAddresses.begin(),
          _invertedLocoAddresses.end(),
          address) !=
      _invertedLocoAddresses.end();
}

bool ConfiguredCommandCenter::mapDirection(
    uint16_t address,
    bool forward) const {
  return
      locomotiveDirectionInverted(
          address)
          ? !forward
          : forward;
}

void ConfiguredCommandCenter::begin(
    const String& host,
    uint16_t port) {
  _inner.begin(
      host,
      port);
}

void ConfiguredCommandCenter::loop() {
  _inner.loop();
}

bool ConfiguredCommandCenter::ensureConnected() {
  return
      _inner.ensureConnected();
}

void ConfiguredCommandCenter::setEndpoint(
    const String& host,
    uint16_t port) {
  _inner.setEndpoint(
      host,
      port);
}

bool ConfiguredCommandCenter::connected() {
  return
      _inner.connected();
}

const String& ConfiguredCommandCenter::host() const {
  return
      _inner.host();
}

uint16_t ConfiguredCommandCenter::port() const {
  return
      _inner.port();
}

const char* ConfiguredCommandCenter::type() const {
  return
      _inner.type();
}

const char* ConfiguredCommandCenter::name() const {
  return
      _inner.name();
}

void ConfiguredCommandCenter::onRawInfo(
    RawInfoCallback callback) {
  _inner.onRawInfo(
      std::move(
          callback));
}

void ConfiguredCommandCenter::onStationInfo(
    StationInfoCallback callback) {
  _inner.onStationInfo(
      std::move(
          callback));
}

void ConfiguredCommandCenter::onTrackConfiguration(
    TrackConfigurationCallback callback) {
  _inner.onTrackConfiguration(
      std::move(
          callback));
}

void ConfiguredCommandCenter::onCurrentTelemetry(
    CurrentTelemetryCallback callback) {
  _inner.onCurrentTelemetry(
      std::move(
          callback));
}

void ConfiguredCommandCenter::onTripTelemetry(
    TripTelemetryCallback callback) {
  _inner.onTripTelemetry(
      std::move(
          callback));
}

void ConfiguredCommandCenter::onPowerFeedback(
    PowerFeedbackCallback callback) {
  _inner.onPowerFeedback(
      std::move(
          callback));
}

void ConfiguredCommandCenter::onLocoFeedback(
    LocoFeedbackCallback callback) {
  _locoFeedbackCallback =
      std::move(
          callback);

  _inner.onLocoFeedback(
      [this](
          const CommandCenterLocoFeedback& physicalFeedback) {
        if (!_locoFeedbackCallback) {
          return;
        }

        CommandCenterLocoFeedback logicalFeedback =
            physicalFeedback;

        logicalFeedback.forward =
            mapDirection(
                physicalFeedback.address,
                physicalFeedback.forward);

        _locoFeedbackCallback(
            logicalFeedback);
      });
}

bool ConfiguredCommandCenter::setTrackPower(
    bool on,
    bool includeProgramming) {
  return
      _inner.setTrackPower(
          on,
          includeProgramming);
}

bool ConfiguredCommandCenter::setProgrammingPower(
    bool on) {
  return
      _inner.setProgrammingPower(
          on);
}

bool ConfiguredCommandCenter::emergencyStop() {
  return
      _inner.emergencyStop();
}

bool ConfiguredCommandCenter::emergencyPauseStateKnown() const {
  return
      _inner.emergencyPauseStateKnown();
}

bool ConfiguredCommandCenter::emergencyPaused() const {
  return
      _inner.emergencyPaused();
}

bool ConfiguredCommandCenter::setLoco(
    uint16_t address,
    uint8_t speed,
    bool forward) {
  const bool physicalForward =
      mapDirection(
          address,
          forward);

  return
      _inner.setLoco(
          address,
          speed,
          physicalForward);
}

bool ConfiguredCommandCenter::requestLocoState(
    uint16_t address,
    bool logCommand) {
  return
      _inner.requestLocoState(
          address,
          logCommand);
}

bool ConfiguredCommandCenter::setLocoFunction(
    uint16_t address,
    uint8_t functionNumber,
    bool active) {
  return
      _inner.setLocoFunction(
          address,
          functionNumber,
          active);
}

bool ConfiguredCommandCenter::setTurnout(
    uint16_t address,
    bool closed) {
  return
      _inner.setTurnout(
          address,
          closed);
}

bool ConfiguredCommandCenter::setAccessory(
    uint16_t address,
    bool active) {
  return
      _inner.setAccessory(
          address,
          active);
}

bool ConfiguredCommandCenter::setSignalAspect(
    uint16_t address,
    int16_t aspect) {
  return
      _inner.setSignalAspect(
          address,
          aspect);
}

bool ConfiguredCommandCenter::setVPin(
    uint16_t vpin,
    bool active) {
  return
      _inner.setVPin(
          vpin,
          active);
}

bool ConfiguredCommandCenter::requestTrackConfiguration(
    bool logCommand) {
  return
      _inner.requestTrackConfiguration(
          logCommand);
}

bool ConfiguredCommandCenter::requestCurrentTelemetry(
    bool logCommand) {
  return
      _inner.requestCurrentTelemetry(
          logCommand);
}

bool ConfiguredCommandCenter::requestTripTelemetry(
    bool logCommand) {
  return
      _inner.requestTripTelemetry(
          logCommand);
}

bool ConfiguredCommandCenter::supportsRawCommand() const {
  return
      _inner.supportsRawCommand();
}

bool ConfiguredCommandCenter::sendRawCommand(
    String command,
    bool logCommand) {
  // Raw commands intentionally bypass logical locomotive configuration.
  // They are an expert/diagnostic escape hatch to the physical command
  // station protocol.
  return
      _inner.sendRawCommand(
          std::move(command),
          logCommand);
}

bool ConfiguredCommandCenter::sendCommand(
    String command,
    bool logCommand) {
  return
      _inner.sendCommand(
          std::move(command),
          logCommand);
}
