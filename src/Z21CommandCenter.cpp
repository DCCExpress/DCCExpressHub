#include "Z21CommandCenter.h"

#include <WiFi.h>

#include "Logger.h"

void Z21CommandCenter::begin(
    const String& host,
    uint16_t port) {
  setEndpoint(
      host,
      port == 0
          ? DEFAULT_PORT
          : port);

  _stationInfo.processor =
      "Z21 LAN";

  _stationInfo.maxLocos =
      100;

  startUdp();
}

void Z21CommandCenter::setEndpoint(
    const String& host,
    uint16_t port) {
  _host =
      host;

  _host.trim();

  _port =
      port == 0
          ? DEFAULT_PORT
          : port;

  _resolved =
      false;

  _online =
      false;

  _lastRxAt =
      0;

  _nextKeepaliveAt =
      0;

  _nextResolveAt =
      0;

  _remoteIp =
      IPAddress();

  if (_udpStarted) {
    _udp.stop();
    _udpStarted =
        false;
  }
}

bool Z21CommandCenter::startUdp() {
  if (_udpStarted) {
    return true;
  }

  if (
      WiFi.status() !=
      WL_CONNECTED
  ) {
    return false;
  }

  if (!_udp.begin(
          LOCAL_PORT)) {
    Logger::warn(
        "Z21 UDP bind failed on local port " +
        String(
            LOCAL_PORT));

    return false;
  }

  _udpStarted =
      true;

  Logger::info(
      "Z21 UDP client started on local port " +
      String(
          LOCAL_PORT));

  return true;
}

bool Z21CommandCenter::resolveRemote() {
  if (_resolved) {
    return true;
  }

  if (
      WiFi.status() !=
      WL_CONNECTED
  ) {
    return false;
  }

  const unsigned long now =
      millis();

  if (
      _nextResolveAt != 0 &&
      static_cast<long>(
          now -
          _nextResolveAt) < 0
  ) {
    return false;
  }

  IPAddress parsed;

  if (
      parsed.fromString(
          _host)
  ) {
    _remoteIp =
        parsed;

    _resolved =
        true;
  } else {
    const int result =
        WiFi.hostByName(
            _host.c_str(),
            _remoteIp);

    _resolved =
        result == 1;
  }

  if (!_resolved) {
    _nextResolveAt =
        now +
        RESOLVE_RETRY_MS;

    Logger::warn(
        "Z21 host resolve failed: " +
        _host);

    return false;
  }

  Logger::info(
      "Z21 endpoint resolved " +
      _host +
      " -> " +
      _remoteIp.toString() +
      ":" +
      String(
          _port));

  return true;
}

bool Z21CommandCenter::ensureConnected() {
  if (!startUdp()) {
    return false;
  }

  if (!resolveRemote()) {
    return false;
  }

  setBroadcastFlags();
  requestHardwareInfo(
      false);
  requestFirmwareVersion(
      false);
  requestStatus(
      false);
  requestSystemState(
      false);

  _nextKeepaliveAt =
      millis() +
      KEEPALIVE_MS;

  return true;
}

bool Z21CommandCenter::connected() {
  if (!_online) {
    return false;
  }

  const unsigned long now =
      millis();

  if (
      _lastRxAt == 0 ||
      now -
          _lastRxAt >
          ONLINE_TIMEOUT_MS
  ) {
    _online =
        false;

    return false;
  }

  return true;
}

void Z21CommandCenter::loop() {
  if (
      WiFi.status() !=
      WL_CONNECTED
  ) {
    _online =
        false;

    return;
  }

  if (!startUdp()) {
    return;
  }

  if (!resolveRemote()) {
    return;
  }

  processIncoming();

  const unsigned long now =
      millis();

  processAccessoryPulses(
      now);

  if (
      _nextKeepaliveAt == 0 ||
      static_cast<long>(
          now -
          _nextKeepaliveAt) >= 0
  ) {
    requestSystemState(
        false);

    _nextKeepaliveAt =
        now +
        KEEPALIVE_MS;
  }

  if (
      _online &&
      _lastRxAt != 0 &&
      now -
          _lastRxAt >
          ONLINE_TIMEOUT_MS
  ) {
    _online =
        false;

    Logger::warn(
        "Z21 UDP session offline: reply timeout");
  }
}

