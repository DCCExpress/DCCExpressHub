#include "LocoNetClient.h"

#include <WiFi.h>
#include <ctype.h>
#include <strings.h>

#include "Logger.h"

void LocoNetClient::configure(
    const String& host) {
  stop();

  _host =
      host;

  _host.trim();

  _remoteIp =
      IPAddress();

  _resolved =
      false;

  _nextResolveAt =
      0;

  _nextLbConnectAt =
      0;

  _nextBinaryConnectAt =
      0;

  _lastLbTrafficAt =
      0;

  _lastInterrogateAt =
      0;

  _nextInterrogateStepAt =
      0;

  _interrogatePhase =
      0;

  _lbLinesObserved =
      0;

  _lbPacketsObserved =
      0;

  _binaryPacketsObserved =
      0;
}

void LocoNetClient::start() {
  if (_enabled) {
    return;
  }

  _enabled =
      true;

  _startedAt =
      millis();

  _nextLbConnectAt =
      0;

  _nextBinaryConnectAt =
      0;

  Logger::info(
      "LocoNet client START host=" +
      _host);
}

void LocoNetClient::stop() {
  disconnectLbServer();
  disconnectBinary();

  _enabled =
      false;

  _startedAt =
      0;

  _interrogatePhase =
      0;

  _nextInterrogateStepAt =
      0;
}

bool LocoNetClient::connected() const {
  // Socket liveness is refreshed by loop(); keep this accessor const-safe for
  // ICommandCenter::feedbackLinkConnected().
  return
      _lbConnected ||
      _binaryConnected;
}

bool LocoNetClient::resolveRemote() {
  if (_resolved) {
    return true;
  }

  if (
      !_enabled ||
      WiFi.status() !=
          WL_CONNECTED ||
      _host.isEmpty()
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
        "LocoNet host resolve failed: " +
        _host);

    return false;
  }

  Logger::info(
      "LocoNet endpoint resolved " +
      _host +
      " -> " +
      _remoteIp.toString());

  return true;
}

void LocoNetClient::loop() {
  if (!_enabled) {
    return;
  }

  if (
      WiFi.status() !=
      WL_CONNECTED
  ) {
    disconnectLbServer();
    disconnectBinary();
    return;
  }

  if (!resolveRemote()) {
    return;
  }

  const unsigned long now =
      millis();

  loopLbServer(
      now);

  if (
      _startedAt != 0 &&
      now -
          _startedAt >=
          BINARY_FALLBACK_DELAY_MS
  ) {
    loopBinary(
        now);
  }
}

bool LocoNetClient::connectLbServer() {
  if (
      _lbConnected &&
      _lbClient.connected()
  ) {
    return true;
  }

  disconnectLbServer();

  if (
      !_enabled ||
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
      RECONNECT_MS;

  Logger::info(
      "LNET LB connect begin " +
      _remoteIp.toString() +
      ":" +
      String(
          LB_SERVER_PORT) +
      " timeout=" +
      String(
          CONNECT_TIMEOUT_MS) +
      "ms");

  const unsigned long connectStarted =
      millis();

  if (
      !_lbClient.connect(
          _remoteIp,
          LB_SERVER_PORT,
          CONNECT_TIMEOUT_MS)
  ) {
    Logger::warn(
        "LNET LB connect FAIL elapsed=" +
        String(
            millis() -
            connectStarted) +
        "ms");

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
      "LNET LB connect OK elapsed=" +
      String(
          millis() -
          connectStarted) +
      "ms");

  startInterrogate(
      true);

  return true;
}

void LocoNetClient::disconnectLbServer() {
  if (_lbClient) {
    _lbClient.stop();
  }

  if (_lbConnected) {
    Logger::warn(
        "LocoNet LBServer disconnected");
  }

  _lbConnected =
      false;

  _lbLineLength =
      0;

  if (!_binaryConnected) {
    _interrogatePhase =
        0;

    _nextInterrogateStepAt =
        0;
  }
}

void LocoNetClient::loopLbServer(
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
        RECONNECT_MS;

    return;
  }

  processInterrogate(
      now);
}

bool LocoNetClient::connectBinary() {
  if (
      _binaryConnected &&
      _binaryClient.connected()
  ) {
    return true;
  }

  disconnectBinary();

  if (
      !_enabled ||
      WiFi.status() !=
          WL_CONNECTED ||
      !resolveRemote()
  ) {
    return false;
  }

  const unsigned long now =
      millis();

  if (
      _nextBinaryConnectAt != 0 &&
      static_cast<long>(
          now -
          _nextBinaryConnectAt) < 0
  ) {
    return false;
  }

  _nextBinaryConnectAt =
      now +
      RECONNECT_MS;

  Logger::info(
      "LNET BIN connect begin " +
      _remoteIp.toString() +
      ":" +
      String(
          BINARY_PORT) +
      " timeout=" +
      String(
          CONNECT_TIMEOUT_MS) +
      "ms");

  const unsigned long connectStarted =
      millis();

  if (
      !_binaryClient.connect(
          _remoteIp,
          BINARY_PORT,
          CONNECT_TIMEOUT_MS)
  ) {
    Logger::warn(
        "LNET BIN connect FAIL elapsed=" +
        String(
            millis() -
            connectStarted) +
        "ms");

    return false;
  }

  _binaryClient.setNoDelay(
      true);

  _binaryConnected =
      true;

  _binaryPacketLength =
      0;

  _binaryExpectedLength =
      0;

  Logger::info(
      "LNET BIN connect OK elapsed=" +
      String(
          millis() -
          connectStarted) +
      "ms");

  if (!_lbConnected) {
    startInterrogate(
        true);
  }

  return true;
}

