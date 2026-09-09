#pragma once

#include <Arduino.h>
#include <functional>

class S88I2CMaster {
public:
  using SensorChangeCallback =
      std::function<void(uint16_t address, bool occupied)>;

  void begin();
  void loop();

  void onSensorChange(
      SensorChangeCallback callback) {
    _sensorChangeCallback =
        std::move(callback);
  }

  bool enabled() const {
    return _enabled;
  }

  bool slavePresent() const {
    return _slavePresent;
  }

  uint8_t slaveAddress() const {
    return _slaveAddress;
  }

  bool snapshotKnown() const {
    return _snapshotKnown;
  }

  uint16_t activeBits() const {
    return _activeBits;
  }

  uint16_t baseSensorAddress() const {
    return _baseSensorAddress;
  }

private:
  static constexpr uint8_t DATA_BYTES = 2;

  bool _enabled = false;
  bool _initialized = false;
  bool _slavePresent = false;
  bool _presenceKnown = false;
  bool _snapshotKnown = false;

  uint8_t _slaveAddress = 0;
  uint16_t _baseSensorAddress = 1;
  uint16_t _activeBits = 0;

  unsigned long _lastProbeMs = 0;
  unsigned long _lastReadMs = 0;

  SensorChangeCallback
      _sensorChangeCallback;

  bool ping(
      uint8_t address);

  void scanBus();

  void updateSlavePresence(
      bool forceLog);

  bool readSnapshot();

  void publishSnapshot(
      uint16_t activeBits);

  static String formatAddress(
      uint8_t address);

  static String formatBits(
      uint16_t activeBits);
};
