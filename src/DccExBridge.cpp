#include "DccExBridge.h"

#include "Logger.h"
#include "CommandCenterEndpoint.h"

#include <stdlib.h>

void DccExBridge::begin(
    const String& host,
    uint16_t port) {
  setEndpoint(
      host,
      port);

  _frame.reserve(
      256);
}

void DccExBridge::resetHeartbeatState() {
  _heartbeatAlive = false;
  _connectedAt = 0;
  _lastHeartbeatReplyAt = 0;
  _nextHeartbeatAt = 0;
}

void DccExBridge::setEndpoint(
    const String& host,
    uint16_t port) {
  _host = host;
  _port = port;

  _client.stop();

  resetHeartbeatState();

  _nextReconnectAt = 0;
}

bool DccExBridge::connected() {
  return
      _client.connected() &&
      _heartbeatAlive;
}

bool DccExBridge::ensureConnected() {
  if (_client.connected()) {
    return true;
  }

  _client.stop();

  resetHeartbeatState();

  Logger::info(
      "DCC-EX connecting to " +
      _host +
      ":" +
      String(_port));

  IPAddress resolvedAddress;

  if (!connectCommandCenterClient(
          _client,
          _host,
          _port,
          1200,
          &resolvedAddress)) {
    Logger::warn(
        "DCC-EX connection failed: " +
        _host +
        ":" +
        String(_port));

    _nextReconnectAt =
        millis() +
        RECONNECT_MS;

    return false;
  }

  Logger::info(
      "DCC-EX endpoint resolved " +
      _host +
      " -> " +
      resolvedAddress.toString());

  _client.setNoDelay(
      true);

  const unsigned long now =
      millis();

  _connectedAt =
      now;

  _nextReconnectAt =
      0;

  Logger::info(
      "DCC-EX TCP connected; waiting for heartbeat");

  _client.print(
      "<s>");

  sendHeartbeat();

  return true;
}

void DccExBridge::sendHeartbeat() {
  if (!_client.connected()) {
    return;
  }

  const size_t written =
      _client.print(
          "<#>");

  if (written != 3) {
    Logger::warn(
        "DCC-EX heartbeat TX failed");
  }

  _nextHeartbeatAt =
      millis() +
      HEARTBEAT_INTERVAL_MS;
}

bool DccExBridge::sendCommand(
    String command,
    bool logCommand) {
  command.trim();

  if (command.isEmpty()) {
    return false;
  }

  if (!command.startsWith("<")) {
    command =
        "<" +
        command;
  }

  if (!command.endsWith(">")) {
    command +=
        ">";
  }

  if (!ensureConnected()) {
    return false;
  }

  const size_t written =
      _client.print(
          command);

  if (
      written !=
      command.length()
  ) {
    Logger::warn(
        "DCC-EX TX failed: " +
        command);

    return false;
  }

  if (logCommand) {
    Logger::info(
        "DCC-EX TX " +
        command);
  }

  return true;
}

bool DccExBridge::setTrackPower(
    bool on,
    bool includeProgramming) {
  return sendCommand(
      includeProgramming
          ? (on ? "<1>" : "<0>")
          : (on ? "<1 MAIN>" : "<0 MAIN>"));
}

bool DccExBridge::setProgrammingPower(
    bool on) {
  return sendCommand(
      on
          ? "<1 PROG>"
          : "<0 PROG>");
}

bool DccExBridge::emergencyStop() {
  return sendCommand(
      "<!>");
}

bool DccExBridge::setLoco(
    uint16_t address,
    uint8_t speed,
    bool forward) {
  if (
      address == 0 ||
      address > 10239 ||
      speed > 126
  ) {
    return false;
  }

  return sendCommand(
      "<t " +
      String(address) +
      " " +
      String(speed) +
      " " +
      String(
          forward
              ? 1
              : 0) +
      ">");
}

bool DccExBridge::requestLocoState(
    uint16_t address,
    bool logCommand) {
  if (
      address == 0 ||
      address > 10239
  ) {
    return false;
  }

  return sendCommand(
      "<t " +
      String(address) +
      ">",
      logCommand);
}

bool DccExBridge::setLocoFunction(
    uint16_t address,
    uint8_t functionNumber,
    bool active) {
  if (
      address == 0 ||
      address > 10239 ||
      functionNumber > 28
  ) {
    return false;
  }

  return sendCommand(
      "<F " +
      String(address) +
      " " +
      String(functionNumber) +
      " " +
      String(
          active
              ? 1
              : 0) +
      ">");
}

