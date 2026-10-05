#include "Z21CommandCenter.h"

#include <WiFi.h>
#include <strings.h>
#include <ctype.h>

#include "Logger.h"

void Z21CommandCenter::begin(
    const String& host,
    uint16_t port) {
  setEndpoint(
      host,
      port == 0
          ? DEFAULT_PORT
          : port);

#if defined(HUB_CC_YAMORC7010)
  _stationInfo.processor =
      "Z21 LAN + LocoNet LBServer";

  _stationInfo.hardware =
      "YD7010";
#else
  _stationInfo.processor =
      "Z21 LAN";
#endif

  _stationInfo.maxLocos =
      100;

  ensureNetworkInfrastructure();
}

void Z21CommandCenter::setEndpoint(
    const String& host,
    uint16_t port) {
  if (_endpointMutex) {
    xSemaphoreTake(
        _endpointMutex,
        portMAX_DELAY);
  }

  _host =
      host;

  _host.trim();

  _port =
      port == 0
          ? DEFAULT_PORT
          : port;

  ++_endpointRevision;

  if (_endpointMutex) {
    xSemaphoreGive(
        _endpointMutex);
  }

  _online =
      false;

  _lastRxAt =
      0;

  _nextKeepaliveAt =
      0;
}

bool Z21CommandCenter::ensureNetworkInfrastructure() {
  if (!_endpointMutex) {
    _endpointMutex =
        xSemaphoreCreateMutexStatic(
            &_endpointMutexControl);
  }

  if (!_networkTxQueue) {
    _networkTxQueue =
        xQueueCreateStatic(
            NETWORK_TX_QUEUE_LENGTH,
            sizeof(NetworkTxPacket),
            _networkTxQueueStorage,
            &_networkTxQueueControl);
  }

  if (!_networkRxQueue) {
    _networkRxQueue =
        xQueueCreateStatic(
            NETWORK_RX_QUEUE_LENGTH,
            sizeof(NetworkRxFrame),
            _networkRxQueueStorage,
            &_networkRxQueueControl);
  }

#if defined(HUB_CC_YAMORC7010)
  if (!_feedbackRxQueue) {
    _feedbackRxQueue =
        xQueueCreateStatic(
            NETWORK_RX_QUEUE_LENGTH,
            sizeof(NetworkRxFrame),
            _feedbackRxQueueStorage,
            &_feedbackRxQueueControl);
  }
#endif

  if (!_networkControlQueue) {
    _networkControlQueue =
        xQueueCreateStatic(
            NETWORK_CONTROL_QUEUE_LENGTH,
            sizeof(NetworkControl),
            _networkControlQueueStorage,
            &_networkControlQueueControl);
  }

  if (
      !_endpointMutex ||
      !_networkTxQueue ||
      !_networkRxQueue ||
#if defined(HUB_CC_YAMORC7010)
      !_feedbackRxQueue ||
#endif
      !_networkControlQueue
  ) {
    return false;
  }

  if (!_networkTaskHandle) {
    _networkTaskHandle =
        xTaskCreateStaticPinnedToCore(
            networkTaskEntry,
            "z21-udp",
            NETWORK_TASK_STACK_BYTES,
            this,
            4,
            _networkTaskStack,
            &_networkTaskControl,
            0);
  }

#if defined(HUB_CC_YAMORC7010)
  if (!_feedbackTaskHandle) {
    _feedbackTaskHandle =
        xTaskCreateStaticPinnedToCore(
            feedbackTaskEntry,
            "z21-fb",
            NETWORK_TASK_STACK_BYTES,
            this,
            1,
            _feedbackTaskStack,
            &_feedbackTaskControl,
            0);
  }
#endif

  return
      _networkTaskHandle !=
          nullptr
#if defined(HUB_CC_YAMORC7010)
      && _feedbackTaskHandle !=
          nullptr
#endif
      ;
}

void Z21CommandCenter::networkTaskEntry(
    void* parameter) {
  auto* self =
      static_cast<Z21CommandCenter*>(
          parameter);

  if (self) {
    self->networkTask();
  }

  vTaskDelete(
      nullptr);
}

#if defined(HUB_CC_YAMORC7010)
void Z21CommandCenter::feedbackTaskEntry(
    void* parameter) {
  auto* self =
      static_cast<Z21CommandCenter*>(
          parameter);

  if (self) {
    self->feedbackTask();
  }

  vTaskDelete(
      nullptr);
}
#endif

bool Z21CommandCenter::enqueueNetworkRx(
    NetworkRxKind kind,
    const uint8_t* data,
    size_t length) {
  if (
      !data ||
      length == 0 ||
      length >
          sizeof(
              NetworkRxFrame::data)
  ) {
    return false;
  }

  QueueHandle_t queue =
      _networkRxQueue;

#if defined(HUB_CC_YAMORC7010)
  if (
      kind !=
      NetworkRxKind::UdpDatagram
  ) {
    queue =
        _feedbackRxQueue;
  }
#endif

  if (!queue) {
    return false;
  }

  NetworkRxFrame frame;
  frame.kind =
      kind;
  frame.length =
      static_cast<uint16_t>(
          length);

  memcpy(
      frame.data,
      data,
      length);

  if (
      xQueueSend(
          queue,
          &frame,
          0) !=
      pdTRUE
  ) {
    ++_networkRxDrops;
    return false;
  }

  return true;
}

