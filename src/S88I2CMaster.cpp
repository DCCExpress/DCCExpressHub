#include "S88I2CMaster.h"

#include <ArduinoJson.h>
#include <Wire.h>

#include "Logger.h"
#include "S88I2CConfig.h"

String S88I2CMaster::formatAddress(
    uint8_t address) {
  char buffer[5];

  snprintf(
      buffer,
      sizeof(buffer),
      "0x%02X",
      address);

  return String(buffer);
}

String S88I2CMaster::formatBits(
    const uint8_t* data,
    uint8_t count) {
  String result;

  for (
      uint8_t byteIndex = 0;
      byteIndex < count;
      ++byteIndex
  ) {
    if (byteIndex > 0) {
      result += ' ';
    }

    result += '_';

    const uint8_t value =
        data[byteIndex];

    for (
        int8_t bit = 7;
        bit >= 0;
        --bit
    ) {
      result +=
          (
              value &
              (
                  1U <<
                  bit
              )
          )
              ? '1'
              : '0';
    }
  }

  return result;
}

bool S88I2CMaster::startBus() {
  if (_busInitialized) {
    return true;
  }

#if S88_I2C_ENABLED
  Logger::info(
      "S88 I2C bus starting: "
      "SDA=" +
      String(S88_I2C_SDA_PIN) +
      " SCL=" +
      String(S88_I2C_SCL_PIN) +
      " clock=" +
      String(S88_I2C_CLOCK_HZ) +
      "Hz");

  const bool started =
      Wire.begin(
          S88_I2C_SDA_PIN,
          S88_I2C_SCL_PIN,
          S88_I2C_CLOCK_HZ);

  if (!started) {
    Logger::error(
        "S88 I2C bus initialization failed");

    return false;
  }

  _busInitialized =
      true;

  return true;
#else
  return false;
#endif
}

bool S88I2CMaster::loadSettings(
    fs::FS& fs,
    Settings& settings) {
  settings.enabled =
      S88_I2C_ENABLED != 0;

  settings.address =
      static_cast<uint8_t>(
          S88_I2C_ADDRESS);

  settings.baseAddress =
      static_cast<uint16_t>(
          S88_I2C_BASE_SENSOR_ADDRESS);

  settings.groupCount =
      static_cast<uint8_t>(
          S88_I2C_DEFAULT_GROUP_COUNT);

  File file =
      fs.open(
          DEVICE_CONFIG_PATH,
          "r");

  if (!file) {
    Logger::info(
        "S88 device config not found; using firmware defaults");

    return true;
  }

  JsonDocument document;

  const DeserializationError error =
      deserializeJson(
          document,
          file);

  file.close();

  if (error) {
    Logger::warn(
        "S88 device config JSON parse failed; using firmware defaults");

    return false;
  }

  JsonArrayConst devices =
      document["devices"]
          .as<JsonArrayConst>();

  for (
      JsonObjectConst device :
      devices
  ) {
    const char* type =
        device["type"] |
        "";

    if (
        String(type) !=
        "s88adapter"
    ) {
      continue;
    }

    const bool enabled =
        device["enabled"] |
        true;

    const int address =
        device["address"] |
        static_cast<int>(
            S88_I2C_ADDRESS);

    const int baseAddress =
        device["baseAddress"] |
        static_cast<int>(
            S88_I2C_BASE_SENSOR_ADDRESS);

    const int groupCount =
        device["groupCount"] |
        static_cast<int>(
            S88_I2C_DEFAULT_GROUP_COUNT);

    const int sensorCount =
        groupCount *
        BITS_PER_GROUP;

    if (
        address < 0x08 ||
        address > 0x77 ||
        baseAddress < 1 ||
        baseAddress +
                sensorCount -
                1 >
            65535 ||
        groupCount < 1 ||
        groupCount >
            MAX_GROUPS
    ) {
      Logger::warn(
          "Invalid S88 adapter entry in device-config.json; using firmware defaults");

      return false;
    }

    settings.enabled =
        enabled;

    settings.address =
        static_cast<uint8_t>(
            address);

    settings.baseAddress =
        static_cast<uint16_t>(
            baseAddress);

    settings.groupCount =
        static_cast<uint8_t>(
            groupCount);

    return true;
  }

  Logger::info(
      "No S88 adapter entry in device config; using firmware defaults");

  return true;
}

