#pragma once

#include "IODevice.h"
#include "I2CManager.h"
#include "DIAG.h"

// DCCExpress S88Adapter -> DCC-EX HAL driver
//
// Adapter protocol v1:
//   INFO select write: A5 02 A7
//   INFO read: 10 bytes
//   Normal read: raw S88 bitmap, bit0 of byte0 = S88 input 1.
//
// IMPORTANT:
// DCC-EX IODevice ranges must be known when create() is called, so nPins is
// deliberately supplied in myHal.cpp. INFO is used to validate that the adapter
// is configured for at least that many inputs.
//
// Example:
//   DCCExpressS88::create(1001, 32, 0x30);
// gives VPIN 1001..1032 for S88 inputs 1..32.

class DCCExpressS88 : public IODevice {
public:
  static void create(VPIN firstVpin, uint16_t nPins, I2CAddress i2cAddress = 0x30) {
    if (nPins == 0 || nPins > MAX_INPUTS) {
      DIAG(F("DCCExpressS88: invalid input count %d"), nPins);
      return;
    }
    if (checkNoOverlap(firstVpin, (uint8_t)(nPins > 255 ? 255 : nPins), i2cAddress))
      new DCCExpressS88(firstVpin, nPins, i2cAddress);
  }

private:
  static constexpr uint8_t MAGIC = 0xA5;
  static constexpr uint8_t INFO_REQUEST = 0x02;
  static constexpr uint8_t INFO_RESPONSE = 0x82;
  static constexpr uint8_t PROTOCOL_VERSION = 1;
  static constexpr uint8_t INFO_SIZE = 10;
  static constexpr uint8_t MAX_BYTES = 32;
  static constexpr uint16_t MAX_INPUTS = MAX_BYTES * 8;
  static constexpr unsigned long REFRESH_US = 20000UL;

  uint8_t _snapshot[MAX_BYTES] = {};
  uint8_t _readBuffer[MAX_BYTES] = {};
  uint8_t _info[INFO_SIZE] = {};
  uint8_t _byteCount = 0;
  uint16_t _requestedPins = 0;
  unsigned long _lastRead = 0;
  I2CRB _i2crb;
  bool _readPending = false;

  DCCExpressS88(VPIN firstVpin, uint16_t nPins, I2CAddress i2cAddress) {
    _firstVpin = firstVpin;
    _nPins = nPins;
    _requestedPins = nPins;
    _I2CAddress = i2cAddress;
    addDevice(this);
  }

  static uint8_t checksum(const uint8_t *p, uint8_t count) {
    uint8_t c = 0;
    for (uint8_t i=0; i<count; ++i) c ^= p[i];
    return c;
  }

  //void fail(const __FlashStringHelper *message) {
  void fail(const char *message) {    
    DIAG(F("DCCExpressS88 I2C:%s %S"), _I2CAddress.toString(), message);
    _deviceState = DEVSTATE_FAILED;
  }

  void _begin() override {
    I2CManager.begin();

    if (!I2CManager.exists(_I2CAddress)) {
      fail(F("adapter not found"));
      return;
    }

    const uint8_t request[3] = { MAGIC, INFO_REQUEST, (uint8_t)(MAGIC ^ INFO_REQUEST) };
    uint8_t status = I2CManager.read(_I2CAddress, _info, INFO_SIZE, request, sizeof(request));
    if (status != I2C_STATUS_OK) {
      fail(F("INFO read failed"));
      return;
    }

    if (_info[0] != MAGIC ||
        _info[1] != INFO_RESPONSE ||
        _info[2] != PROTOCOL_VERSION ||
        checksum(_info, INFO_SIZE - 1) != _info[INFO_SIZE - 1]) {
      fail(F("invalid INFO response"));
      return;
    }

    _byteCount = _info[6];
    if (_byteCount < 1 || _byteCount > MAX_BYTES) {
      fail(F("invalid adapter byte count"));
      return;
    }

    const uint16_t availablePins = (uint16_t)_byteCount * 8U;
    if (_requestedPins > availablePins) {
      DIAG(F("DCCExpressS88 I2C:%s requested %d inputs but adapter provides %d"),
           _I2CAddress.toString(), _requestedPins, availablePins);
      _deviceState = DEVSTATE_FAILED;
      return;
    }

    // Initial blocking snapshot. This makes occupied inputs visible before the
    // first normal polling cycle.
    status = I2CManager.read(_I2CAddress, _snapshot, _byteCount);
    if (status != I2C_STATUS_OK) {
      fail(F("initial snapshot read failed"));
      return;
    }

    DIAG(F("DCCExpressS88 I2C:%s adapter v%d.%d.%d protocol %d, %d bytes/%d inputs, VPIN %d..%d"),
         _I2CAddress.toString(), _info[3], _info[4], _info[5], _info[2],
         _byteCount, availablePins, _firstVpin, _firstVpin + _requestedPins - 1);

    _lastRead = micros();
  }

  int _read(VPIN vpin) override {
    if (_deviceState == DEVSTATE_FAILED) return 0;
    const int pin = vpin - _firstVpin;
    if (pin < 0 || pin >= _requestedPins) return 0;
    return (_snapshot[pin / 8] & (1U << (pin % 8))) != 0;
  }

  void _loop(unsigned long currentMicros) override {
    if (_deviceState == DEVSTATE_FAILED) return;

    if (_readPending) {
      if (_i2crb.isBusy()) return;
      _readPending = false;

      if (_i2crb.status == I2C_STATUS_OK) {
        for (uint8_t i=0; i<_byteCount; ++i) _snapshot[i] = _readBuffer[i];
      } else {
        DIAG(F("DCCExpressS88 I2C:%s snapshot read error %d"),
             _I2CAddress.toString(), _i2crb.status);
      }
    }

    if (!_readPending && currentMicros - _lastRead >= REFRESH_US) {
      I2CManager.read(_I2CAddress, _readBuffer, _byteCount, nullptr, 0, &_i2crb);
      _readPending = true;
      _lastRead = currentMicros;
    }
  }

  void _display() override {
    DIAG(F("DCCExpressS88 I2C:%s VPIN %d-%d (%d inputs)"),
         _I2CAddress.toString(), _firstVpin,
         _firstVpin + _requestedPins - 1, _requestedPins);
  }
};