bool Z21CommandCenter::queueNetworkControl(
    NetworkControlKind kind) {
  if (
      !ensureNetworkInfrastructure()
  ) {
    return false;
  }

  NetworkControl control;
  control.kind =
      kind;

  return
      xQueueSend(
          _networkControlQueue,
          &control,
          0) ==
      pdTRUE;
}

void Z21CommandCenter::processNetworkRx() {
  NetworkRxFrame frame;

  if (_networkRxQueue) {
    uint8_t processed =
        0;

    while (
        processed <
            NETWORK_RX_QUEUE_LENGTH &&
        xQueueReceive(
            _networkRxQueue,
            &frame,
            0) ==
            pdTRUE
    ) {
      ++processed;

      processDatagram(
          frame.data,
          frame.length);
    }
  }

#if defined(HUB_CC_YAMORC7010)
  if (_feedbackRxQueue) {
    uint8_t processed =
        0;

    while (
        processed <
            NETWORK_RX_QUEUE_LENGTH &&
        xQueueReceive(
            _feedbackRxQueue,
            &frame,
            0) ==
            pdTRUE
    ) {
      ++processed;

      switch (frame.kind) {
        case NetworkRxKind::LbServerLine:
          processLbServerLine(
              reinterpret_cast<
                  const char*>(
                  frame.data));
          break;

        case NetworkRxKind::LocoNetBinary:
          processLocoNetPacket(
              frame.data,
              frame.length);
          break;

        case NetworkRxKind::UdpDatagram:
          break;
      }
    }
  }
#endif
}

void Z21CommandCenter::networkTask() {
  uint32_t activeEndpointRevision =
      0;

  for (;;) {
    const unsigned long now =
        millis();

    if (
        activeEndpointRevision !=
        _endpointRevision
    ) {
      activeEndpointRevision =
          _endpointRevision;

      if (_udpStarted) {
        _udp.stop();
        _udpStarted =
            false;
      }

      _resolved =
          false;
      _remoteIp =
          IPAddress();
      _nextResolveAt =
          0;

    }

    if (
        WiFi.status() !=
        WL_CONNECTED
    ) {
      vTaskDelay(
          pdMS_TO_TICKS(
              20));
      continue;
    }

    if (
        !startUdp() ||
        !resolveRemote()
    ) {
      vTaskDelay(
          pdMS_TO_TICKS(
              10));
      continue;
    }

    NetworkTxPacket tx;
    uint8_t txProcessed =
        0;

    while (
        txProcessed < 8 &&
        xQueueReceive(
            _networkTxQueue,
            &tx,
            0) ==
            pdTRUE
    ) {
      ++txProcessed;

      uint16_t port =
          DEFAULT_PORT;

      if (_endpointMutex) {
        xSemaphoreTake(
            _endpointMutex,
            portMAX_DELAY);
      }

      port =
          _port;

      if (_endpointMutex) {
        xSemaphoreGive(
            _endpointMutex);
      }

      bool ok =
          _udp.beginPacket(
              _remoteIp,
              port) == 1;

      if (ok) {
        ok =
            _udp.write(
                tx.data,
                tx.length) ==
            tx.length;
      }

      if (ok) {
        ok =
            _udp.endPacket() ==
            1;
      }

      if (
          !ok &&
          tx.logPacket
      ) {
        Logger::warn(
            "Z21 UDP TX failed in network task");
      }
    }

    for (
        uint8_t rxCount = 0;
        rxCount < 8;
        ++rxCount
    ) {
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

      if (read > 0) {
        enqueueNetworkRx(
            NetworkRxKind::UdpDatagram,
            buffer,
            static_cast<size_t>(
                read));
      }
    }


    vTaskDelay(
        pdMS_TO_TICKS(
            2));
  }
}