void S88I2CMaster::clearPublishedSensors(
    uint16_t baseAddress,
    uint16_t sensorCount) {
  if (!_sensorChangeCallback) {
    return;
  }

  for (
      uint16_t offset = 0;
      offset < sensorCount;
      ++offset
  ) {
    _sensorChangeCallback(
        static_cast<uint16_t>(
            baseAddress +
            offset),
        false);
  }
}

bool S88I2CMaster::applySettings(
    const Settings& settings) {
  const uint16_t oldBase =
      _baseSensorAddress;

  const uint16_t oldSensorCount =
      sensorCount();

  const bool mappingChanged =
      oldBase !=
          settings.baseAddress ||
      _groupCount !=
          settings.groupCount ||
      _enabled !=
          settings.enabled;

  if (
      _snapshotKnown &&
      mappingChanged
  ) {
    clearPublishedSensors(
        oldBase,
        oldSensorCount);
  }

  const bool addressChanged =
      _slaveAddress !=
      settings.address;

  _enabled =
      settings.enabled;

  _slaveAddress =
      settings.address;

  _baseSensorAddress =
      settings.baseAddress;

  _groupCount =
      settings.groupCount;

  memset(
      _activeBytes,
      0,
      sizeof(_activeBytes));

  _snapshotKnown =
      false;

  _adapterConfigurationSent =
      false;

  if (addressChanged) {
    _presenceKnown =
        false;

    _slavePresent =
        false;
  }

  Logger::info(
      "S88 settings: enabled=" +
      String(
          _enabled
              ? "true"
              : "false") +
      " address=" +
      formatAddress(
          _slaveAddress) +
      " base=" +
      String(
          _baseSensorAddress) +
      " byteGroups=" +
      String(
          _groupCount) +
      " bytes=" +
      String(
          byteCount()) +
      " sensors=" +
      String(
          sensorCount()));

  return true;
}

bool S88I2CMaster::reloadConfiguration(
    fs::FS& fs) {
#if S88_I2C_ENABLED
  Settings settings;

  const bool parsed =
      loadSettings(
          fs,
          settings);

  applySettings(
      settings);

  if (!startBus()) {
    return false;
  }

  if (!_enabled) {
    _slavePresent =
        false;

    _presenceKnown =
        true;

    Logger::info(
        "S88 adapter disabled by device configuration");

    return parsed;
  }

  updateSlavePresence(
      true);

  if (_slavePresent) {
    sendAdapterConfiguration();
  }

  return parsed;
#else
  (void)fs;

  _enabled =
      false;

  return true;
#endif
}

bool S88I2CMaster::ping(
    uint8_t address) {
  if (!_busInitialized) {
    return false;
  }

  Wire.beginTransmission(
      address);

  const uint8_t result =
      Wire.endTransmission(
          true);

  return
      result == 0;
}

void S88I2CMaster::scanBus() {
  if (!_busInitialized) {
    return;
  }

  Logger::info(
      "I2C scan started");

  uint8_t found =
      0;

  for (
      uint8_t address = 0x08;
      address <= 0x77;
      ++address
  ) {
    if (!ping(address)) {
      continue;
    }

    ++found;

    String message =
        "I2C device found: " +
        formatAddress(
            address);

    if (
        address ==
        _slaveAddress
    ) {
      message +=
          " [configured S88 adapter]";
    } else if (
        address ==
        0x75
    ) {
      message +=
          " [M5Stack IP5306]";
    }

    Logger::info(
        message);
  }

  Logger::info(
      "I2C scan complete: " +
      String(found) +
      " device(s)");
}

