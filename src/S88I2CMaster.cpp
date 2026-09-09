#include "S88I2CMaster.h"

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
    uint16_t activeBits) {
  String result;

  for (
      uint8_t byteIndex = 0;
      byteIndex < DATA_BYTES;
      ++byteIndex
  ) {
    if (byteIndex > 0) {
      result +=
          ' ';
    }

    result +=
        '_';

    const uint8_t value =
        static_cast<uint8_t>(
            (
                activeBits >>
                (
                    byteIndex *
                    8U
                )
            ) &
            0xffU);

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

bool S88I2CMaster::ping(
    uint8_t address) {
  Wire.beginTransmission(
      address);

  const uint8_t result =
      Wire.endTransmission(
          true);

  return
      result == 0;
}

void S88I2CMaster::scanBus() {
  if (!_initialized) {
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

void S88I2CMaster::updateSlavePresence(
    bool forceLog) {
  if (!_initialized) {
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
    // A reconnect must publish a complete fresh snapshot.
    // On disconnect keep the last UI occupancy state rather than falsely
    // declaring the railway free.
    _snapshotKnown =
        false;
  }

  if (present) {
    Logger::info(
        "S88 I2C slave detected at " +
        formatAddress(
            _slaveAddress));
  } else {
    Logger::warn(
        "S88 I2C slave NOT detected at " +
        formatAddress(
            _slaveAddress));
  }
}

void S88I2CMaster::publishSnapshot(
    uint16_t activeBits) {
  const bool first =
      !_snapshotKnown;

  const uint16_t changedBits =
      first
          ? 0xffffU
          : static_cast<uint16_t>(
                _activeBits ^
                activeBits);

  _activeBits =
      activeBits;

  _snapshotKnown =
      true;

  if (
      first ||
      changedBits != 0
  ) {
    Logger::info(
        "S88 I2C RX: " +
        formatBits(
            activeBits));
  }

  if (!_sensorChangeCallback) {
    return;
  }

  for (
      uint8_t bit = 0;
      bit < S88_I2C_INPUT_COUNT;
      ++bit
  ) {
    const uint16_t mask =
        static_cast<uint16_t>(
            1U <<
            bit);

    if (
        !first &&
        (
            changedBits &
            mask
        ) ==
        0
    ) {
      continue;
    }

    const uint16_t address =
        static_cast<uint16_t>(
            _baseSensorAddress +
            bit);

    const bool occupied =
        (
            activeBits &
            mask
        ) !=
        0;

    _sensorChangeCallback(
        address,
        occupied);
  }
}

bool S88I2CMaster::readSnapshot() {
  if (
      !_initialized ||
      !_slavePresent
  ) {
    return false;
  }

  const size_t received =
      Wire.requestFrom(
          _slaveAddress,
          DATA_BYTES);

  if (
      received !=
      DATA_BYTES
  ) {
    while (
        Wire.available()
    ) {
      Wire.read();
    }

    Logger::warn(
        "S88 I2C short read from " +
        formatAddress(
            _slaveAddress) +
        ": expected=2 received=" +
        String(
            received));

    return false;
  }

  const uint8_t byte0 =
      static_cast<uint8_t>(
          Wire.read());

  const uint8_t byte1 =
      static_cast<uint8_t>(
          Wire.read());

  const uint16_t activeBits =
      static_cast<uint16_t>(
          byte0) |
      (
          static_cast<uint16_t>(
              byte1) <<
          8U
      );

  publishSnapshot(
      activeBits);

  return true;
}

void S88I2CMaster::begin() {
#if S88_I2C_ENABLED
  _enabled =
      true;

  _slaveAddress =
      static_cast<uint8_t>(
          S88_I2C_ADDRESS);

  _baseSensorAddress =
      static_cast<uint16_t>(
          S88_I2C_BASE_SENSOR_ADDRESS);

  Logger::info(
      "S88 I2C master starting: "
      "SDA=" +
      String(S88_I2C_SDA_PIN) +
      " SCL=" +
      String(S88_I2C_SCL_PIN) +
      " clock=" +
      String(S88_I2C_CLOCK_HZ) +
      "Hz target=" +
      formatAddress(
          _slaveAddress) +
      " baseSensor=" +
      String(
          _baseSensorAddress));

  const bool started =
      Wire.begin(
          S88_I2C_SDA_PIN,
          S88_I2C_SCL_PIN,
          S88_I2C_CLOCK_HZ);

  if (!started) {
    Logger::error(
        "S88 I2C master initialization failed");

    return;
  }

  _initialized =
      true;

  scanBus();

  updateSlavePresence(
      true);

  _lastProbeMs =
      millis();

  _lastReadMs =
      millis();
#else
  _enabled =
      false;

  Logger::info(
      "S88 I2C master disabled for this Hub target");
#endif
}

void S88I2CMaster::loop() {
  if (
      !_enabled ||
      !_initialized
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
