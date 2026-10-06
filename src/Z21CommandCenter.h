#pragma once

#include <Arduino.h>
#include <WiFiUdp.h>
#if defined(HUB_CC_YAMORC7010)
#include <WiFiClient.h>
#endif

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
#if defined(HUB_CC_YAMORC7010)
    return "YD7010";
#else
    return "Z21";
#endif
  }

  const char* feedbackLinkName() const override {
#if defined(HUB_CC_YAMORC7010)
    return "LocoNet";
#else
    return "";
#endif
  }

  bool feedbackLinkConnected() const override {
#if defined(HUB_CC_YAMORC7010)
    // LBServer/1234 is the authoritative YaMoRC sensor link.
    return _lbConnected;
#else
    return false;
#endif
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

  void onSensorFeedback(
      SensorFeedbackCallback callback) override {
    _sensorFeedbackCallback =
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

  bool requestSensorSnapshot(
      bool logCommand = false) override;

  void onProgrammingFeedback(
      ProgrammingFeedbackCallback callback) override {
    _programmingFeedbackCallback =
        std::move(callback);
  }

  bool readServiceCv(
      uint16_t cv) override;

  bool writeServiceCv(
      uint16_t cv,
      uint8_t value) override;

  bool readPomCv(
      uint16_t address,
      uint16_t cv) override;

  bool writePomCv(
      uint16_t address,
      uint16_t cv,
      uint8_t value) override;

  bool readAccessoryPomCv(
      uint16_t decoderAddress,
      uint16_t cv) override;

  bool writeAccessoryPomCv(
      uint16_t decoderAddress,
      uint16_t cv,
      uint8_t value) override;

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

  // Z21 broadcast subscriptions:
  // 0x00000001 driving/switching
  // 0x00000002 R-BUS feedback
  // 0x00000100 system state
  // 0x00010000 all changed locomotives
  // 0x08000000 LocoNet detector feedback
  // YD7010 additionally forwards generic LocoNet bus traffic (0x01000000),
  // which carries OPC_INPUT_REP feedback used by S88/LocoNet bridges.
  static constexpr uint32_t
      BROADCAST_FLAGS =
#if defined(HUB_CC_YAMORC7010)
          0x09010103UL;
#else
          0x08010103UL;
#endif

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

#if defined(HUB_CC_YAMORC7010)
  bool _z21BootstrapReady = false;
  unsigned long _z21BootstrapReadyAt = 0;
#endif

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

  SensorFeedbackCallback
      _sensorFeedbackCallback;

  ProgrammingFeedbackCallback
      _programmingFeedbackCallback;

#if defined(HUB_CC_YAMORC7010)
  static constexpr uint16_t
      LB_SERVER_PORT = 1234;

  static constexpr uint16_t
      LN_BINARY_PORT = 5560;

  static constexpr unsigned long
      LB_RECONNECT_MS = 2000;

  // Start feedback only after the authoritative Z21 UDP bootstrap completed
  // and the UI/runtime had time to consume its initial status snapshot.
  static constexpr unsigned long
      FEEDBACK_START_DELAY_MS = 3000;

  // LocoNet feedback is deliberately low-rate on the embedded runtime.
  // At most one complete LocoNet message is processed per second; any extra
  // messages arriving inside the window are drained and discarded.
  static constexpr unsigned long
      LOCONET_PROCESS_INTERVAL_MS = 1000;

  // Interrogation is also paced at one request per second. Never burst an
  // eight-step sensor scan into the same window as the UI startup snapshot.
  static constexpr unsigned long
      LOCONET_INTERROGATE_INTERVAL_MS = 1000;

  // TCP connect runs on the ESP32 main loop. A healthy YaMoRC LBServer on
  // the same LAN accepts within a few milliseconds; a long timeout only stalls
  // the whole Hub when the service is unavailable. Retry frequently instead of
  // blocking the runtime.
  static constexpr uint32_t
      FEEDBACK_CONNECT_TIMEOUT_MS = 150;


  WiFiClient _lbClient;
  bool _lbConnected = false;
  unsigned long _nextLbConnectAt = 0;
  unsigned long _lastLbTrafficAt = 0;
  unsigned long _lastLbInterrogateAt = 0;
  unsigned long _nextLbInterrogateStepAt = 0;
  unsigned long _nextLocoNetProcessAt = 0;
  uint32_t _locoNetMessagesDropped = 0;
  uint8_t _lbInterrogatePhase = 0;
  char _lbLine[256] = {};
  size_t _lbLineLength = 0;
  uint32_t _lbLinesObserved = 0;
  uint32_t _lbPacketsObserved = 0;

  WiFiClient _lnBinaryClient;
  bool _lnBinaryConnected = false;
  unsigned long _nextLnBinaryConnectAt = 0;
  uint8_t _lnBinaryPacket[128] = {};
  size_t _lnBinaryPacketLength = 0;
  size_t _lnBinaryExpectedLength = 0;
  uint32_t _lnBinaryPacketsObserved = 0;
#endif

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

#if defined(HUB_CC_YAMORC7010)
  void loopLbServer(
      unsigned long now);

  bool connectLbServer();

  void disconnectLbServer();

  void processLbServerIncoming();

  void processLbServerLine(
      const char* line);

  void loopLocoNetBinary(
      unsigned long now);

  bool connectLocoNetBinary();

  void disconnectLocoNetBinary();

  void processLocoNetBinaryIncoming();

  static size_t locoNetMessageLength(
      const uint8_t* packet,
      size_t packetLength);

  void processLocoNetPacket(
      const uint8_t* packet,
      size_t length);

  void processLocoNetInputReport(
      const uint8_t* packet,
      size_t length);

  void startLocoNetInterrogate(
      bool force);

  void processLocoNetInterrogate(
      unsigned long now);
#endif

  bool sendCvDirect(
      bool write,
      uint16_t cv,
      uint8_t value);

  bool sendPomCv(
      bool accessory,
      bool write,
      uint16_t address,
      uint16_t cv,
      uint8_t value);

  void emitProgrammingFeedback(
      bool ok,
      uint16_t cv,
      int16_t value,
      const String& message,
      const String& raw);

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

  void processRBus(
      const uint8_t* data,
      size_t length);

  void processLocoNetMessage(
      const uint8_t* data,
      size_t length);

  void processLocoNetDetector(
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