#if defined(HUB_CC_YAMORC7010)
void Z21CommandCenter::feedbackTask() {
  uint32_t activeEndpointRevision =
      0;
  unsigned long nextLbAttemptAt =
      0;
  unsigned long nextBinaryAttemptAt =
      0;
  uint8_t lbConnectFailures =
      0;
  uint8_t binaryConnectFailures =
      0;

  for (;;) {
    const unsigned long now =
        millis();

    if (
        activeEndpointRevision !=
        _endpointRevision
    ) {
      activeEndpointRevision =
          _endpointRevision;

      disconnectLbServer();
      disconnectLocoNetBinary();

      _nextLbConnectAt =
          0;
      _nextLnBinaryConnectAt =
          0;
      _lastLbTrafficAt =
          0;
      _lastLbInterrogateAt =
          0;
      _lbInterrogatePhase =
          0;

      nextLbAttemptAt =
          0;
      nextBinaryAttemptAt =
          0;
    }

    if (
        WiFi.status() !=
        WL_CONNECTED
    ) {
      if (_lbConnected) {
        disconnectLbServer();
      }

      if (_lnBinaryConnected) {
        disconnectLocoNetBinary();
      }

      vTaskDelay(
          pdMS_TO_TICKS(
              50));
      continue;
    }

    // The UDP worker owns endpoint resolution. Feedback waits for the same
    // resolved YaMoRC address, so TCP connect/DNS can never stall Z21 UDP.
    if (!_resolved) {
      vTaskDelay(
          pdMS_TO_TICKS(
              20));
      continue;
    }

    if (
        !_lbConnected ||
        !_lbClient.connected()
    ) {
      _lbConnected =
          false;

      if (
          static_cast<long>(
              now -
              nextLbAttemptAt) >= 0
      ) {
        nextLbAttemptAt =
            now +
            LB_RECONNECT_MS;

        if (connectLbServer()) {
          lbConnectFailures =
              0;
        } else {
          ++lbConnectFailures;

          if (
              lbConnectFailures == 1 ||
              lbConnectFailures >= 5
          ) {
            Logger::warn(
                "YD7010 LBServer connect failed " +
                _remoteIp.toString() +
                ":" +
                String(
                    LB_SERVER_PORT));

            if (
                lbConnectFailures >= 5
            ) {
              lbConnectFailures =
                  0;
            }
          }
        }
      }
    } else {
      processLbServerIncoming();

      if (!_lbClient.connected()) {
        disconnectLbServer();
      }
    }

    if (
        _lbConnected &&
        _lbClient.connected()
    ) {
      if (_lnBinaryConnected) {
        disconnectLocoNetBinary();
      }
    } else if (
        !_lnBinaryConnected ||
        !_lnBinaryClient.connected()
    ) {
      _lnBinaryConnected =
          false;

      if (
          static_cast<long>(
              now -
              nextBinaryAttemptAt) >= 0
      ) {
        nextBinaryAttemptAt =
            now +
            LB_RECONNECT_MS;

        if (connectLocoNetBinary()) {
          binaryConnectFailures =
              0;
        } else {
          ++binaryConnectFailures;

          if (
              binaryConnectFailures == 1 ||
              binaryConnectFailures >= 5
          ) {
            Logger::warn(
                "YD7010 LocoNet Binary connect failed " +
                _remoteIp.toString() +
                ":" +
                String(
                    LN_BINARY_PORT));

            if (
                binaryConnectFailures >= 5
            ) {
              binaryConnectFailures =
                  0;
            }
          }
        }
      }
    } else {
      processLocoNetBinaryIncoming();

      if (!_lnBinaryClient.connected()) {
        disconnectLocoNetBinary();
      }
    }

    NetworkControl control;
    while (
        xQueueReceive(
            _networkControlQueue,
            &control,
            0) ==
            pdTRUE
    ) {
      if (
          control.kind ==
          NetworkControlKind::Interrogate
      ) {
        startLocoNetInterrogate(
            true);
      }
    }

    processLocoNetInterrogate(
        now);

    vTaskDelay(
        pdMS_TO_TICKS(
            2));
  }
}
#endif

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

  String host;
  uint16_t port =
      DEFAULT_PORT;

  if (_endpointMutex) {
    xSemaphoreTake(
        _endpointMutex,
        portMAX_DELAY);
  }

  host =
      _host;
  port =
      _port;

  if (_endpointMutex) {
    xSemaphoreGive(
        _endpointMutex);
  }

  IPAddress parsed;

  if (
      parsed.fromString(
          host)
  ) {
    _remoteIp =
        parsed;

    _resolved =
        true;
  } else {
    const int result =
        WiFi.hostByName(
            host.c_str(),
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
        host);

    return false;
  }

  Logger::info(
      "Z21 endpoint resolved " +
      host +
      " -> " +
      _remoteIp.toString() +
      ":" +
      String(
          port));

  return true;
}