bool S88I2CMaster::sendAdapterConfiguration() {
  if (
      !_enabled ||
      !_busInitialized ||
      !_slavePresent
  ) {
    return false;
  }

  const uint8_t groups =
      _groupCount;

  const uint8_t bytes =
      byteCount();

  const uint8_t checksum =
      static_cast<uint8_t>(
          CONFIG_MAGIC ^
          CONFIG_COMMAND ^
          groups ^
          bytes);

  Wire.beginTransmission(
      _slaveAddress);

  Wire.write(
      CONFIG_MAGIC);

  Wire.write(
      CONFIG_COMMAND);

  Wire.write(
      groups);

  Wire.write(
      bytes);

  Wire.write(
      checksum);

  const uint8_t result =
      Wire.endTransmission(
          true);

  _adapterConfigurationSent =
      result == 0;

  if (_adapterConfigurationSent) {
    Logger::info(
        "S88 adapter config sent: groups=" +
        String(groups) +
        " bytes=" +
        String(bytes));
  } else {
    Logger::warn(
        "S88 adapter config write failed at " +
        formatAddress(
            _slaveAddress) +
        " code=" +
        String(result));
  }

  return
      _adapterConfigurationSent;
}

void S88I2CMaster::updateSlavePresence(
    bool forceLog) {
  if (
      !_busInitialized ||
      !_enabled
  ) {
    return;
  }

  const bool present =
      ping(
          _slaveAddress);

  if (
      !forceLog &&
      _presenceKnown &&
      present ==
          _slavePresent
  ) {
    return;
  }

  const bool changed =
      !_presenceKnown ||
      present !=
          _slavePresent;

  _presenceKnown =
      true;

  _slavePresent =
      present;

  if (changed) {
    _snapshotKnown =
        false;

    _adapterConfigurationSent =
        false;
  }

  if (present) {
    Logger::info(
        "S88 I2C slave detected at " +
        formatAddress(
            _slaveAddress));

    if (
        changed ||
        forceLog ||
        !_adapterConfigurationSent
    ) {
      sendAdapterConfiguration();
    }
  } else {
    Logger::warn(
        "S88 I2C slave NOT detected at " +
        formatAddress(
            _slaveAddress));
  }
}

uint16_t S88I2CMaster::activeBitsForSnapshotGroup(
    uint8_t snapshotGroupIndex) const {
  if (
      snapshotGroupIndex >=
      snapshotGroupCount()
  ) {
    return 0;
  }

  const uint8_t byteIndex =
      static_cast<uint8_t>(
          snapshotGroupIndex *
          2U);

  uint16_t result =
      static_cast<uint16_t>(
          _activeBytes[
              byteIndex]);

  if (
      static_cast<uint8_t>(
          byteIndex +
          1U) <
      byteCount()
  ) {
    result |=
        static_cast<uint16_t>(
            _activeBytes[
                byteIndex +
                1U]) <<
        8U;
  }

  return result;
}

uint16_t S88I2CMaster::knownBitsForSnapshotGroup(
    uint8_t snapshotGroupIndex) const {
  if (
      !_snapshotKnown ||
      snapshotGroupIndex >=
          snapshotGroupCount()
  ) {
    return 0;
  }

  const uint8_t firstByteIndex =
      static_cast<uint8_t>(
          snapshotGroupIndex *
          2U);

  const uint8_t bytesRemaining =
      static_cast<uint8_t>(
          byteCount() -
          firstByteIndex);

  return
      bytesRemaining >= 2
          ? 0xffffU
          : 0x00ffU;
}