bool Z21CommandCenter::sendPacket(
    uint16_t header,
    const uint8_t* data,
    size_t dataLen,
    bool logPacket) {
  if (
      !startUdp() ||
      !resolveRemote()
  ) {
    return false;
  }

  const size_t totalLen =
      4 +
      dataLen;

  if (
      totalLen >
      MAX_PACKET_BYTES
  ) {
    return false;
  }

  uint8_t packet[
      MAX_PACKET_BYTES] = {};

  writeLe16(
      packet,
      static_cast<uint16_t>(
          totalLen));

  writeLe16(
      packet +
          2,
      header);

  if (
      data &&
      dataLen > 0
  ) {
    memcpy(
        packet +
            4,
        data,
        dataLen);
  }

  if (
      !_udp.beginPacket(
          _remoteIp,
          _port)
  ) {
    Logger::warn(
        "Z21 UDP beginPacket failed");

    return false;
  }

  const size_t written =
      _udp.write(
          packet,
          totalLen);

  const int result =
      _udp.endPacket();

  if (
      written != totalLen ||
      result != 1
  ) {
    Logger::warn(
        "Z21 UDP TX failed");

    return false;
  }

  if (logPacket) {
    Logger::info(
        "Z21 UDP TX header=0x" +
        String(
            header,
            HEX) +
        " bytes=" +
        String(
            totalLen));
  }

  return true;
}

bool Z21CommandCenter::sendXBus(
    const uint8_t* payload,
    size_t payloadLen,
    bool logPacket) {
  if (
      !payload ||
      payloadLen == 0 ||
      payloadLen +
              1 >
          MAX_PACKET_BYTES -
              4
  ) {
    return false;
  }

  uint8_t data[
      MAX_PACKET_BYTES] = {};

  memcpy(
      data,
      payload,
      payloadLen);

  data[payloadLen] =
      xorBytes(
          payload,
          payloadLen);

  return sendPacket(
      0x0040,
      data,
      payloadLen +
          1,
      logPacket);
}

bool Z21CommandCenter::sendSimpleXBus(
    uint8_t xHeader,
    uint8_t db0,
    bool logPacket) {
  const uint8_t payload[] = {
      xHeader,
      db0};

  return sendXBus(
      payload,
      sizeof(
          payload),
      logPacket);
}

bool Z21CommandCenter::setBroadcastFlags() {
  uint8_t data[4];

  writeLe32(
      data,
      BROADCAST_FLAGS);

  return sendPacket(
      0x0050,
      data,
      sizeof(
          data),
      false);
}

bool Z21CommandCenter::requestSystemState(
    bool logPacket) {
  return sendPacket(
      0x0085,
      nullptr,
      0,
      logPacket);
}

bool Z21CommandCenter::requestHardwareInfo(
    bool logPacket) {
  return sendPacket(
      0x001A,
      nullptr,
      0,
      logPacket);
}

bool Z21CommandCenter::requestFirmwareVersion(
    bool logPacket) {
  return sendSimpleXBus(
      0xF1,
      0x0A,
      logPacket);
}

bool Z21CommandCenter::requestStatus(
    bool logPacket) {
  return sendSimpleXBus(
      0x21,
      0x24,
      logPacket);
}

bool Z21CommandCenter::setTrackPower(
    bool on,
    bool includeProgramming) {
  (void)includeProgramming;

  return sendSimpleXBus(
      0x21,
      on
          ? 0x81
          : 0x80,
      true);
}

bool Z21CommandCenter::setProgrammingPower(
    bool on) {
  if (!on) {
    // Z21 does not expose a separate "programming track power off" LAN
    // command. Track power ON exits programming mode.
    return setTrackPower(
        true,
        false);
  }

  Logger::warn(
      "Z21: programming mode is entered by CV commands, not by a separate power command");

  return false;
}