bool DccExBridge::setTurnout(
    uint16_t address,
    bool closed) {
  if (address == 0) {
    return false;
  }

  return sendCommand(
      "<a " +
      String(address) +
      " " +
      String(
          closed
              ? 1
              : 0) +
      ">");
}

bool DccExBridge::setAccessory(
    uint16_t address,
    bool active) {
  if (address == 0) {
    return false;
  }

  return sendCommand(
      "<a " +
      String(address) +
      " " +
      String(
          active
              ? 1
              : 0) +
      ">");
}

bool DccExBridge::setSignalAspect(
    uint16_t address,
    int16_t aspect) {
  if (
      address == 0 ||
      aspect < 0 ||
      aspect > 255
  ) {
    return false;
  }

  return sendCommand(
      "<A " +
      String(address) +
      " " +
      String(aspect) +
      ">");
}

bool DccExBridge::setVPin(
    uint16_t vpin,
    bool active) {
  if (vpin == 0) {
    return false;
  }

  return sendCommand(
      "<z " +
      String(
          active
              ? static_cast<int>(
                    vpin)
              : -static_cast<int>(
                    vpin)) +
      ">");
}

bool DccExBridge::requestTrackConfiguration(
    bool logCommand) {
  return sendCommand(
      "<=>",
      logCommand);
}

bool DccExBridge::requestCurrentTelemetry(
    bool logCommand) {
  return sendCommand(
      "<JI>",
      logCommand);
}

bool DccExBridge::requestTripTelemetry(
    bool logCommand) {
  return sendCommand(
      "<JG>",
      logCommand);
}

bool DccExBridge::sendRawCommand(
    String command,
    bool logCommand) {
  return sendCommand(
      std::move(command),
      logCommand);
}

size_t DccExBridge::parseIntegerList(
    const String& text,
    int32_t* values,
    size_t maxValues) {
  if (
      !values ||
      maxValues == 0
  ) {
    return 0;
  }

  const char* cursor =
      text.c_str();

  size_t count = 0;

  while (
      *cursor &&
      count < maxValues
  ) {
    while (
        *cursor &&
        (
            *cursor == ' ' ||
            *cursor == '\t' ||
            *cursor == ','
        )
    ) {
      ++cursor;
    }

    if (!*cursor) {
      break;
    }

    char* end =
        nullptr;

    const long value =
        strtol(
            cursor,
            &end,
            10);

    if (end == cursor) {
      while (
          *cursor &&
          *cursor != ' ' &&
          *cursor != '\t' &&
          *cursor != ','
      ) {
        ++cursor;
      }

      continue;
    }

    values[count++] =
        static_cast<int32_t>(
            value);

    cursor =
        end;
  }

  return count;
}

String DccExBridge::cleanVersion(
    String value) {
  value.trim();

  if (
      value.startsWith(
          "DCC-EX")
  ) {
    value.remove(
        0,
        6);
  } else if (
      value.startsWith(
          "DCCEX")
  ) {
    value.remove(
        0,
        5);
  }

  value.trim();

  if (
      value.startsWith(
          "V-")
  ) {
    value.remove(
        0,
        2);
  } else if (
      value.startsWith(
          "V")
  ) {
    value.remove(
        0,
        1);
  }

  value.trim();

  return value;
}

void DccExBridge::emitStationInfo() {
  if (_stationInfoCallback) {
    _stationInfoCallback(
        _stationInfo);
  }
}

