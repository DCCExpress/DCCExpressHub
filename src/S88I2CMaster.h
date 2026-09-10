#pragma once

#include <Arduino.h>
#include <FS.h>
#include <functional>

class S88I2CMaster {
public:
  using SensorChangeCallback =
      std::function<void(uint16_t address, bool occupied)>;

  static constexpr uint8_t BITS_PER_BYTE = 8;
  static constexpr uint8_t MAX_DATA_BYTES = 32;
  static constexpr uint16_t BASE_SENSOR_ADDRESS = 1;

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

  bool adapterInfoKnown() const {
    return _adapterInfoKnown;
  }

  bool ready() const {
    return
        _enabled &&
        _slavePresent &&
        _adapterInfoKnown;
  }

  uint8_t slaveAddress() const {
    return _slaveAddress;
  }

  bool snapshotKnown() const {
    return _snapshotKnown;
  }

  bool dataFresh() const;

  uint16_t baseSensorAddress() const {
    return BASE_SENSOR_ADDRESS;
  }

  uint8_t byteCount() const {
    return
        _adapterInfoKnown
            ? _byteCount
            : 0;
  }

  // Kept as a runtime alias for existing status/UI code.
  // One S88 transport group is exactly one byte.
  uint8_t groupCount() const {
    return byteCount();
  }

  uint16_t sensorCount() const {
    return
        static_cast<uint16_t>(
            byteCount()) *
        BITS_PER_BYTE;
  }

  uint8_t protocolVersion() const {
    return _protocolVersion;
  }

  uint8_t firmwareMajor() const {
    return _firmwareMajor;
  }

  uint8_t firmwareMinor() const {
    return _firmwareMinor;
  }

  uint8_t firmwarePatch() const {
    return _firmwarePatch;
  }

  uint8_t adapterMaxByteCount() const {
    return _adapterMaxByteCount;
  }

  uint8_t adapterCapabilities() const {
    return _adapterCapabilities;
  }

  String firmwareVersion() const;

  // Browser sensorSnapshot packets stay 16-bit for compatibility.
  uint8_t snapshotGroupCount() const {
    const uint8_t bytes =
        byteCount();

    return
        bytes == 0
            ? 0
            : static_cast<uint8_t>(
                  (
                      bytes +
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
  };

  static constexpr const char* DEVICE_CONFIG_PATH =
      "/config/device-config.json";

  static constexpr uint8_t PROTOCOL_MAGIC = 0xA5;
  static constexpr uint8_t INFO_REQUEST = 0x02;
  static constexpr uint8_t INFO_RESPONSE = 0x82;
  static constexpr uint8_t SUPPORTED_PROTOCOL_VERSION = 1;
  static constexpr uint8_t INFO_RESPONSE_SIZE = 10;

  bool _enabled = false;
  bool _busInitialized = false;
  bool _slavePresent = false;
  bool _presenceKnown = false;
  bool _adapterInfoKnown = false;
  bool _snapshotKnown = false;

  // True once at least one snapshot has been published. This survives a
  // temporary adapter disconnect so changing the configured I2C address can
  // clear previously published sensor states.
  bool _hasPublishedState = false;
  uint16_t _publishedSensorCount = 0;

  uint8_t _slaveAddress = 0x30;

  uint8_t _byteCount = 0;
  uint8_t _protocolVersion = 0;
  uint8_t _firmwareMajor = 0;
  uint8_t _firmwareMinor = 0;
  uint8_t _firmwarePatch = 0;
  uint8_t _adapterMaxByteCount = 0;
  uint8_t _adapterCapabilities = 0;

  uint8_t _activeBytes[
      MAX_DATA_BYTES] = {};

  unsigned long _lastProbeMs = 0;
  unsigned long _lastReadMs = 0;
  unsigned long _lastShortReadLogMs = 0;
  unsigned long _lastInfoAttemptMs = 0;
  unsigned long _lastInfoSuccessMs = 0;
  unsigned long _lastSuccessfulReadMs = 0;

  SensorChangeCallback
      _sensorChangeCallback;

  bool startBus();

  bool loadSettings(
      fs::FS& fs,
      Settings& settings);

  bool applySettings(
      const Settings& settings);

  void clearPublishedSensors(
      uint16_t sensorCount);

  bool ping(
      uint8_t address);

  void scanBus();

  void updateSlavePresence(
      bool forceLog);

  bool requestAdapterInfo(
      bool forceLog = false);

  void invalidateAdapterInfo();

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