bool Z21CommandCenter::emergencyStop() {
  const uint8_t payload[] = {
      0x80};

  return sendXBus(
      payload,
      sizeof(
          payload),
      true);
}

void Z21CommandCenter::encodeLocoAddress(
    uint16_t address,
    uint8_t& msb,
    uint8_t& lsb) {
  msb =
      static_cast<uint8_t>(
          (address >>
           8) &
          0x3F);

  lsb =
      static_cast<uint8_t>(
          address &
          0xFF);

  if (
      address >= 128
  ) {
    msb |=
        0xC0;
  }
}

bool Z21CommandCenter::setLoco(
    uint16_t address,
    uint8_t speed,
    bool forward) {
  if (
      address == 0 ||
      address > 9999 ||
      speed > 126
  ) {
    return false;
  }

  uint8_t msb;
  uint8_t lsb;

  encodeLocoAddress(
      address,
      msb,
      lsb);

  uint8_t speedByte =
      speed == 0
          ? 0
          : static_cast<uint8_t>(
                speed +
                1);

  if (forward) {
    speedByte |=
        0x80;
  }

  const uint8_t payload[] = {
      0xE4,
      0x13,
      msb,
      lsb,
      speedByte};

  return sendXBus(
      payload,
      sizeof(
          payload),
      true);
}

bool Z21CommandCenter::requestLocoState(
    uint16_t address,
    bool logCommand) {
  if (
      address == 0 ||
      address > 9999
  ) {
    return false;
  }

  uint8_t msb;
  uint8_t lsb;

  encodeLocoAddress(
      address,
      msb,
      lsb);

  const uint8_t payload[] = {
      0xE3,
      0xF0,
      msb,
      lsb};

  return sendXBus(
      payload,
      sizeof(
          payload),
      logCommand);
}

bool Z21CommandCenter::setLocoFunction(
    uint16_t address,
    uint8_t functionNumber,
    bool active) {
  if (
      address == 0 ||
      address > 9999 ||
      functionNumber > 28
  ) {
    return false;
  }

  uint8_t msb;
  uint8_t lsb;

  encodeLocoAddress(
      address,
      msb,
      lsb);

  const uint8_t function =
      static_cast<uint8_t>(
          (active
               ? 0x40
               : 0x00) |
          (functionNumber &
           0x3F));

  const uint8_t payload[] = {
      0xE4,
      0xF8,
      msb,
      lsb,
      function};

  return sendXBus(
      payload,
      sizeof(
          payload),
      true);
}

uint16_t Z21CommandCenter::basicAccessoryAddress(
    uint16_t address) {
  return
      address > 0
          ? static_cast<uint16_t>(
                address -
                1)
          : 0;
}

uint16_t Z21CommandCenter::extendedAccessoryRawAddress(
    uint16_t address) {
  return
      address > 0
          ? static_cast<uint16_t>(
                address +
                3)
          : 0;
}

bool Z21CommandCenter::sendAccessoryPulse(
    uint16_t functionAddress,
    bool position,
    bool activate) {
  const uint8_t msb =
      static_cast<uint8_t>(
          functionAddress >>
          8);

  const uint8_t lsb =
      static_cast<uint8_t>(
          functionAddress &
          0xFF);

  uint8_t control =
      0xA0;

  if (activate) {
    control |=
        0x08;
  }

  if (position) {
    control |=
        0x01;
  }

  const uint8_t payload[] = {
      0x53,
      msb,
      lsb,
      control};

  return sendXBus(
      payload,
      sizeof(
          payload),
      true);
}

void Z21CommandCenter::queueAccessoryDeactivate(
    uint16_t functionAddress,
    bool position) {
  const unsigned long dueAt =
      millis() +
      ACCESSORY_PULSE_MS;

  for (
      auto& pulse :
      _pendingPulses
  ) {
    if (!pulse.active) {
      pulse.active =
          true;

      pulse.functionAddress =
          functionAddress;

      pulse.position =
          position;

      pulse.dueAt =
          dueAt;

      return;
    }
  }

  Logger::warn(
      "Z21 accessory pulse queue full; decoder must self-release output");
}