void LocoNetClient::disconnectBinary() {
  if (_binaryClient) {
    _binaryClient.stop();
  }

  if (_binaryConnected) {
    Logger::warn(
        "LocoNet Binary disconnected");
  }

  _binaryConnected =
      false;

  _binaryPacketLength =
      0;

  _binaryExpectedLength =
      0;

  if (!_lbConnected) {
    _interrogatePhase =
        0;

    _nextInterrogateStepAt =
        0;
  }
}

void LocoNetClient::loopBinary(
    unsigned long now) {
  if (
      _lbConnected &&
      _lbClient.connected()
  ) {
    if (_binaryConnected) {
      disconnectBinary();
    }

    return;
  }

  if (
      !_binaryConnected ||
      !_binaryClient.connected()
  ) {
    connectBinary();
    return;
  }

  processBinaryIncoming();

  if (!_binaryClient.connected()) {
    disconnectBinary();

    _nextBinaryConnectAt =
        now +
        RECONNECT_MS;
  }
}

size_t LocoNetClient::messageLength(
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

void LocoNetClient::processBinaryIncoming() {
  while (
      _binaryClient.connected() &&
      _binaryClient.available() >
          0
  ) {
    const int readValue =
        _binaryClient.read();

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
      _binaryPacket[0] =
          value;

      _binaryPacketLength =
          1;

      _binaryExpectedLength =
          messageLength(
              _binaryPacket,
              _binaryPacketLength);

      continue;
    }

    if (
        _binaryPacketLength ==
        0
    ) {
      continue;
    }

    if (
        _binaryPacketLength >=
        sizeof(
            _binaryPacket)
    ) {
      _binaryPacketLength =
          0;

      _binaryExpectedLength =
          0;

      continue;
    }

    _binaryPacket[
        _binaryPacketLength++] =
        value;

    _binaryExpectedLength =
        messageLength(
            _binaryPacket,
            _binaryPacketLength);

    if (
        _binaryExpectedLength ==
            0 ||
        _binaryPacketLength <
            _binaryExpectedLength
    ) {
      continue;
    }

    if (
        _binaryExpectedLength >
            sizeof(
                _binaryPacket) ||
        _binaryPacketLength !=
            _binaryExpectedLength
    ) {
      _binaryPacketLength =
          0;

      _binaryExpectedLength =
          0;

      continue;
    }

    ++_binaryPacketsObserved;

    if (
        _binaryPacketsObserved <=
            12
    ) {
      String raw =
          "LNET BIN RX";

      for (
          size_t index = 0;
          index <
              _binaryPacketLength;
          ++index
      ) {
        raw +=
            " ";

        if (
            _binaryPacket[index] <
            0x10
        ) {
          raw +=
              "0";
        }

        raw +=
            String(
                _binaryPacket[index],
                HEX);
      }

      raw.toUpperCase();

      Logger::info(
          raw);
    }

    processPacket(
        _binaryPacket,
        _binaryPacketLength);

    _binaryPacketLength =
        0;

    _binaryExpectedLength =
        0;
  }
}

void LocoNetClient::processLbServerIncoming() {
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

        processLbServerLine(
            _lbLine);

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

void LocoNetClient::processLbServerLine(
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
          12
  ) {
    Logger::info(
        "LNET LB RX " +
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

  processPacket(
      packet,
      packetLength);
}

void LocoNetClient::processPacket(
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
            12
    ) {
      Logger::warn(
          "LNET invalid checksum opcode=0x" +
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
    processInputReport(
        packet,
        length);
  }
}

void LocoNetClient::processInputReport(
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

  if (!_sensorFeedbackCallback) {
    return;
  }

  CommandCenterSensorFeedback feedback;

  feedback.address =
      address;

  feedback.on =
      (
          in2 &
          0x10
      ) != 0;

  _sensorFeedbackCallback(
      feedback);
}

bool LocoNetClient::requestSensorSnapshot(
    bool force) {
  if (!connected()) {
    return false;
  }

  startInterrogate(
      force);

  return true;
}

void LocoNetClient::startInterrogate(
    bool force) {
  const unsigned long now =
      millis();

  if (
      !force &&
      _lastInterrogateAt !=
          0 &&
      now -
          _lastInterrogateAt <
          10000
  ) {
    return;
  }

  _interrogatePhase =
      1;

  _nextInterrogateStepAt =
      now +
      INTERROGATE_INTERVAL_MS;

  Logger::info(
      "LocoNet sensor interrogation started");
}

void LocoNetClient::processInterrogate(
    unsigned long now) {
  const bool lbReady =
      _lbConnected &&
      _lbClient.connected();

  const bool binaryReady =
      _binaryConnected &&
      _binaryClient.connected();

  if (
      _interrogatePhase <
          1 ||
      _interrogatePhase >
          8 ||
      (
          !lbReady &&
          !binaryReady
      )
  ) {
    return;
  }

  if (
      _nextInterrogateStepAt != 0 &&
      static_cast<long>(
          now -
          _nextInterrogateStepAt) < 0
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
          _interrogatePhase -
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
        _binaryClient.write(
            packet,
            sizeof(
                packet)) ==
        sizeof(
            packet);

    if (!sent) {
      disconnectBinary();
    }
  }

  if (!sent) {
    return;
  }

  _lastLbTrafficAt =
      now;

  ++_interrogatePhase;

  _nextInterrogateStepAt =
      now +
      INTERROGATE_INTERVAL_MS;

  if (
      _interrogatePhase >
          8
  ) {
    _interrogatePhase =
        0;

    _nextInterrogateStepAt =
        0;

    _lastInterrogateAt =
        now;

    Logger::info(
        "LocoNet sensor interrogation complete");

    if (_sensorSnapshotCompleteCallback) {
      _sensorSnapshotCompleteCallback();
    }
  }
}