bool Z21CommandCenter::ensureConnected() {
  if (
      WiFi.status() !=
      WL_CONNECTED ||
      !ensureNetworkInfrastructure()
  ) {
    return false;
  }

  const bool queued =
      setBroadcastFlags() &&
      requestHardwareInfo(
          false) &&
      requestFirmwareVersion(
          false) &&
      requestStatus(
          false) &&
      requestSystemState(
          false);

  _nextKeepaliveAt =
      millis() +
      KEEPALIVE_MS;

  return queued;
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

  ensureNetworkInfrastructure();
  processNetworkRx();

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
      !ensureNetworkInfrastructure()
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

  NetworkTxPacket packet;
  packet.length =
      static_cast<uint16_t>(
          totalLen);
  packet.logPacket =
      logPacket;

  writeLe16(
      packet.data,
      packet.length);

  writeLe16(
      packet.data +
          2,
      header);

  if (
      data &&
      dataLen > 0
  ) {
    memcpy(
        packet.data +
            4,
        data,
        dataLen);
  }

  if (
      xQueueSend(
          _networkTxQueue,
          &packet,
          0) !=
      pdTRUE
  ) {
    ++_networkTxDrops;

    Logger::warn(
        "Z21 network TX queue full");

    return false;
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

void Z21CommandCenter::emitProgrammingFeedback(
    bool ok,
    uint16_t cv,
    int16_t value,
    const String& message,
    const String& raw) {
  if (!_programmingFeedbackCallback) {
    return;
  }

  CommandCenterProgrammingFeedback feedback;
  feedback.ok = ok;
  feedback.cv = cv;
  feedback.value = value;
  feedback.message = message;
  feedback.raw = raw;

  _programmingFeedbackCallback(
      feedback);
}

bool Z21CommandCenter::sendCvDirect(
    bool write,
    uint16_t cv,
    uint8_t value) {
  if (cv == 0 || cv > 1024) {
    return false;
  }

  const uint16_t cvAddress =
      static_cast<uint16_t>(
          cv - 1);

  if (write) {
    const uint8_t payload[] = {
        0x24,
        0x12,
        static_cast<uint8_t>(
            cvAddress >> 8),
        static_cast<uint8_t>(
            cvAddress & 0xFF),
        value};

    return sendXBus(
        payload,
        sizeof(payload),
        true);
  }

  const uint8_t payload[] = {
      0x23,
      0x11,
      static_cast<uint8_t>(
          cvAddress >> 8),
      static_cast<uint8_t>(
          cvAddress & 0xFF)};

  return sendXBus(
      payload,
      sizeof(payload),
      true);
}

bool Z21CommandCenter::sendPomCv(
    bool accessory,
    bool write,
    uint16_t address,
    uint16_t cv,
    uint8_t value) {
  if (cv == 0 || cv > 1024) {
    return false;
  }

  const uint16_t cvAddress =
      static_cast<uint16_t>(
          cv - 1);

  uint8_t addressMsb = 0;
  uint8_t addressLsb = 0;

  if (accessory) {
    // Hub/UI accessory decoder addresses are human-facing 1..512 while the
    // Z21 LAN protocol uses Decoder_Address 0..511.
    if (address == 0 || address > 512) {
      return false;
    }

    const uint16_t decoderAddress =
        static_cast<uint16_t>(
            address - 1);

    const uint16_t encoded =
        static_cast<uint16_t>(
            (decoderAddress & 0x01FF) <<
            4);

    addressMsb =
        static_cast<uint8_t>(
            encoded >> 8);

    addressLsb =
        static_cast<uint8_t>(
            encoded & 0xFF);
  } else {
    if (address == 0 || address > 9999) {
      return false;
    }

    encodeLocoAddress(
        address,
        addressMsb,
        addressLsb);
  }

  const uint8_t option =
      static_cast<uint8_t>(
          (write
               ? 0xEC
               : 0xE4) |
          ((cvAddress >> 8) &
           0x03));

  const uint8_t payload[] = {
      0xE6,
      static_cast<uint8_t>(
          accessory
              ? 0x31
              : 0x30),
      addressMsb,
      addressLsb,
      option,
      static_cast<uint8_t>(
          cvAddress & 0xFF),
      write
          ? value
          : static_cast<uint8_t>(0)};

  return sendXBus(
      payload,
      sizeof(payload),
      true);
}

bool Z21CommandCenter::readServiceCv(
    uint16_t cv) {
  return sendCvDirect(
      false,
      cv,
      0);
}

bool Z21CommandCenter::writeServiceCv(
    uint16_t cv,
    uint8_t value) {
  return sendCvDirect(
      true,
      cv,
      value);
}

bool Z21CommandCenter::readPomCv(
    uint16_t address,
    uint16_t cv) {
  return sendPomCv(
      false,
      false,
      address,
      cv,
      0);
}

bool Z21CommandCenter::writePomCv(
    uint16_t address,
    uint16_t cv,
    uint8_t value) {
  return sendPomCv(
      false,
      true,
      address,
      cv,
      value);
}

bool Z21CommandCenter::readAccessoryPomCv(
    uint16_t decoderAddress,
    uint16_t cv) {
  return sendPomCv(
      true,
      false,
      decoderAddress,
      cv,
      0);
}

bool Z21CommandCenter::writeAccessoryPomCv(
    uint16_t decoderAddress,
    uint16_t cv,
    uint8_t value) {
  return sendPomCv(
      true,
      true,
      decoderAddress,
      cv,
      value);
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

bool Z21CommandCenter::requestSensorSnapshot(
    bool logCommand) {
  const uint8_t rbus0[] = {
      0x00};

  const uint8_t rbus1[] = {
      0x01};

  const uint8_t loconetDetector[] = {
      0x80,
      0x00,
      0x00};

  const bool rbus0Sent =
      sendPacket(
          0x0081,
          rbus0,
          sizeof(
              rbus0),
          logCommand);

  const bool rbus1Sent =
      sendPacket(
          0x0081,
          rbus1,
          sizeof(
              rbus1),
          logCommand);

  const bool detectorSent =
      sendPacket(
          0x00A4,
          loconetDetector,
          sizeof(
              loconetDetector),
          logCommand);

#if defined(HUB_CC_YAMORC7010)
  const bool locoNetInterrogate =
      queueNetworkControl(
          NetworkControlKind::Interrogate);
#else
  const bool locoNetInterrogate =
      false;
#endif

  return
      rbus0Sent ||
      rbus1Sent ||
      detectorSent ||
      locoNetInterrogate;
}


bool Z21CommandCenter::sendRawCommand(
    String command,
    bool logCommand) {
  (void)command;
  (void)logCommand;

  return false;
}

#if defined(HUB_CC_YAMORC7010)

bool Z21CommandCenter::connectLbServer() {
  if (
      _lbConnected &&
      _lbClient.connected()
  ) {
    return true;
  }

  disconnectLbServer();

  if (
      WiFi.status() !=
          WL_CONNECTED ||
      !resolveRemote()
  ) {
    return false;
  }

  const unsigned long now =
      millis();

  if (
      _nextLbConnectAt != 0 &&
      static_cast<long>(
          now -
          _nextLbConnectAt) < 0
  ) {
    return false;
  }

  _nextLbConnectAt =
      now +
      LB_RECONNECT_MS;

  if (
      !_lbClient.connect(
          _remoteIp,
          LB_SERVER_PORT,
          FEEDBACK_CONNECT_TIMEOUT_MS)
  ) {
    return false;
  }

  _lbClient.setNoDelay(
      true);

  _lbConnected =
      true;

  _lbLineLength =
      0;

  _lastLbTrafficAt =
      now;

  Logger::info(
      "YD7010 LBServer connected " +
      _remoteIp.toString() +
      ":" +
      String(
          LB_SERVER_PORT));

  startLocoNetInterrogate(
      true);

  return true;
}

void Z21CommandCenter::disconnectLbServer() {
  if (_lbClient) {
    _lbClient.stop();
  }

  if (_lbConnected) {
    Logger::warn(
        "YD7010 LBServer disconnected");
  }

  _lbConnected =
      false;

  _lbLineLength =
      0;

  if (!_lnBinaryConnected) {
    _lbInterrogatePhase =
        0;
  }
}

void Z21CommandCenter::loopLbServer(
    unsigned long now) {
  if (
      !_lbConnected ||
      !_lbClient.connected()
  ) {
    connectLbServer();
    return;
  }

  processLbServerIncoming();

  if (!_lbClient.connected()) {
    disconnectLbServer();

    _nextLbConnectAt =
        now +
        LB_RECONNECT_MS;

    return;
  }

  processLocoNetInterrogate(
      now);
}

bool Z21CommandCenter::connectLocoNetBinary() {
  if (
      _lnBinaryConnected &&
      _lnBinaryClient.connected()
  ) {
    return true;
  }

  disconnectLocoNetBinary();

  if (
      WiFi.status() !=
          WL_CONNECTED ||
      !resolveRemote()
  ) {
    return false;
  }

  const unsigned long now =
      millis();

  if (
      _nextLnBinaryConnectAt != 0 &&
      static_cast<long>(
          now -
          _nextLnBinaryConnectAt) < 0
  ) {
    return false;
  }

  _nextLnBinaryConnectAt =
      now +
      LB_RECONNECT_MS;

  if (
      !_lnBinaryClient.connect(
          _remoteIp,
          LN_BINARY_PORT,
          FEEDBACK_CONNECT_TIMEOUT_MS)
  ) {
    return false;
  }

  _lnBinaryClient.setNoDelay(
      true);

  _lnBinaryConnected =
      true;

  _lnBinaryPacketLength =
      0;

  _lnBinaryExpectedLength =
      0;

  Logger::info(
      "YD7010 LocoNet Binary connected " +
      _remoteIp.toString() +
      ":" +
      String(
          LN_BINARY_PORT));

  if (!_lbConnected) {
    startLocoNetInterrogate(
        true);
  }

  return true;
}

void Z21CommandCenter::disconnectLocoNetBinary() {
  if (_lnBinaryClient) {
    _lnBinaryClient.stop();
  }

  if (_lnBinaryConnected) {
    Logger::warn(
        "YD7010 LocoNet Binary disconnected");
  }

  _lnBinaryConnected =
      false;

  _lnBinaryPacketLength =
      0;

  _lnBinaryExpectedLength =
      0;

  if (!_lbConnected) {
    _lbInterrogatePhase =
        0;
  }
}

void Z21CommandCenter::loopLocoNetBinary(
    unsigned long now) {
  // LBServer is the primary YaMoRC feedback transport. Do not keep probing
  // the optional Binary service while LBServer is healthy.
  if (
      _lbConnected &&
      _lbClient.connected()
  ) {
    if (_lnBinaryConnected) {
      disconnectLocoNetBinary();
    }

    return;
  }

  if (
      !_lnBinaryConnected ||
      !_lnBinaryClient.connected()
  ) {
    connectLocoNetBinary();
    return;
  }

  processLocoNetBinaryIncoming();

  if (!_lnBinaryClient.connected()) {
    disconnectLocoNetBinary();

    _nextLnBinaryConnectAt =
        now +
        LB_RECONNECT_MS;
  }
}

size_t Z21CommandCenter::locoNetMessageLength(
    const uint8_t* packet,
    size_t packetLength) {
  if (
      !packet ||
      packetLength == 0
  ) {
    return 0;
  }

  const uint8_t opcode =
      packet[0];

  if (
      (opcode &
       0x60) ==
      0x60
  ) {
    if (
        packetLength <
        2
    ) {
      return 0;
    }

    return
        packet[1];
  }

  return
      static_cast<size_t>(
          (
              (opcode &
               0x60) >>
              4
          ) +
          2);
}

void Z21CommandCenter::processLocoNetBinaryIncoming() {
  while (
      _lnBinaryClient.connected() &&
      _lnBinaryClient.available() >
          0
  ) {
    const int readValue =
        _lnBinaryClient.read();

    if (readValue < 0) {
      break;
    }

    const uint8_t value =
        static_cast<uint8_t>(
            readValue);

    if (
        (value &
         0x80) != 0
    ) {
      _lnBinaryPacket[0] =
          value;

      _lnBinaryPacketLength =
          1;

      _lnBinaryExpectedLength =
          locoNetMessageLength(
              _lnBinaryPacket,
              _lnBinaryPacketLength);

      continue;
    }

    if (
        _lnBinaryPacketLength ==
        0
    ) {
      continue;
    }

    if (
        _lnBinaryPacketLength >=
        sizeof(
            _lnBinaryPacket)
    ) {
      _lnBinaryPacketLength =
          0;

      _lnBinaryExpectedLength =
          0;

      continue;
    }

    _lnBinaryPacket[
        _lnBinaryPacketLength++] =
        value;

    _lnBinaryExpectedLength =
        locoNetMessageLength(
            _lnBinaryPacket,
            _lnBinaryPacketLength);

    if (
        _lnBinaryExpectedLength ==
            0 ||
        _lnBinaryPacketLength <
            _lnBinaryExpectedLength
    ) {
      continue;
    }

    if (
        _lnBinaryExpectedLength >
            sizeof(
                _lnBinaryPacket) ||
        _lnBinaryPacketLength !=
            _lnBinaryExpectedLength
    ) {
      _lnBinaryPacketLength =
          0;

      _lnBinaryExpectedLength =
          0;

      continue;
    }

    ++_lnBinaryPacketsObserved;

    enqueueNetworkRx(
        NetworkRxKind::LocoNetBinary,
        _lnBinaryPacket,
        _lnBinaryPacketLength);

    _lnBinaryPacketLength =
        0;

    _lnBinaryExpectedLength =
        0;
  }
}

void Z21CommandCenter::processLbServerIncoming() {
  while (
      _lbClient.connected() &&
      _lbClient.available() >
          0
  ) {
    const int value =
        _lbClient.read();

    if (value < 0) {
      break;
    }

    const char ch =
        static_cast<char>(
            value);

    if (
        ch == '\r' ||
        ch == '\n'
    ) {
      if (_lbLineLength > 0) {
        _lbLine[_lbLineLength] =
            '\0';

        enqueueNetworkRx(
            NetworkRxKind::LbServerLine,
            reinterpret_cast<const uint8_t*>(
                _lbLine),
            _lbLineLength +
                1);

        _lbLineLength =
            0;
      }

      continue;
    }

    if (
        _lbLineLength +
            1 <
        sizeof(
            _lbLine)
    ) {
      _lbLine[
          _lbLineLength++] =
          ch;
    } else {
      _lbLineLength =
          0;
    }
  }
}

void Z21CommandCenter::processLbServerLine(
    const char* line) {
  if (!line) {
    return;
  }

  while (
      *line == ' ' ||
      *line == '\t'
  ) {
    ++line;
  }

  if (*line == '\0') {
    return;
  }

  _lastLbTrafficAt =
      millis();

  ++_lbLinesObserved;

  if (
      _lbLinesObserved <=
          12 &&
      _rawInfoCallback
  ) {
    _rawInfoCallback(
        "YD7010 LB RX " +
        String(
            line));
  }

  if (
      strncasecmp(
          line,
          "VERSION ",
          8) == 0
  ) {
    return;
  }

  const char* cursor =
      line;

  if (
      strncasecmp(
          line,
          "RECEIVE ",
          8) == 0
  ) {
    cursor =
        line +
        8;
  } else if (
      !isxdigit(
          static_cast<unsigned char>(
              *line))
  ) {
    return;
  }

  uint8_t packet[128] = {};
  size_t packetLength =
      0;

  while (
      *cursor != '\0' &&
      packetLength <
          sizeof(
              packet)
  ) {
    while (
        *cursor == ' ' ||
        *cursor == '\t'
    ) {
      ++cursor;
    }

    if (*cursor == '\0') {
      break;
    }

    char* end =
        nullptr;

    const unsigned long parsed =
        strtoul(
            cursor,
            &end,
            16);

    if (
        end == cursor ||
        parsed >
            0xFF ||
        (
            *end != '\0' &&
            *end != ' ' &&
            *end != '\t'
        )
    ) {
      return;
    }

    packet[
        packetLength++] =
        static_cast<uint8_t>(
            parsed);

    cursor =
        end;
  }

  if (packetLength == 0) {
    return;
  }

  ++_lbPacketsObserved;

  processLocoNetPacket(
      packet,
      packetLength);
}

void Z21CommandCenter::processLocoNetPacket(
    const uint8_t* packet,
    size_t length) {
  if (
      !packet ||
      length <
          2
  ) {
    return;
  }

  uint8_t checksum =
      0;

  for (
      size_t index = 0;
      index <
          length;
      ++index
  ) {
    checksum ^=
        packet[index];
  }

  if (
      checksum !=
      0xFF
  ) {
    if (
        _lbPacketsObserved <=
            12 &&
        _rawInfoCallback
    ) {
      _rawInfoCallback(
          "YD7010 LB invalid checksum opcode=0x" +
          String(
              packet[0],
              HEX));
    }

    return;
  }

  if (
      packet[0] ==
          0xB1 ||
      packet[0] ==
          0xB2
  ) {
    _lastLbTrafficAt =
        millis();
  } else if (
      length >=
          4 &&
      (
          packet[0] ==
              0xB0 ||
          packet[0] ==
              0xBD
      )
  ) {
    const uint16_t address =
        static_cast<uint16_t>(
            packet[1] &
            0x7F) +
        static_cast<uint16_t>(
            128 *
            (
                packet[2] &
                0x0F
            ));

    if (
        address >=
            0x3F8 &&
        address <=
            0x3FB
    ) {
      _lastLbTrafficAt =
          millis();
    }
  }

  if (
      packet[0] ==
          0xB2 &&
      length >=
          4
  ) {
    processLocoNetInputReport(
        packet,
        length);
  }
}

void Z21CommandCenter::processLocoNetInputReport(
    const uint8_t* packet,
    size_t length) {
  if (
      !packet ||
      length <
          4
  ) {
    return;
  }

  const uint8_t in1 =
      packet[1];

  const uint8_t in2 =
      packet[2];

  uint16_t address =
      static_cast<uint16_t>(
          (
              in1 |
              (
                  (
                      in2 &
                      0x0F
                  ) <<
                  7
              )
          ) <<
          1);

  address +=
      (
          in2 &
          0x20
      ) != 0
          ? 2
          : 1;

  if (
      address <
          1 ||
      address >
          4096
  ) {
    return;
  }

  const bool occupied =
      (
          in2 &
          0x10
      ) != 0;

  if (_rawInfoCallback) {
    _rawInfoCallback(
        "YD7010 sensor #" +
        String(
            address) +
        (
            occupied
                ? " ON"
                : " OFF"
        ));
  }

  if (_sensorFeedbackCallback) {
    CommandCenterSensorFeedback
        feedback;

    feedback.address =
        address;

    feedback.on =
        occupied;

    _sensorFeedbackCallback(
        feedback);
  }
}

void Z21CommandCenter::startLocoNetInterrogate(
    bool force) {
  const unsigned long now =
      millis();

  if (
      !force &&
      _lastLbInterrogateAt !=
          0 &&
      now -
          _lastLbInterrogateAt <
          10000
  ) {
    return;
  }

  _lbInterrogatePhase =
      1;

  _lastLbTrafficAt =
      now;

}

void Z21CommandCenter::processLocoNetInterrogate(
    unsigned long now) {
  const bool lbReady =
      _lbConnected &&
      _lbClient.connected();

  const bool binaryReady =
      _lnBinaryConnected &&
      _lnBinaryClient.connected();

  if (
      _lbInterrogatePhase <
          1 ||
      _lbInterrogatePhase >
          8 ||
      (
          !lbReady &&
          !binaryReady
      )
  ) {
    return;
  }

  if (
      now -
          _lastLbTrafficAt <
      LB_INTERROGATE_QUIET_MS
  ) {
    return;
  }

  static const uint8_t sw1[8] = {
      0x78,
      0x79,
      0x7A,
      0x7B,
      0x78,
      0x79,
      0x7A,
      0x7B};

  static const uint8_t sw2[8] = {
      0x27,
      0x27,
      0x27,
      0x27,
      0x07,
      0x07,
      0x07,
      0x07};

  const uint8_t index =
      static_cast<uint8_t>(
          _lbInterrogatePhase -
          1);

  const uint8_t packet[4] = {
      0xB0,
      sw1[index],
      sw2[index],
      static_cast<uint8_t>(
          0xFF ^
          0xB0 ^
          sw1[index] ^
          sw2[index])};

  bool sent =
      false;

  if (lbReady) {
    char line[32];

    snprintf(
        line,
        sizeof(
            line),
        "SEND %02X %02X %02X %02X\r\n",
        packet[0],
        packet[1],
        packet[2],
        packet[3]);

    const size_t lineLength =
        strlen(
            line);

    sent =
        _lbClient.write(
            reinterpret_cast<
                const uint8_t*>(
                line),
            lineLength) ==
        lineLength;

    if (!sent) {
      disconnectLbServer();
    }
  }

  if (
      !sent &&
      binaryReady
  ) {
    sent =
        _lnBinaryClient.write(
            packet,
            sizeof(
                packet)) ==
        sizeof(
            packet);

    if (!sent) {
      disconnectLocoNetBinary();
    }
  }

  if (!sent) {
    return;
  }

  _lastLbTrafficAt =
      now;

  ++_lbInterrogatePhase;

  if (
      _lbInterrogatePhase >
          8
  ) {
    _lbInterrogatePhase =
        0;

    _lastLbInterrogateAt =
        now;

  }
}

#endif

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

    case 0x0080:
      processRBus(
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

    case 0x00A0:
    case 0x00A1:
      processLocoNetMessage(
          payload,
          payloadLen);
      break;

    case 0x00A4:
      processLocoNetDetector(
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
      xHeader == 0x64 &&
      length >= 6 &&
      data[1] == 0x14
  ) {
    const uint16_t cv =
        static_cast<uint16_t>(
            (
                static_cast<uint16_t>(
                    data[2]) <<
                8
            ) |
            data[3]) +
        1;

    const int16_t value =
        data[4];

    emitProgrammingFeedback(
        true,
        cv,
        value,
        "CV operation completed.",
        "Z21 CV_RESULT");

    return;
  }

  if (
      xHeader == 0x61 &&
      length >= 3 &&
      (
          data[1] == 0x12 ||
          data[1] == 0x13
      )
  ) {
    const bool shortCircuit =
        data[1] == 0x12;

    emitProgrammingFeedback(
        false,
        0,
        -1,
        shortCircuit
            ? "Programming track short circuit."
            : "Decoder did not acknowledge the programming command.",
        shortCircuit
            ? "Z21 CV_NACK_SC"
            : "Z21 CV_NACK");

    return;
  }

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

void Z21CommandCenter::processRBus(
    const uint8_t* data,
    size_t length) {
  if (
      !data ||
      length <
          11
  ) {
    return;
  }

  const uint8_t group =
      data[0];

  if (group > 1) {
    return;
  }

  for (
      uint8_t byteIndex = 0;
      byteIndex < 10;
      ++byteIndex
  ) {
    const uint8_t status =
        data[
            1 +
            byteIndex];

    for (
        uint8_t bit = 0;
        bit < 8;
        ++bit
    ) {
      const uint16_t address =
          static_cast<uint16_t>(
              (
                  group *
                      10 +
                  byteIndex
              ) *
                  8 +
              bit +
              1);

      const bool occupied =
          (
              status &
              (
                  1U <<
                  bit
              )
          ) != 0;

      if (_sensorFeedbackCallback) {
        CommandCenterSensorFeedback
            feedback;

        feedback.address =
            address;

        feedback.on =
            occupied;

        _sensorFeedbackCallback(
            feedback);
      }
    }
  }
}

void Z21CommandCenter::processLocoNetMessage(
    const uint8_t* data,
    size_t length) {
  if (
      !data ||
      length <
          4 ||
      data[0] !=
          0xB2
  ) {
    return;
  }

  const uint8_t in1 =
      data[1];

  const uint8_t in2 =
      data[2];

  uint16_t address =
      static_cast<uint16_t>(
          (
              in1 |
              (
                  (
                      in2 &
                      0x0F
                  ) <<
                  7
              )
          ) <<
          1);

  address +=
      (
          in2 &
          0x20
      ) != 0
          ? 2
          : 1;

  if (
      address <
          1 ||
      address >
          4096
  ) {
    return;
  }

  const bool occupied =
      (
          in2 &
          0x10
      ) != 0;

  if (_rawInfoCallback) {
    _rawInfoCallback(
        "Z21 LocoNet sensor #" +
        String(
            address) +
        (
            occupied
                ? " ON"
                : " OFF"
        ));
  }

  if (_sensorFeedbackCallback) {
    CommandCenterSensorFeedback
        feedback;

    feedback.address =
        address;

    feedback.on =
        occupied;

    _sensorFeedbackCallback(
        feedback);
  }
}

void Z21CommandCenter::processLocoNetDetector(
    const uint8_t* data,
    size_t length) {
  if (
      !data ||
      length <
          4
  ) {
    return;
  }

  const uint8_t type =
      data[0];

  const uint16_t address =
      readLe16(
          data +
          1);

  if (address == 0) {
    return;
  }

  bool known =
      true;

  bool occupied =
      false;

  switch (type) {
    case 0x01:
    case 0x11:
      occupied =
          data[3] !=
          0;
      break;

    case 0x02:
      occupied =
          true;
      break;

    case 0x03:
      occupied =
          false;
      break;

    default:
      known =
          false;
      break;
  }

  if (
      !known ||
      !_sensorFeedbackCallback
  ) {
    return;
  }

  if (_rawInfoCallback) {
    _rawInfoCallback(
        "Z21 detector #" +
        String(
            address) +
        (
            occupied
                ? " ON"
                : " OFF"
        ));
  }

  CommandCenterSensorFeedback
      feedback;

  feedback.address =
      address;

  feedback.on =
      occupied;

  _sensorFeedbackCallback(
      feedback);
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

#if defined(HUB_CC_YAMORC7010)
  _stationInfo.hardware =
      "YD7010";

  _stationInfo.processor =
      "Z21 LAN + LocoNet LBServer";
#else
  _stationInfo.hardware =
      hardwareName(
          hardwareType);

  _stationInfo.processor =
      "Z21 LAN";
#endif

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