void Z21CommandCenter::processAccessoryPulses(
    unsigned long now) {
  for (
      auto& pulse :
      _pendingPulses
  ) {
    if (
        !pulse.active ||
        static_cast<long>(
            now -
            pulse.dueAt) < 0
    ) {
      continue;
    }

    sendAccessoryPulse(
        pulse.functionAddress,
        pulse.position,
        false);

    pulse.active =
        false;
  }
}

bool Z21CommandCenter::setTurnout(
    uint16_t address,
    bool closed) {
  if (
      address == 0 ||
      address > 2048
  ) {
    return false;
  }

  const uint16_t functionAddress =
      basicAccessoryAddress(
          address);

  // Hub "closed" maps to Z21 P=0, thrown maps to P=1.
  const bool position =
      !closed;

  if (
      !sendAccessoryPulse(
          functionAddress,
          position,
          true)
  ) {
    return false;
  }

  queueAccessoryDeactivate(
      functionAddress,
      position);

  return true;
}

bool Z21CommandCenter::setAccessory(
    uint16_t address,
    bool active) {
  if (
      address == 0 ||
      address > 2048
  ) {
    return false;
  }

  const uint16_t functionAddress =
      basicAccessoryAddress(
          address);

  if (
      !sendAccessoryPulse(
          functionAddress,
          active,
          true)
  ) {
    return false;
  }

  queueAccessoryDeactivate(
      functionAddress,
      active);

  return true;
}

bool Z21CommandCenter::setSignalAspect(
    uint16_t address,
    int16_t aspect) {
  if (
      address == 0 ||
      address > 2044 ||
      aspect < 0 ||
      aspect > 255
  ) {
    return false;
  }

  const uint16_t rawAddress =
      extendedAccessoryRawAddress(
          address);

  const uint8_t payload[] = {
      0x54,
      static_cast<uint8_t>(
          rawAddress >>
          8),
      static_cast<uint8_t>(
          rawAddress &
          0xFF),
      static_cast<uint8_t>(
          aspect),
      0x00};

  return sendXBus(
      payload,
      sizeof(
          payload),
      true);
}

bool Z21CommandCenter::setVPin(
    uint16_t vpin,
    bool active) {
  (void)vpin;
  (void)active;

  Logger::warn(
      "Z21 does not support DCC-EX VPin commands");

  return false;
}

bool Z21CommandCenter::requestTrackConfiguration(
    bool logCommand) {
  (void)logCommand;

  emitTrackConfiguration();

  return true;
}

bool Z21CommandCenter::requestCurrentTelemetry(
    bool logCommand) {
  return requestSystemState(
      logCommand);
}

bool Z21CommandCenter::requestTripTelemetry(
    bool logCommand) {
  (void)logCommand;

  if (_tripTelemetryCallback) {
    CommandCenterTripTelemetry event;
    event.count =
        0;

    _tripTelemetryCallback(
        event);
  }

  return true;
}

bool Z21CommandCenter::sendRawCommand(
    String command,
    bool logCommand) {
  (void)command;
  (void)logCommand;

  return false;
}

void Z21CommandCenter::processIncoming() {
  while (true) {
    const int packetSize =
        _udp.parsePacket();

    if (packetSize <= 0) {
      break;
    }

    uint8_t buffer[
        MAX_PACKET_BYTES] = {};

    const int read =
        _udp.read(
            buffer,
            min(
                packetSize,
                static_cast<int>(
                    sizeof(
                        buffer))));

    if (read <= 0) {
      continue;
    }

    processDatagram(
        buffer,
        static_cast<size_t>(
            read));
  }
}

