#include "S88I2CMaster.h"

#include <ArduinoJson.h>
#include <Wire.h>

#include "Logger.h"
#include "S88I2CConfig.h"

#if defined(HUB_TARGET_WAVESHARE_S3_LCD7) && HUB_TARGET_WAVESHARE_S3_LCD7
#include "WaveshareLvglAdapter.h"
#endif

namespace {
#if defined(HUB_TARGET_WAVESHARE_S3_LCD7) && HUB_TARGET_WAVESHARE_S3_LCD7
bool isWaveshareReservedI2CAddress(uint8_t address) {
  // ESP32-S3-Touch-LCD-7 onboard devices:
  // CH422G aliases: 0x20..0x27 and 0x30..0x3F
  // GT911: 0x5D normally, 0x14 is its alternate address.
  return
      (address >= 0x20 && address <= 0x27) ||
      (address >= 0x30 && address <= 0x3F) ||
      address == 0x5D ||
      address == 0x14;
}

class WaveshareSharedI2CGuard {
public:
  explicit WaveshareSharedI2CGuard(uint32_t timeoutMs = 25)
      : _locked(waveshareSharedI2CLock(timeoutMs)) {}

  ~WaveshareSharedI2CGuard() {
    if (_locked) {
      waveshareSharedI2CUnlock();
    }
  }

  bool locked() const { return _locked; }

private:
  bool _locked = false;
};
#endif
}  // namespace

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

String S88I2CMaster::firmwareVersion() const {
  if (!_adapterInfoKnown) {
    return String("-");
  }

  return
      String(_firmwareMajor) +
      "." +
      String(_firmwareMinor) +
      "." +
      String(_firmwarePatch);
}

bool S88I2CMaster::startBus() {
  if (_busInitialized) {
    return true;
  }

#if S88_I2C_ENABLED
  // The Waveshare ESP32-S3-Touch-LCD-7 uses one shared I2C bus on GPIO8/GPIO9
  // for the onboard GT911 touch controller, CH422G IO expander and the external
  // S88 adapter. The display driver initializes Arduino Wire before the S88
  // master starts. Re-running Wire.begin() here can invalidate the I2C host
  // state already owned by the touch/panel stack and causes continuous GT911
  // read failures. On this target S88 therefore only reuses the existing bus.
#if defined(HUB_TARGET_WAVESHARE_S3_LCD7)
  Logger::info(
      "S88 I2C: reusing Waveshare shared bus "
      "SDA=" +
      String(S88_I2C_SDA_PIN) +
      " SCL=" +
      String(S88_I2C_SCL_PIN) +
      " clock=" +
      String(S88_I2C_CLOCK_HZ) +
      "Hz");

  _busInitialized =
      true;

  return true;
#else
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
#endif
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

  File file =
      fs.open(
          DEVICE_CONFIG_PATH,
          "r");

  if (!file) {
    Logger::info(
        "S88 device config not found; using firmware default I2C address");

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
        "S88 device config JSON parse failed; using firmware default I2C address");

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

    if (
        address < 0x08 ||
        address > 0x77
#if defined(HUB_TARGET_WAVESHARE_S3_LCD7) && HUB_TARGET_WAVESHARE_S3_LCD7
        || isWaveshareReservedI2CAddress(
               static_cast<uint8_t>(address))
#endif
    ) {
#if defined(HUB_TARGET_WAVESHARE_S3_LCD7) && HUB_TARGET_WAVESHARE_S3_LCD7
      Logger::warn(
          "Invalid/reserved S88 I2C address in device-config.json; "
          "Waveshare LCD7 reserves 0x20-0x27, 0x30-0x3F and touch address 0x5D; "
          "using firmware default " +
          formatAddress(static_cast<uint8_t>(S88_I2C_ADDRESS)));
#else
      Logger::warn(
          "Invalid S88 I2C address in device-config.json; using firmware default");
#endif

      settings.address =
          static_cast<uint8_t>(S88_I2C_ADDRESS);

      return false;
    }

    settings.enabled =
        enabled;

    settings.address =
        static_cast<uint8_t>(
            address);

    return true;
  }

  Logger::info(
      "No S88 adapter entry in device config; using firmware default I2C address");

  return true;
}

bool S88I2CMaster::dataFresh() const {
  if (
      !_enabled ||
      !_slavePresent ||
      !_adapterInfoKnown ||
      !_snapshotKnown ||
      _lastSuccessfulReadMs == 0
  ) {
    return false;
  }

  return
      millis() -
          _lastSuccessfulReadMs <=
      S88_I2C_DATA_FRESH_MS;
}

void S88I2CMaster::clearPublishedSensors(
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
            BASE_SENSOR_ADDRESS +
            offset),
        false);
  }
}

void S88I2CMaster::invalidateAdapterInfo() {
  _adapterInfoKnown =
      false;

  _byteCount =
      0;

  _protocolVersion =
      0;

  _firmwareMajor =
      0;

  _firmwareMinor =
      0;

  _firmwarePatch =
      0;

  _adapterMaxByteCount =
      0;

  _adapterCapabilities =
      0;

  _snapshotKnown =
      false;

  _lastSuccessfulReadMs =
      0;

  memset(
      _activeBytes,
      0,
      sizeof(_activeBytes));
}

