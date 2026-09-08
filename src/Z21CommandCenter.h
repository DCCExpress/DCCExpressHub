#pragma once

#include <Arduino.h>
#include <WiFiUdp.h>

#include "ICommandCenter.h"

class Z21CommandCenter
    : public ICommandCenter {
public:
  void begin(
      const String& host,
      uint16_t port) override;

  void loop() override;

  bool ensureConnected() override;

  void setEndpoint(
      const String& host,
      uint16_t port) override;

  bool connected() override;

  const String& host() const override {
    return _host;
  }

  uint16_t port() const override {
    return _port;
  }

  const char* type() const override {
    return "z21";
  }

  const char* name() const override {
    return "Roco Z21";
  }

  void onRawInfo(
      RawInfoCallback callback) override {
    _rawInfoCallback =
        std::move(callback);
  }

  void onStationInfo(
      StationInfoCallback callback) override {
    _stationInfoCallback =
        std::move(callback);
  }

  void onTrackConfiguration(
      TrackConfigurationCallback callback) override {
    _trackConfigurationCallback =
        std::move(callback);
  }

  void onCurrentTelemetry(
      CurrentTelemetryCallback callback) override {
    _currentTelemetryCallback =
        std::move(callback);
  }

  void onTripTelemetry(
      TripTelemetryCallback callback) override {
    _tripTelemetryCallback =
        std::move(callback);
  }

  void onPowerFeedback(
      PowerFeedbackCallback callback) override {
    _powerFeedbackCallback =
        std::move(callback);
  }

  void onLocoFeedback(
      LocoFeedbackCallback callback) override {
    _locoFeedbackCallback =
        std::move(callback);
  }

  bool setTrackPower(
      bool on,
      bool includeProgramming = true) override;

  bool setProgrammingPower(
      bool on) override;

  bool emergencyStop() override;

  bool setLoco(
      uint16_t address,
      uint8_t speed,
      bool forward) override;

  bool requestLocoState(
      uint16_t address,
      bool logCommand = false) override;

  bool setLocoFunction(
      uint16_t address,
      uint8_t functionNumber,
      bool active) override;

  bool setTurnout(
      uint16_t address,
      bool closed) override;

  bool setAccessory(
      uint16_t address,
      bool active) override;

  bool setSignalAspect(
      uint16_t address,
      int16_t aspect) override;

  bool setVPin(
      uint16_t vpin,
      bool active) override;

  bool requestTrackConfiguration(
      bool logCommand = false) override;

  bool requestCurrentTelemetry(
      bool logCommand = false) override;

  bool requestTripTelemetry(
      bool logCommand = false) override;

  bool supportsRawCommand() const override {
    return false;
  }

  bool sendRawCommand(
      String command,
      bool logCommand = true) override;

private:
  static constexpr uint16_t
      DEFAULT_PORT = 21105;

  static constexpr uint16_t
      LOCAL_PORT = 21105;

  static constexpr unsigned long
      KEEPALIVE_MS = 10000;

  static constexpr unsigned long
      ONLINE_TIMEOUT_MS = 30000;

  static constexpr unsigned long
      RESOLVE_RETRY_MS = 3000;

  static constexpr uint32_t
      BROADCAST_FLAGS = 0x00000101UL;

  static constexpr uint8_t
      MAX_PACKET_BYTES = 128;

  static constexpr uint8_t
      MAX_PENDING_PULSES = 16;

  static constexpr unsigned long
      ACCESSORY_PULSE_MS = 120;

  WiFiUDP _udp;

  String _host;
  uint16_t _port = DEFAULT_PORT;

  IPAddress _remoteIp;
  bool _resolved = false;
  bool _udpStarted = false;
  bool _online = false;

  unsigned long _lastRxAt = 0;
  unsigned long _nextKeepaliveAt = 0;
  unsigned long _nextResolveAt = 0;

  CommandCenterStationInfo
      _stationInfo;

  struct PendingAccessoryPulse {
    bool active = false;
    uint16_t functionAddress = 0;
    bool position = false;
    unsigned long dueAt = 0;
  };

  PendingAccessoryPulse
      _pendingPulses[
          MAX_PENDING_PULSES];

  RawInfoCallback
      _rawInfoCallback;

  StationInfoCallback
      _stationInfoCallback;

  TrackConfigurationCallback
      _trackConfigurationCallback;

  CurrentTelemetryCallback
      _currentTelemetryCallback;

  TripTelemetryCallback
      _tripTelemetryCallback;

  PowerFeedbackCallback
      _powerFeedbackCallback;

  LocoFeedbackCallback
      _locoFeedbackCallback;

  bool startUdp();
  bool resolveRemote();

  bool sendPacket(
      uint16_t header,
      const uint8_t* data,
      size_t dataLen,
      bool logPacket = false);

  bool sendXBus(
      const uint8_t* payload,
      size_t payloadLen,
      bool logPacket = false);

  bool sendSimpleXBus(
      uint8_t xHeader,
      uint8_t db0,
      bool logPacket = false);

  bool setBroadcastFlags();

  bool sendAccessoryPulse(
      uint16_t functionAddress,
      bool position,
      bool activate);

  void queueAccessoryDeactivate(
      uint16_t functionAddress,
      bool position);

  void processAccessoryPulses(
      unsigned long now);

  bool requestSystemState(
      bool logPacket = false);

  bool requestHardwareInfo(
      bool logPacket = false);

  bool requestFirmwareVersion(
      bool logPacket = false);

  bool requestStatus(
      bool logPacket = false);

  void processIncoming();

  void processDatagram(
      const uint8_t* buffer,
      size_t length);

  void processDataset(
      const uint8_t* data,
      size_t length);

  void processXBus(
      const uint8_t* data,
      size_t length);

  void processSystemState(
      const uint8_t* data,
      size_t length);

  void processHardwareInfo(
      const uint8_t* data,
      size_t length);

  void emitTrackConfiguration();
  void emitStationInfo();

  static uint16_t readLe16(
      const uint8_t* data);

  static int16_t readLeS16(
      const uint8_t* data);

  static uint32_t readLe32(
      const uint8_t* data);

  static void writeLe16(
      uint8_t* data,
      uint16_t value);

  static void writeLe32(
      uint8_t* data,
      uint32_t value);

  static uint8_t xorBytes(
      const uint8_t* data,
      size_t length);

  static void encodeLocoAddress(
      uint16_t address,
      uint8_t& msb,
      uint8_t& lsb);

  static uint16_t basicAccessoryAddress(
      uint16_t address);

  static uint16_t extendedAccessoryRawAddress(
      uint16_t address);

  static String bcdVersion(
      uint32_t value);

  static String hardwareName(
      uint32_t hardwareType);
};