void Z21CommandCenter::processDatagram(
    const uint8_t* buffer,
    size_t length) {
  size_t offset =
      0;

  bool validDataset =
      false;

  while (
      offset +
          4 <=
      length
  ) {
    const uint16_t dataLen =
        readLe16(
            buffer +
            offset);

    if (
        dataLen < 4 ||
        offset +
            dataLen >
            length
    ) {
      Logger::warn(
          "Z21 malformed UDP dataset");

      break;
    }

    processDataset(
        buffer +
            offset,
        dataLen);

    validDataset =
        true;

    offset +=
        dataLen;
  }

  if (validDataset) {
    const bool wasOnline =
        _online;

    _online =
        true;

    _lastRxAt =
        millis();

    if (!wasOnline) {
      Logger::info(
          "Z21 UDP session ONLINE");

      setBroadcastFlags();
      requestHardwareInfo(
          false);
      requestFirmwareVersion(
          false);
      requestStatus(
          false);
      requestSystemState(
          false);
      emitTrackConfiguration();
    }
  }
}

void Z21CommandCenter::processDataset(
    const uint8_t* data,
    size_t length) {
  if (
      !data ||
      length < 4
  ) {
    return;
  }

  const uint16_t header =
      readLe16(
          data +
          2);

  const uint8_t* payload =
      data +
      4;

  const size_t payloadLen =
      length -
      4;

  switch (header) {
    case 0x0040:
      processXBus(
          payload,
          payloadLen);
      break;

    case 0x0084:
      processSystemState(
          payload,
          payloadLen);
      break;

    case 0x001A:
      processHardwareInfo(
          payload,
          payloadLen);
      break;

    default:
      break;
  }
}