bool S88I2CMaster::applySettings(
    const Settings& settings) {
  const bool settingsChanged =
      _enabled !=
          settings.enabled ||
      _slaveAddress !=
          settings.address;

  if (!settingsChanged) {
    return false;
  }

  if (
      _hasPublishedState &&
      _publishedSensorCount > 0
  ) {
    clearPublishedSensors(
        _publishedSensorCount);

    _hasPublishedState =
        false;

    _publishedSensorCount =
        0;
  }

  const bool addressChanged =
      _slaveAddress !=
      settings.address;

  _enabled =
      settings.enabled;

  _slaveAddress =
      settings.address;

  invalidateAdapterInfo();

  _lastInfoAttemptMs =
      0;

  _lastInfoSuccessMs =
      0;

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
      " adapter owns byte count");

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

    invalidateAdapterInfo();

    Logger::info(
        "S88 adapter disabled by device configuration");

    return parsed;
  }

  updateSlavePresence(
      true);

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

#if defined(HUB_TARGET_WAVESHARE_S3_LCD7) && HUB_TARGET_WAVESHARE_S3_LCD7
  WaveshareSharedI2CGuard busGuard;
  if (!busGuard.locked()) {
    return false;
  }
#endif

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

#if defined(HUB_TARGET_WAVESHARE_S3_LCD7) && HUB_TARGET_WAVESHARE_S3_LCD7
  // Do not sweep the whole bus on this board. CH422G intentionally responds
  // through multiple command addresses, which makes a generic scanner look as
  // if dozens of devices exist and can produce false S88 positives. Probe only
  // the configured, collision-free S88 address.
  Logger::info(
      "I2C scan: Waveshare onboard ranges are reserved; probing S88 only at " +
      formatAddress(_slaveAddress));

  if (isWaveshareReservedI2CAddress(_slaveAddress)) {
    Logger::error(
        "S88 address " +
        formatAddress(_slaveAddress) +
        " conflicts with Waveshare onboard I2C devices; probe skipped");
    return;
  }

  Logger::info(
      String("S88 probe ") +
      formatAddress(_slaveAddress) +
      (ping(_slaveAddress) ? " ACK" : " no device"));
#else
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
          " [configured S88 adapter address]";
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
#endif
}