void S88I2CMaster::publishSnapshot(
    const uint8_t* data,
    uint8_t count) {
  const bool first =
      !_snapshotKnown;

  bool anyChanged =
      first;

  for (
      uint8_t index = 0;
      index < count;
      ++index
  ) {
    if (
        _activeBytes[index] !=
        data[index]
    ) {
      anyChanged =
          true;
      break;
    }
  }

  if (anyChanged) {
    Logger::info(
        "S88 I2C RX: " +
        formatBits(
            data,
            count));
  }

  for (
      uint8_t byteIndex = 0;
      byteIndex < count;
      ++byteIndex
  ) {
    const uint8_t previous =
        _activeBytes[
            byteIndex];

    const uint8_t current =
        data[
            byteIndex];

    const uint8_t changed =
        first
            ? 0xffU
            : static_cast<uint8_t>(
                  previous ^
                  current);

    _activeBytes[
        byteIndex] =
        current;

    if (!_sensorChangeCallback) {
      continue;
    }

    for (
        uint8_t bit = 0;
        bit < 8;
        ++bit
    ) {
      const uint8_t mask =
          static_cast<uint8_t>(
              1U <<
              bit);

      if (
          !first &&
          (
              changed &
              mask
          ) ==
          0
      ) {
        continue;
      }

      const uint16_t offset =
          static_cast<uint16_t>(
              byteIndex) *
              8U +
          bit;

      const uint16_t address =
          static_cast<uint16_t>(
              _baseSensorAddress +
              offset);

      const bool occupied =
          (
              current &
              mask
          ) !=
          0;

      _sensorChangeCallback(
          address,
          occupied);
    }
  }

  _snapshotKnown =
      true;
}

bool S88I2CMaster::readSnapshot() {
  if (
      !_busInitialized ||
      !_enabled ||
      !_slavePresent
  ) {
    return false;
  }

  const uint8_t expected =
      byteCount();

  const size_t received =
      Wire.requestFrom(
          _slaveAddress,
          expected);

  if (
      received !=
      expected
  ) {
    while (
        Wire.available()
    ) {
      Wire.read();
    }

    const unsigned long now =
        millis();

    if (
        now -
            _lastShortReadLogMs >=
        1000UL
    ) {
      _lastShortReadLogMs =
          now;

      Logger::warn(
          "S88 I2C short read from " +
          formatAddress(
              _slaveAddress) +
          ": expected=" +
          String(expected) +
          " received=" +
          String(received));
    }

    // Re-send configuration in case the UNO has just restarted.
    sendAdapterConfiguration();

    return false;
  }

  uint8_t data[
      MAX_DATA_BYTES] = {};

  for (
      uint8_t index = 0;
      index < expected;
      ++index
  ) {
    data[index] =
        static_cast<uint8_t>(
            Wire.read());
  }

  publishSnapshot(
      data,
      expected);

  return true;
}

void S88I2CMaster::begin(
    fs::FS& fs) {
#if S88_I2C_ENABLED
  if (!startBus()) {
    _enabled =
        false;
    return;
  }

  Settings settings;

  loadSettings(
      fs,
      settings);

  applySettings(
      settings);

  if (!_enabled) {
    Logger::info(
        "S88 adapter disabled");

    return;
  }

  scanBus();

  updateSlavePresence(
      true);

  _lastProbeMs =
      millis();

  _lastReadMs =
      millis();
#else
  (void)fs;

  _enabled =
      false;

  Logger::info(
      "S88 I2C master disabled for this Hub target");
#endif
}

void S88I2CMaster::loop() {
  if (
      !_enabled ||
      !_busInitialized
  ) {
    return;
  }

  const unsigned long now =
      millis();

  if (
      now -
          _lastProbeMs >=
      S88_I2C_PROBE_INTERVAL_MS
  ) {
    _lastProbeMs =
        now;

    updateSlavePresence(
        false);
  }

  if (
      !_slavePresent ||
      now -
          _lastReadMs <
      S88_I2C_READ_INTERVAL_MS
  ) {
    return;
  }

  _lastReadMs =
      now;

  readSnapshot();
}