void Z21CommandCenter::processXBus(
    const uint8_t* data,
    size_t length) {
  if (
      !data ||
      length < 2
  ) {
    return;
  }

  const uint8_t xHeader =
      data[0];

  if (
      xHeader == 0x61 &&
      length >= 3
  ) {
    CommandCenterPowerFeedback
        event;

    switch (data[1]) {
      case 0x00:
        event.on =
            false;

        event.target =
            CommandCenterPowerTarget::All;
        break;

      case 0x01:
        event.on =
            true;

        event.target =
            CommandCenterPowerTarget::All;
        break;

      case 0x02:
        event.on =
            true;

        event.target =
            CommandCenterPowerTarget::Programming;
        break;

      case 0x08:
        event.on =
            false;

        event.target =
            CommandCenterPowerTarget::All;
        break;

      default:
        return;
    }

    if (_powerFeedbackCallback) {
      _powerFeedbackCallback(
          event);
    }

    return;
  }

  if (
      xHeader == 0x81
  ) {
    if (_rawInfoCallback) {
      _rawInfoCallback(
          "Z21: emergency stop active");
    }

    return;
  }

  if (
      xHeader == 0x62 &&
      length >= 4 &&
      data[1] == 0x22
  ) {
    const uint8_t status =
        data[2];

    CommandCenterPowerFeedback
        event;

    event.on =
        (status &
         0x02) ==
        0;

    event.target =
        (status &
         0x20)
            ? CommandCenterPowerTarget::Programming
            : CommandCenterPowerTarget::All;

    if (_powerFeedbackCallback) {
      _powerFeedbackCallback(
          event);
    }

    return;
  }

  if (
      xHeader == 0xF3 &&
      length >= 5 &&
      data[1] == 0x0A
  ) {
    const uint8_t major =
        data[2];

    const uint8_t minor =
        data[3];

    _stationInfo.version =
        String(
            (major >>
             4) &
            0x0F) +
        String(
            major &
            0x0F) +
        "." +
        String(
            (minor >>
             4) &
            0x0F) +
        String(
            minor &
            0x0F);

    emitStationInfo();

    return;
  }

  if (
      xHeader == 0xEF &&
      length >= 7
  ) {
    const uint16_t address =
        static_cast<uint16_t>(
            ((data[1] &
              0x3F) <<
             8) |
            data[2]);

    const uint8_t speedMode =
        data[3] &
        0x07;

    const uint8_t rawSpeed =
        data[4];

    CommandCenterLocoFeedback
        event;

    event.address =
        address;

    event.forward =
        (rawSpeed &
         0x80) != 0;

    const uint8_t encodedSpeed =
        rawSpeed &
        0x7F;

    if (
        speedMode == 4
    ) {
      event.speed =
          encodedSpeed <= 1
              ? 0
              : static_cast<uint8_t>(
                    encodedSpeed -
                    1);
    } else {
      // The Hub uses 0..126 internally. If an existing loco is still
      // configured for 14/28 steps, keep the value useful until the next
      // 128-step drive command makes Z21 persist 128-step mode.
      event.speed =
          encodedSpeed <= 1
              ? 0
              : min(
                    static_cast<uint8_t>(
                        126),
                    encodedSpeed);
    }

    uint32_t functions =
        0;

    const uint8_t f0f4 =
        data[5];

    if (f0f4 & 0x10) {
      functions |=
          1UL <<
          0;
    }

    if (f0f4 & 0x01) {
      functions |=
          1UL <<
          1;
    }

    if (f0f4 & 0x02) {
      functions |=
          1UL <<
          2;
    }

    if (f0f4 & 0x04) {
      functions |=
          1UL <<
          3;
    }

    if (f0f4 & 0x08) {
      functions |=
          1UL <<
          4;
    }

    if (length >= 8) {
      functions |=
          static_cast<uint32_t>(
              data[6]) <<
          5;
    }

    if (length >= 9) {
      functions |=
          static_cast<uint32_t>(
              data[7]) <<
          13;
    }

    if (length >= 10) {
      functions |=
          static_cast<uint32_t>(
              data[8]) <<
          21;
    }

    event.functionsMask =
        functions;

    if (_locoFeedbackCallback) {
      _locoFeedbackCallback(
          event);
    }

    return;
  }

  if (
      xHeader == 0x43 &&
      length >= 5
  ) {
    const uint16_t functionAddress =
        static_cast<uint16_t>(
            (data[1] <<
             8) |
            data[2]);

    const uint8_t position =
        data[3] &
        0x03;

    if (_rawInfoCallback) {
      _rawInfoCallback(
          "Z21 turnout " +
          String(
              functionAddress +
              1) +
          " position=" +
          String(
              position));
    }

    return;
  }

  if (
      xHeader == 0x44 &&
      length >= 6
  ) {
    const uint16_t rawAddress =
        static_cast<uint16_t>(
            (data[1] <<
             8) |
            data[2]);

    if (_rawInfoCallback) {
      _rawInfoCallback(
          "Z21 extended accessory " +
          String(
              rawAddress >= 4
                  ? rawAddress -
                        3
                  : rawAddress) +
          " aspect=" +
          String(
              data[3]));
    }

    return;
  }
}

void Z21CommandCenter::processSystemState(
    const uint8_t* data,
    size_t length) {
  if (
      !data ||
      length < 16
  ) {
    return;
  }

  CommandCenterCurrentTelemetry
      current;

  current.count =
      2;

  current.values[0] =
      readLeS16(
          data);

  current.values[1] =
      readLeS16(
          data +
          2);

  if (_currentTelemetryCallback) {
    _currentTelemetryCallback(
        current);
  }

  const uint8_t centralState =
      data[12];

  CommandCenterPowerFeedback
      power;

  power.on =
      (centralState &
       0x02) ==
      0;

  power.target =
      (centralState &
       0x20)
          ? CommandCenterPowerTarget::Programming
          : CommandCenterPowerTarget::All;

  if (_powerFeedbackCallback) {
    _powerFeedbackCallback(
        power);
  }
}