bool S88I2CMaster::requestAdapterInfo(
    bool forceLog) {
  if (
      !_enabled ||
      !_busInitialized ||
      !_slavePresent
  ) {
    return false;
  }

#if defined(HUB_TARGET_WAVESHARE_S3_LCD7) && HUB_TARGET_WAVESHARE_S3_LCD7
  WaveshareSharedI2CGuard busGuard(50);
  if (!busGuard.locked()) {
    return false;
  }
#endif

  _lastInfoAttemptMs =
      millis();

  const uint8_t selectorChecksum =
      static_cast<uint8_t>(
          PROTOCOL_MAGIC ^
          INFO_REQUEST);

  Wire.beginTransmission(
      _slaveAddress);

  Wire.write(
      PROTOCOL_MAGIC);

  Wire.write(
      INFO_REQUEST);

  Wire.write(
      selectorChecksum);

  const uint8_t selectResult =
      Wire.endTransmission(
          true);

  if (selectResult != 0) {
    if (
        forceLog ||
        _adapterInfoKnown
    ) {
      Logger::warn(
          "S88 INFO selector failed at " +
          formatAddress(
              _slaveAddress) +
          " code=" +
          String(selectResult));
    }

    invalidateAdapterInfo();
    return false;
  }

  const size_t received =
      Wire.requestFrom(
          _slaveAddress,
          INFO_RESPONSE_SIZE);

  if (
      received !=
      INFO_RESPONSE_SIZE
  ) {
    while (
        Wire.available()
    ) {
      Wire.read();
    }

    if (
        forceLog ||
        _adapterInfoKnown
    ) {
      Logger::warn(
          "S88 INFO short read from " +
          formatAddress(
              _slaveAddress) +
          ": expected=" +
          String(INFO_RESPONSE_SIZE) +
          " received=" +
          String(received));
    }

    invalidateAdapterInfo();
    return false;
  }

  uint8_t packet[
      INFO_RESPONSE_SIZE] = {};

  for (
      uint8_t index = 0;
      index < INFO_RESPONSE_SIZE;
      ++index
  ) {
    if (!Wire.available()) {
      Logger::warn(
          "S88 INFO receive buffer ended unexpectedly");

      invalidateAdapterInfo();
      return false;
    }

    packet[index] =
        static_cast<uint8_t>(
            Wire.read());
  }

  uint8_t checksum =
      0;

  for (
      uint8_t index = 0;
      index <
          INFO_RESPONSE_SIZE -
              1U;
      ++index
  ) {
    checksum ^=
        packet[index];
  }

  const uint8_t protocolVersion =
      packet[2];

  const uint8_t byteCount =
      packet[6];

  const uint8_t maxByteCount =
      packet[7];

  const bool valid =
      packet[0] ==
          PROTOCOL_MAGIC &&
      packet[1] ==
          INFO_RESPONSE &&
      packet[9] ==
          checksum &&
      protocolVersion ==
          SUPPORTED_PROTOCOL_VERSION &&
      byteCount >= 1 &&
      byteCount <=
          MAX_DATA_BYTES &&
      maxByteCount >=
          byteCount;

  if (!valid) {
    Logger::warn(
        "S88 INFO packet invalid at " +
        formatAddress(
            _slaveAddress));

    invalidateAdapterInfo();
    return false;
  }

  const bool hadInfo =
      _adapterInfoKnown;

  const uint8_t oldByteCount =
      _byteCount;

  const uint16_t newSensorCount =
      static_cast<uint16_t>(
          byteCount) *
      BITS_PER_BYTE;

  const bool byteCountChanged =
      hadInfo &&
      oldByteCount !=
          byteCount;

  // Adapter INFO may have been invalidated by a disconnect or short read, so
  // compare against the last actually published mapping as well.
  if (
      _hasPublishedState &&
      _publishedSensorCount > 0 &&
      _publishedSensorCount !=
          newSensorCount
  ) {
    clearPublishedSensors(
        _publishedSensorCount);

    _hasPublishedState =
        false;

    _publishedSensorCount =
        0;
  }

  _adapterInfoKnown =
      true;

  _protocolVersion =
      protocolVersion;

  _firmwareMajor =
      packet[3];

  _firmwareMinor =
      packet[4];

  _firmwarePatch =
      packet[5];

  _byteCount =
      byteCount;

  _adapterMaxByteCount =
      maxByteCount;

  _adapterCapabilities =
      packet[8];

  _lastInfoSuccessMs =
      millis();

  if (byteCountChanged) {
    _snapshotKnown =
        false;

    _lastSuccessfulReadMs =
        0;

    memset(
        _activeBytes,
        0,
        sizeof(_activeBytes));
  }

  if (
      !hadInfo ||
      byteCountChanged ||
      forceLog
  ) {
    Logger::info(
        "S88 adapter INFO: address=" +
        formatAddress(
            _slaveAddress) +
        " protocol=" +
        String(_protocolVersion) +
        " firmware=" +
        firmwareVersion() +
        " bytes=" +
        String(_byteCount) +
        " sensors=" +
        String(sensorCount()) +
        " maxBytes=" +
        String(_adapterMaxByteCount) +
        " capabilities=0x" +
        String(
            _adapterCapabilities,
            HEX));
  }

  return true;
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

  const bool changed =
      !_presenceKnown ||
      present !=
          _slavePresent;

  _presenceKnown =
      true;

  _slavePresent =
      present;

  if (changed) {
    invalidateAdapterInfo();

    _lastInfoAttemptMs =
        0;

    _lastInfoSuccessMs =
        0;
  }

  if (
      forceLog ||
      changed
  ) {
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

  if (
      present &&
      changed
  ) {
    requestAdapterInfo(
        true);
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
              BASE_SENSOR_ADDRESS +
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

  _hasPublishedState =
      true;

  _publishedSensorCount =
      static_cast<uint16_t>(
          count) *
      BITS_PER_BYTE;
}

bool S88I2CMaster::readSnapshot() {
  if (
      !_busInitialized ||
      !_enabled ||
      !_slavePresent ||
      !_adapterInfoKnown
  ) {
    return false;
  }

#if defined(HUB_TARGET_WAVESHARE_S3_LCD7) && HUB_TARGET_WAVESHARE_S3_LCD7
  WaveshareSharedI2CGuard busGuard(50);
  if (!busGuard.locked()) {
    return false;
  }
#endif

  const uint8_t expected =
      byteCount();

  if (
      expected < 1 ||
      expected >
          MAX_DATA_BYTES
  ) {
    invalidateAdapterInfo();
    return false;
  }

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
          String(received) +
          "; refreshing adapter INFO");
    }

    invalidateAdapterInfo();

    _lastInfoAttemptMs =
        0;

    return false;
  }

  uint8_t data[
      MAX_DATA_BYTES] = {};

  for (
      uint8_t index = 0;
      index < expected;
      ++index
  ) {
    if (!Wire.available()) {
      Logger::warn(
          "S88 I2C receive buffer ended unexpectedly");

      invalidateAdapterInfo();

      _lastInfoAttemptMs =
          0;

      return false;
    }

    data[index] =
        static_cast<uint8_t>(
            Wire.read());
  }

  _lastSuccessfulReadMs =
      millis();

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

  if (!_slavePresent) {
    return;
  }

  const bool infoDue =
      !_adapterInfoKnown
          ? (
                _lastInfoAttemptMs == 0 ||
                now -
                        _lastInfoAttemptMs >=
                    S88_I2C_INFO_RETRY_MS
            )
          : (
                _lastInfoSuccessMs == 0 ||
                now -
                        _lastInfoSuccessMs >=
                    S88_I2C_INFO_REFRESH_MS
            );

  if (infoDue) {
    requestAdapterInfo(
        !_adapterInfoKnown);
  }

  if (
      !_adapterInfoKnown ||
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