void DccExBridge::processFrame(
    const String& frame) {
  if (
      !frame.startsWith(
          "<jI") &&
      !frame.startsWith(
          "<jG")
  ) {
    if (_rawInfoCallback) {
      _rawInfoCallback(
          frame);
    }
  }

  if (
      frame.startsWith(
          "<#")
  ) {
    unsigned int maxLocos =
        0;

    if (
        sscanf(
            frame.c_str(),
            "<# %u>",
            &maxLocos) ==
            1 &&
        maxLocos <= 65535
    ) {
      _stationInfo.maxLocos =
          static_cast<uint16_t>(
              maxLocos);

      emitStationInfo();
    }

    return;
  }

  if (
      frame.startsWith(
          "<i")
  ) {
    String body =
        frame.substring(
            2,
            frame.length() -
                1);

    String fields[4];

    uint8_t fieldCount =
        0;

    int start =
        0;

    while (
        fieldCount < 4
    ) {
      const int slash =
          body.indexOf(
              '/',
              start);

      if (slash < 0) {
        fields[
            fieldCount++] =
            body.substring(
                start);

        break;
      }

      fields[
          fieldCount++] =
          body.substring(
              start,
              slash);

      start =
          slash +
          1;
    }

    for (
        uint8_t index = 0;
        index < fieldCount;
        ++index
    ) {
      fields[index]
          .trim();
    }

    if (
        fieldCount >
        0
    ) {
      _stationInfo.version =
          cleanVersion(
              fields[0]);
    }

    if (
        fieldCount >
        1
    ) {
      _stationInfo.processor =
          fields[1];
    }

    if (
        fieldCount >
        2
    ) {
      _stationInfo.hardware =
          fields[2];

      const int buildAt =
          _stationInfo.hardware
              .lastIndexOf(
                  " G-");

      if (buildAt >= 0) {
        _stationInfo.build =
            _stationInfo.hardware
                .substring(
                    buildAt +
                    1);

        _stationInfo.hardware =
            _stationInfo.hardware
                .substring(
                    0,
                    buildAt);

        _stationInfo.hardware
            .trim();

        _stationInfo.build
            .trim();
      }
    }

    if (
        fieldCount >
        3
    ) {
      _stationInfo.build =
          fields[3];
    }

    emitStationInfo();
    return;
  }

  if (
      frame.startsWith(
          "<= ") &&
      frame.length() >=
          6
  ) {
    const char letter =
        frame.charAt(
            3);

    if (
        letter >= 'A' &&
        letter <= 'H'
    ) {
      CommandCenterTrackConfiguration
          event;

      event.index =
          static_cast<uint8_t>(
              letter -
              'A');

      event.mode =
          frame.substring(
              5,
              frame.length() -
                  1);

      event.mode.trim();

      if (
          _trackConfigurationCallback
      ) {
        _trackConfigurationCallback(
            event);
      }
    }

    return;
  }

  if (
      frame.startsWith(
          "<jI")
  ) {
    CommandCenterCurrentTelemetry
        event;

    const String body =
        frame.substring(
            3,
            frame.length() -
                1);

    event.count =
        parseIntegerList(
            body,
            event.values,
            COMMAND_CENTER_MAX_TRACKS);

    if (
        _currentTelemetryCallback
    ) {
      _currentTelemetryCallback(
          event);
    }

    return;
  }

  if (
      frame.startsWith(
          "<jG")
  ) {
    CommandCenterTripTelemetry
        event;

    const String body =
        frame.substring(
            3,
            frame.length() -
                1);

    event.count =
        parseIntegerList(
            body,
            event.values,
            COMMAND_CENTER_MAX_TRACKS);

    if (
        _tripTelemetryCallback
    ) {
      _tripTelemetryCallback(
          event);
    }

    return;
  }

  if (
      frame.startsWith(
          "<p0") ||
      frame.startsWith(
          "<p1")
  ) {
    CommandCenterPowerFeedback
        event;

    event.on =
        frame.charAt(
            2) ==
        '1';

    String target =
        frame.substring(
            3,
            frame.length() -
                1);

    target.trim();

    if (
        target.length() ==
        0
    ) {
      event.target =
          CommandCenterPowerTarget::All;
    } else if (
        target ==
        "MAIN"
    ) {
      event.target =
          CommandCenterPowerTarget::Main;
    } else if (
        target ==
        "PROG"
    ) {
      event.target =
          CommandCenterPowerTarget::Programming;
    } else if (
        target ==
        "JOIN"
    ) {
      event.target =
          CommandCenterPowerTarget::Joined;
    } else if (
        target.length() ==
        1
    ) {
      const char letter =
          target.charAt(
              0);

      if (
          letter >= 'A' &&
          letter <= 'H'
      ) {
        event.target =
            CommandCenterPowerTarget::Track;

        event.trackIndex =
            static_cast<uint8_t>(
                letter -
                'A');
      } else {
        return;
      }
    } else {
      return;
    }

    if (
        _powerFeedbackCallback
    ) {
      _powerFeedbackCallback(
          event);
    }

    return;
  }

  if (
      frame.startsWith(
          "<l ")
  ) {
    unsigned int addressValue =
        0;

    int registerValue =
        0;

    unsigned int speedByteValue =
        0;

    unsigned long functionMapValue =
        0;

    const int parsed =
        sscanf(
            frame.c_str(),
            "<l %u %d %u %lu>",
            &addressValue,
            &registerValue,
            &speedByteValue,
            &functionMapValue);

    (void)registerValue;

    if (
        parsed != 4 ||
        addressValue == 0 ||
        addressValue > 10239 ||
        speedByteValue > 255
    ) {
      Logger::warn(
          "Ignoring malformed DCC-EX loco feedback: " +
          frame);

      return;
    }

    const uint8_t speedByte =
        static_cast<uint8_t>(
            speedByteValue);

    const uint8_t encodedSpeed =
        speedByte &
        0x7f;

    CommandCenterLocoFeedback
        event;

    event.address =
        static_cast<uint16_t>(
            addressValue);

    event.forward =
        (speedByte &
         0x80) != 0;

    event.speed =
        encodedSpeed <= 1
            ? 0
            : static_cast<uint8_t>(
                  encodedSpeed -
                  1);

    event.functionsMask =
        static_cast<uint32_t>(
            functionMapValue);

    if (
        _locoFeedbackCallback
    ) {
      _locoFeedbackCallback(
          event);
    }

    return;
  }
}