void Z21CommandCenter::processHardwareInfo(
    const uint8_t* data,
    size_t length) {
  if (
      !data ||
      length < 8
  ) {
    return;
  }

  const uint32_t hardwareType =
      readLe32(
          data);

  const uint32_t firmware =
      readLe32(
          data +
          4);

  _stationInfo.hardware =
      hardwareName(
          hardwareType);

  _stationInfo.processor =
      "Z21 LAN";

  _stationInfo.version =
      bcdVersion(
          firmware);

  _stationInfo.maxLocos =
      100;

  emitStationInfo();
}

void Z21CommandCenter::emitTrackConfiguration() {
  if (!_trackConfigurationCallback) {
    return;
  }

  CommandCenterTrackConfiguration
      mainTrack;

  mainTrack.index =
      0;

  mainTrack.mode =
      "MAIN";

  _trackConfigurationCallback(
      mainTrack);

  CommandCenterTrackConfiguration
      programmingTrack;

  programmingTrack.index =
      1;

  programmingTrack.mode =
      "PROG";

  _trackConfigurationCallback(
      programmingTrack);
}

void Z21CommandCenter::emitStationInfo() {
  if (_stationInfoCallback) {
    _stationInfoCallback(
        _stationInfo);
  }
}

uint16_t Z21CommandCenter::readLe16(
    const uint8_t* data) {
  return
      static_cast<uint16_t>(
          data[0]) |
      (
          static_cast<uint16_t>(
              data[1]) <<
          8
      );
}

int16_t Z21CommandCenter::readLeS16(
    const uint8_t* data) {
  return
      static_cast<int16_t>(
          readLe16(
              data));
}

uint32_t Z21CommandCenter::readLe32(
    const uint8_t* data) {
  return
      static_cast<uint32_t>(
          data[0]) |
      (
          static_cast<uint32_t>(
              data[1]) <<
          8
      ) |
      (
          static_cast<uint32_t>(
              data[2]) <<
          16
      ) |
      (
          static_cast<uint32_t>(
              data[3]) <<
          24
      );
}

void Z21CommandCenter::writeLe16(
    uint8_t* data,
    uint16_t value) {
  data[0] =
      static_cast<uint8_t>(
          value &
          0xFF);

  data[1] =
      static_cast<uint8_t>(
          value >>
          8);
}

void Z21CommandCenter::writeLe32(
    uint8_t* data,
    uint32_t value) {
  data[0] =
      static_cast<uint8_t>(
          value &
          0xFF);

  data[1] =
      static_cast<uint8_t>(
          (value >>
           8) &
          0xFF);

  data[2] =
      static_cast<uint8_t>(
          (value >>
           16) &
          0xFF);

  data[3] =
      static_cast<uint8_t>(
          (value >>
           24) &
          0xFF);
}

uint8_t Z21CommandCenter::xorBytes(
    const uint8_t* data,
    size_t length) {
  uint8_t result =
      0;

  for (
      size_t index = 0;
      index < length;
      ++index
  ) {
    result ^=
        data[index];
  }

  return result;
}

String Z21CommandCenter::bcdVersion(
    uint32_t value) {
  const uint8_t b0 =
      static_cast<uint8_t>(
          value &
          0xFF);

  const uint8_t b1 =
      static_cast<uint8_t>(
          (value >>
           8) &
          0xFF);

  const uint8_t major =
      b1 != 0
          ? b1
          : b0;

  const uint8_t minor =
      b1 != 0
          ? b0
          : static_cast<uint8_t>(
                (value >>
                 8) &
                0xFF);

  return
      String(
          (major >>
           4) &
          0x0F) +
      String(
          major &
          0x0F) +
      "." +
      String(
          (minor >>
           4) &
          0x0F) +
      String(
          minor &
          0x0F);
}

String Z21CommandCenter::hardwareName(
    uint32_t hardwareType) {
  switch (hardwareType) {
    case 0x00000200:
      return "Z21 black (2012)";

    case 0x00000201:
      return "Z21 black";

    case 0x00000203:
      return "z21 white";

    case 0x00000204:
      return "z21 start";

    case 0x00000211:
      return "Z21 XL";

    default:
      return
          "Z21 HW 0x" +
          String(
              hardwareType,
              HEX);
  }
}
