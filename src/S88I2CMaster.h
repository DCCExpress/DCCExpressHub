#pragma once

#include <Arduino.h>
#include <FS.h>
#include <functional>

class S88I2CMaster {
public:
  using SensorChangeCallback =
      std::function<void(uint16_t address, bool occupied)>;

  // Transport model:
  //   one group = one byte = eight S88 sensors.
  static constexpr uint8_t BITS_PER_GROUP = 8;
  static constexpr uint8_t BYTES_PER_GROUP = 1;
  static constexpr uint8_t MAX_GROUPS = 32;
  static constexpr uint8_t MAX_DATA_BYTES = MAX_GROUPS;

  void begin(
      fs::FS& fs);

  void loop();

  bool reloadConfiguration(
      fs::FS& fs);

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

  bool adapterConfigurationSent() const {
    return _adapterConfigurationSent;
  }

  uint16_t baseSensorAddress() const {
    return _baseSensorAddress;
  }

  uint8_t groupCount() const {
    return _groupCount;
  }

  uint8_t byteCount() const {
    return _groupCount;
  }

  uint16_t sensorCount() const {
    return
        static_cast<uint16_t>(
            _groupCount) *
        BITS_PER_GROUP;
  }

  // Browser sensorSnapshot packets stay 16-bit for compatibility.
  uint8_t snapshotGroupCount() const {
    return
        static_cast<uint8_t>(
            (
                byteCount() +
                1U
            ) /
            2U);
  }

  uint16_t activeBitsForSnapshotGroup(
      uint8_t snapshotGroupIndex) const;

  uint16_t knownBitsForSnapshotGroup(
      uint8_t snapshotGroupIndex) const;

private:
  struct Settings {
    bool enabled = true;
    uint8_t address = 0x30;
    uint16_t baseAddress = 1;
    uint8_t groupCount = 2;
  };

  static constexpr const char* DEVICE_CONFIG_PATH =
      "/config/device-config.json";

  static constexpr uint8_t CONFIG_MAGIC =
      0xA5;

  static constexpr uint8_t CONFIG_COMMAND =
      0x01;

  bool _enabled = false;
  bool _busInitialized = false;
  bool _slavePresent = false;
  bool _presenceKnown = false;
  bool _snapshotKnown = false;
  bool _adapterConfigurationSent = false;

  uint8_t _slaveAddress = 0x30;
  uint16_t _baseSensorAddress = 1;
  uint8_t _groupCount = 2;

  uint8_t _activeBytes[
      MAX_DATA_BYTES] = {};

  unsigned long _lastProbeMs = 0;
  unsigned long _lastReadMs = 0;
  unsigned long _lastShortReadLogMs = 0;

  SensorChangeCallback
      _sensorChangeCallback;

  bool startBus();

  bool loadSettings(
      fs::FS& fs,
      Settings& settings);

  bool applySettings(
      const Settings& settings);

  void clearPublishedSensors(
      uint16_t baseAddress,
      uint16_t sensorCount);

  bool ping(
      uint8_t address);

  void scanBus();

  void updateSlavePresence(
      bool forceLog);

  bool sendAdapterConfiguration();

  bool readSnapshot();

  void publishSnapshot(
      const uint8_t* data,
      uint8_t count);

  static String formatAddress(
      uint8_t address);

  static String formatBits(
      const uint8_t* data,
      uint8_t count);
};