void DccExBridge::processByte(
    char c) {
  if (!_insideFrame) {
    if (c == '<') {
      _insideFrame =
          true;

      _frame =
          "<";
    }

    return;
  }

  if (c == '<') {
    _frame =
        "<";

    return;
  }

  _frame +=
      c;

  if (c == '>') {
    _insideFrame =
        false;

    const bool quietRx =
        _frame.startsWith(
            "<#") ||
        _frame.startsWith(
            "<jI") ||
        _frame.startsWith(
            "<jG");

    if (!quietRx) {
      Logger::info(
          "DCC-EX RX " +
          _frame);
    }

    if (
        _frame.startsWith(
            "<#")
    ) {
      const unsigned long now =
          millis();

      const bool wasAlive =
          _heartbeatAlive;

      _heartbeatAlive =
          true;

      _lastHeartbeatReplyAt =
          now;

      if (!wasAlive) {
        Logger::info(
            "DCC-EX heartbeat ONLINE");
      }
    }

    processFrame(
        _frame);

    _frame.clear();

    return;
  }

  if (
      _frame.length() >
      1024
  ) {
    Logger::warn(
        "DCC-EX frame exceeded 1024 bytes; resync");

    _insideFrame =
        false;

    _frame.clear();
  }
}

void DccExBridge::loop() {
  if (!_client.connected()) {
    if (_heartbeatAlive) {
      Logger::warn(
          "DCC-EX heartbeat OFFLINE: TCP disconnected");
    }

    resetHeartbeatState();

    const unsigned long now =
        millis();

    if (
        _nextReconnectAt == 0 ||
        static_cast<long>(
            now -
            _nextReconnectAt) >= 0
    ) {
      ensureConnected();
    }

    return;
  }

  while (
      _client.available()
  ) {
    processByte(
        static_cast<char>(
            _client.read()));
  }

  const unsigned long now =
      millis();

  if (
      _nextHeartbeatAt == 0 ||
      static_cast<long>(
          now -
          _nextHeartbeatAt) >= 0
  ) {
    sendHeartbeat();
  }

  const unsigned long heartbeatBase =
      _lastHeartbeatReplyAt != 0
          ? _lastHeartbeatReplyAt
          : _connectedAt;

  if (
      heartbeatBase != 0 &&
      now -
          heartbeatBase >=
          HEARTBEAT_TIMEOUT_MS
  ) {
    if (_heartbeatAlive) {
      _heartbeatAlive =
          false;

      Logger::warn(
          "DCC-EX heartbeat OFFLINE: reply timeout");
    }
  }

  if (
      heartbeatBase != 0 &&
      now -
          heartbeatBase >=
          HEARTBEAT_RECONNECT_MS
  ) {
    Logger::warn(
        "DCC-EX heartbeat stale; forcing TCP reconnect");

    _client.stop();

    resetHeartbeatState();

    _nextReconnectAt =
        now +
        RECONNECT_MS;
  }
}
