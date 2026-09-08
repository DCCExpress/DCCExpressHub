#include "WsProtocol.h"

#include "Logger.h"
#include "FileStore.h"
#include "config.h"

#include <LittleFS.h>
#include <WiFi.h>
#include <esp_freertos_hooks.h>
#include <esp_system.h>
#include <stdlib.h>

namespace {

volatile uint32_t cpuIdleCounters[2] = {0, 0};
uint32_t cpuIdleBaseline[2] = {1, 1};
uint32_t cpuIdlePrevious[2] = {0, 0};
uint8_t cpuUsagePercent[2] = {0, 0};
unsigned long lastCpuSampleAtMs = 0;
esp_reset_reason_t bootResetReason =
    ESP_RST_UNKNOWN;

bool cpuIdleHook0() {
  ++cpuIdleCounters[0];
  return false;
}

bool cpuIdleHook1() {
  ++cpuIdleCounters[1];
  return false;
}

void updateCpuUsage() {
  const unsigned long now =
      millis();

  if (
      now -
          lastCpuSampleAtMs <
      1000
  ) {
    return;
  }

  lastCpuSampleAtMs =
      now;

  for (
      uint8_t core = 0;
      core < 2;
      ++core
  ) {
    const uint32_t current =
        cpuIdleCounters[core];

    const uint32_t idleDelta =
        current -
        cpuIdlePrevious[core];

    cpuIdlePrevious[core] =
        current;

    if (
        idleDelta >
        cpuIdleBaseline[core]
    ) {
      cpuIdleBaseline[core] =
          idleDelta;
    }

    const uint32_t baseline =
        cpuIdleBaseline[core] > 0
            ? cpuIdleBaseline[core]
            : 1;

    const uint32_t measuredIdlePercent =
        (idleDelta * 100ULL) /
        baseline;

    const uint32_t idlePercent =
        measuredIdlePercent > 100
            ? 100
            : measuredIdlePercent;

    cpuUsagePercent[core] =
        static_cast<uint8_t>(
            100 -
            idlePercent);
  }
}

const char* resetReasonName(
    esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON:
      return "power-on";

    case ESP_RST_EXT:
      return "external";

    case ESP_RST_SW:
      return "software";

    case ESP_RST_PANIC:
      return "panic";

    case ESP_RST_INT_WDT:
      return "interrupt-watchdog";

    case ESP_RST_TASK_WDT:
      return "task-watchdog";

    case ESP_RST_WDT:
      return "watchdog";

    case ESP_RST_DEEPSLEEP:
      return "deep-sleep";

    case ESP_RST_BROWNOUT:
      return "brownout";

    case ESP_RST_SDIO:
      return "sdio";

    default:
      return "unknown";
  }
}

uint16_t parseBlockId(
    JsonVariantConst value) {
  if (
      value.is<
          const char*>()
  ) {
    const char* text =
        value.as<
            const char*>();

    if (
        !text ||
        !*text
    ) {
      return 0;
    }

    const long parsed =
        strtol(
            text,
            nullptr,
            10);

    return
        parsed > 0 &&
        parsed <= 0xffff
            ? static_cast<uint16_t>(
                  parsed)
            : 0;
  }

  const long parsed =
      value | 0L;

  return
      parsed > 0 &&
      parsed <= 0xffff
          ? static_cast<uint16_t>(
                parsed)
          : 0;
}

}


WsProtocol::WsProtocol(
    AsyncWebSocket& ws,
    ICommandCenter& commandCenter,
    LayoutRuntime& runtime,
    RuntimeStateStore& stateStore)
    : _ws(ws),
      _commandCenter(commandCenter),
      _runtime(runtime),
      _stateStore(stateStore) {}


void WsProtocol::begin() {
  _ws.onEvent(
      [this](
          AsyncWebSocket* server,
          AsyncWebSocketClient* client,
          AwsEventType type,
          void* arg,
          uint8_t* data,
          size_t len) {
        handleEvent(
            server,
            client,
            type,
            arg,
            data,
            len);
      });

  _commandCenter.onRawInfo(
      [this](
          const String& raw) {
        broadcastRawInfo(
            raw);
      });

  _commandCenter.onStationInfo(
      [this](
          const CommandCenterStationInfo& info) {
        handleStationInfo(
            info);
      });

  _commandCenter.onTrackConfiguration(
      [this](
          const CommandCenterTrackConfiguration& info) {
        handleTrackConfiguration(
            info);
      });

  _commandCenter.onCurrentTelemetry(
      [this](
          const CommandCenterCurrentTelemetry& info) {
        handleCurrentTelemetry(
            info);
      });

  _commandCenter.onTripTelemetry(
      [this](
          const CommandCenterTripTelemetry& info) {
        handleTripTelemetry(
            info);
      });

  _commandCenter.onPowerFeedback(
      [this](
          const CommandCenterPowerFeedback& info) {
        handlePowerFeedback(
            info);
      });

  _commandCenter.onLocoFeedback(
      [this](
          const CommandCenterLocoFeedback& info) {
        handleLocoFeedback(
            info);
      });

  _runtime.onChange(
      [this](
          RuntimeChangeKind kind,
          uint16_t,
          uint8_t) {
        if (
            kind ==
            RuntimeChangeKind::Block
        ) {
          broadcastBlockStateSnapshot();
        }
      });

  bootResetReason =
      esp_reset_reason();

  esp_register_freertos_idle_hook_for_cpu(
      cpuIdleHook0,
      0);

  esp_register_freertos_idle_hook_for_cpu(
      cpuIdleHook1,
      1);

  delay(250);

  for (
      uint8_t core = 0;
      core < 2;
      ++core
  ) {
    cpuIdleBaseline[core] =
        cpuIdleCounters[core]
            ? cpuIdleCounters[core] *
                  4
            : 1;

    cpuIdlePrevious[core] =
        cpuIdleCounters[core];
  }

  lastCpuSampleAtMs =
      millis();

  _lastCommandCenterConnected =
      _commandCenter.connected();

  if (
      _lastCommandCenterConnected
  ) {
    _commandCenterConnectedSinceAt =
        millis();
  }
}


void WsProtocol::loop() {
  const unsigned long now =
      millis();

  updateCpuUsage();

  handleCommandCenterConnectionState(
      now);

  pollLocoStateSync(
      now);

  pollDccExTelemetry(
      now);

  if (
      _nextHubStatusAt == 0 ||
      static_cast<long>(
          now -
          _nextHubStatusAt) >= 0
  ) {
    if (
        _wsClientCount > 0
    ) {
      broadcastDccExStatus();
    }

    _nextHubStatusAt =
        now +
        HUB_STATUS_INTERVAL_MS;
  }
}


void WsProtocol::cleanupClients() {
  _ws.cleanupClients();
}


void WsProtocol::send(
    AsyncWebSocketClient* client,
    const char* type,
    JsonVariantConst data) {
  JsonDocument out;

  out["type"] =
      type;

  out["data"].set(
      data);

  String body;

  serializeJson(
      out,
      body);

  client->text(
      body);
}


void WsProtocol::broadcast(
    const char* type,
    JsonDocument& data) {
  JsonDocument out;

  out["type"] =
      type;

  out["data"].set(
      data.as<
          JsonVariantConst>());

  String body;

  serializeJson(
      out,
      body);

  _ws.textAll(
      body);
}


void WsProtocol::sendCommandCenterInfo(
    AsyncWebSocketClient* client) {
  JsonDocument data;

  data["alive"] =
      _commandCenter.connected();

  data["power"] =
      _trackPower;

  data["type"] =
      _commandCenter.type();

  data["name"] =
      _commandCenter.name();

  data["ip"] =
      _commandCenter.host();

  data["port"] =
      _commandCenter.port();

  data["connectionString"] =
      _commandCenter.host() +
      ":" +
      String(
          _commandCenter.port());

  send(
      client,
      "commandCenterInfo",
      data.as<
          JsonVariantConst>());
}


void WsProtocol::sendPowerInfo(
    AsyncWebSocketClient* client) {
  JsonDocument data;

  data["emergencyStop"] =
      _emergencyStop;

  data["trackVoltageOn"] =
      _trackPower;

  data["trackVoltageOff"] =
      !_trackPower;

  data["shortCircuit"] =
      false;

  data["programmingModeActive"] =
      _programmingPower;

  send(
      client,
      "powerInfo",
      data.as<
          JsonVariantConst>());
}


void WsProtocol::broadcastPowerInfo() {
  JsonDocument data;

  data["emergencyStop"] =
      _emergencyStop;

  data["trackVoltageOn"] =
      _trackPower;

  data["trackVoltageOff"] =
      !_trackPower;

  data["shortCircuit"] =
      false;

  data["programmingModeActive"] =
      _programmingPower;

  broadcast(
      "powerInfo",
      data);
}


void WsProtocol::sendBlockStateSnapshot(
    AsyncWebSocketClient* client) {
  JsonDocument data;

  for (
      const auto& block :
      _runtime.blocks()
  ) {
    JsonObject state =
        data[
            String(
                block.id)]
            .to<
                JsonObject>();

    state["blockId"] =
        String(
            block.id);

    if (
        block.locoId
            .isEmpty()
    ) {
      state["locoId"] =
          nullptr;
    } else {
      state["locoId"] =
          block.locoId;
    }

    if (
        block.locoAddress >
        0
    ) {
      state["locoAddress"] =
          block.locoAddress;
    }
  }

  send(
      client,
      "blockStateChanged",
      data.as<
          JsonVariantConst>());
}


void WsProtocol::broadcastBlockStateSnapshot() {
  JsonDocument data;

  for (
      const auto& block :
      _runtime.blocks()
  ) {
    JsonObject state =
        data[
            String(
                block.id)]
            .to<
                JsonObject>();

    state["blockId"] =
        String(
            block.id);

    if (
        block.locoId
            .isEmpty()
    ) {
      state["locoId"] =
          nullptr;
    } else {
      state["locoId"] =
          block.locoId;
    }

    if (
        block.locoAddress >
        0
    ) {
      state["locoAddress"] =
          block.locoAddress;
    }
  }

  broadcast(
      "blockStateChanged",
      data);
}


void WsProtocol::recomputePowerStateFromTrackTelemetry() {
  bool mainSeen =
      false;

  bool mainKnown =
      true;

  bool mainOn =
      true;

  bool progSeen =
      false;

  bool progKnown =
      true;

  bool progOn =
      true;

  for (
      uint8_t index = 0;
      index < MAX_DCC_TRACKS;
      ++index
  ) {
    const DccTrackState& track =
        _dccTracks[index];

    if (
        !track.configured
    ) {
      continue;
    }

    if (
        track.mode
            .startsWith(
                "MAIN")
    ) {
      mainSeen =
          true;

      if (
          !track.powerKnown
      ) {
        mainKnown =
            false;
      } else if (
          !track.powerOn
      ) {
        mainOn =
            false;
      }
    }

    if (
        track.mode
            .startsWith(
                "PROG")
    ) {
      progSeen =
          true;

      if (
          !track.powerKnown
      ) {
        progKnown =
            false;
      } else if (
          !track.powerOn
      ) {
        progOn =
            false;
      }
    }
  }

  if (
      mainSeen &&
      mainKnown
  ) {
    _trackPower =
        mainOn;
  }

  if (
      progSeen &&
      progKnown
  ) {
    _programmingPower =
        progOn;
  }
}


void WsProtocol::appendHubStatus(
    JsonObject hub) {
  hub["uptimeMs"] =
      millis();

  hub["chipModel"] =
      ESP.getChipModel();

  hub["chipRevision"] =
      ESP.getChipRevision();

  hub["cpuCores"] =
      2;

  hub["cpuFrequencyMhz"] =
      ESP.getCpuFreqMHz();

  hub["cpuCore0Percent"] =
      cpuUsagePercent[0];

  hub["cpuCore1Percent"] =
      cpuUsagePercent[1];

  hub["chipTemperatureC"] =
      temperatureRead();

  hub["heapSizeBytes"] =
      ESP.getHeapSize();

  hub["freeHeapBytes"] =
      ESP.getFreeHeap();

  hub["minimumFreeHeapBytes"] =
      ESP.getMinFreeHeap();

  hub["largestFreeHeapBlockBytes"] =
      ESP.getMaxAllocHeap();

  hub["psramSizeBytes"] =
      ESP.getPsramSize();

  hub["freePsramBytes"] =
      ESP.getFreePsram();

  hub["hostname"] =
      DEVICE_HOSTNAME;

  hub["wifiIp"] =
      WiFi.localIP()
          .toString();

  hub["wifiRssiDbm"] =
      WiFi.RSSI();

  hub["wifiSsid"] =
      WiFi.SSID();

  hub["wifiMac"] =
      WiFi.macAddress();

  hub["wifiChannel"] =
      WiFi.channel();

  hub["wsClients"] =
      _wsClientCount;

  hub["runtimeAccessories"] =
      _runtime.accessoryCount();

  hub["runtimeSensors"] =
      _runtime.sensorCount();

  hub["runtimeBlocks"] =
      _runtime.blockCount();

  hub["flashChipBytes"] =
      ESP.getFlashChipSize();

  hub["sketchBytes"] =
      ESP.getSketchSize();

  hub["freeSketchBytes"] =
      ESP.getFreeSketchSpace();

  hub["sdkVersion"] =
      ESP.getSdkVersion();

  hub["resetReason"] =
      resetReasonName(
          bootResetReason);
}


void WsProtocol::appendDccExStatus(
    JsonDocument& data) {
  const bool alive =
      _commandCenter.connected();

  int32_t mainCurrentMa =
      -1;

  int32_t progCurrentMa =
      -1;

  for (
      uint8_t index = 0;
      index < MAX_DCC_TRACKS;
      ++index
  ) {
    const DccTrackState& track =
        _dccTracks[index];

    if (
        !track.configured
    ) {
      continue;
    }

    if (
        track.mode
                .startsWith(
                    "MAIN") &&
        mainCurrentMa < 0
    ) {
      mainCurrentMa =
          track.currentMa;
    }

    if (
        track.mode
                .startsWith(
                    "PROG") &&
        progCurrentMa < 0
    ) {
      progCurrentMa =
          track.currentMa;
    }
  }

  data["version"] =
      _dccVersion;

  data["processor"] =
      _dccProcessor;

  data["hardware"] =
      _dccHardware;

  data["build"] =
      _dccBuild;

  data["host"] =
      _commandCenter.host();

  data["port"] =
      _commandCenter.port();

  data["alive"] =
      alive;

  data["maxLocos"] =
      _dccMaxLocos;

  data["trackVoltageOn"] =
      _trackPower;

  data["voltageMeasured"] =
      false;

  data["trackVoltageV"] =
      nullptr;

  data["mainCurrentMa"] =
      mainCurrentMa >= 0
          ? mainCurrentMa
          : 0;

  data["progCurrentMa"] =
      progCurrentMa >= 0
          ? progCurrentMa
          : 0;

  data["currentUpdatedAtMs"] =
      _dccCurrentUpdatedAt;

  data["linkUptimeMs"] =
      alive &&
      _commandCenterConnectedSinceAt
          ? millis() -
                _commandCenterConnectedSinceAt
          : 0;

  JsonArray tracks =
      data["tracks"]
          .to<
              JsonArray>();

  for (
      uint8_t index = 0;
      index < MAX_DCC_TRACKS;
      ++index
  ) {
    const DccTrackState& track =
        _dccTracks[index];

    if (
        !track.configured
    ) {
      continue;
    }

    JsonObject out =
        tracks
            .add<
                JsonObject>();

    char letter[2] = {
        static_cast<char>(
            'A' +
            index),
        '\0'};

    out["letter"] =
        letter;

    out["mode"] =
        track.mode;

    if (
        track.currentMa >=
        0
    ) {
      out["currentMa"] =
          track.currentMa;
    } else {
      out["currentMa"] =
          nullptr;
    }

    out["overload"] =
        track.overload;

    if (
        track.tripMa >=
        0
    ) {
      out["tripMa"] =
          track.tripMa;
    } else {
      out["tripMa"] =
          nullptr;
    }
  }

  JsonObject hub =
      data["hub"]
          .to<
              JsonObject>();

  appendHubStatus(
      hub);

  data["uptimeMs"] =
      millis();

  data["freeHeapBytes"] =
      ESP.getFreeHeap();

  data["cpuCores"] =
      2;

  data["cpuFrequencyMhz"] =
      ESP.getCpuFreqMHz();

  data["cpuCore0Percent"] =
      cpuUsagePercent[0];

  data["cpuCore1Percent"] =
      cpuUsagePercent[1];

  data["chipTemperatureC"] =
      temperatureRead();

  data["wsClients"] =
      _wsClientCount;

  data["minimumFreeHeapBytes"] =
      ESP.getMinFreeHeap();

  data["largestFreeHeapBlockBytes"] =
      ESP.getMaxAllocHeap();

  data["resetReason"] =
      resetReasonName(
          bootResetReason);
}


void WsProtocol::sendDccExStatus(
    AsyncWebSocketClient* client) {
  JsonDocument data;

  appendDccExStatus(
      data);

  send(
      client,
      "dccExStatus",
      data.as<
          JsonVariantConst>());
}


void WsProtocol::broadcastDccExStatus() {
  JsonDocument data;

  appendDccExStatus(
      data);

  broadcast(
      "dccExStatus",
      data);
}


bool WsProtocol::requestLocoState(
    uint16_t address,
    bool logCommand) {
  if (
      address == 0 ||
      address > 10239 ||
      !_commandCenter.connected()
  ) {
    return false;
  }

  return
      _commandCenter
          .requestLocoState(
              address,
              logCommand);
}


void WsProtocol::beginConfiguredLocoStateSync(
    unsigned long now) {
  _locoSyncCount =
      0;

  _locoSyncIndex =
      0;

  _nextLocoSyncAt =
      0;

  static constexpr const char* LOCOS_PATH =
      "/config/locos.json";

  FileStore files(
      LittleFS);

  if (
      !files.exists(
          LOCOS_PATH)
  ) {
    Logger::info(
        "Loco state sync: no saved locomotive list");

    return;
  }

  File file =
      files.openRead(
          LOCOS_PATH);

  if (!file) {
    Logger::warn(
        "Loco state sync: cannot open locos.json");

    return;
  }

  JsonDocument filter;

  filter[0]["address"] =
      true;

  JsonDocument document;

  const DeserializationError error =
      deserializeJson(
          document,
          file,
          DeserializationOption::Filter(
              filter));

  file.close();

  if (
      error ||
      !document.is<
          JsonArray>()
  ) {
    Logger::warn(
        "Loco state sync: invalid locos.json");

    return;
  }

  for (
      JsonObjectConst item :
      document.as<
          JsonArrayConst>()
  ) {
    const int addressValue =
        item["address"] |
        0;

    if (
        addressValue <= 0 ||
        addressValue > 10239
    ) {
      continue;
    }

    const uint16_t address =
        static_cast<uint16_t>(
            addressValue);

    bool duplicate =
        false;

    for (
        size_t index = 0;
        index < _locoSyncCount;
        ++index
    ) {
      if (
          _locoSyncAddresses[index] ==
          address
      ) {
        duplicate =
            true;

        break;
      }
    }

    if (duplicate) {
      continue;
    }

    if (
        _locoSyncCount >=
        MAX_LOCOS
    ) {
      Logger::warn(
          "Loco state sync: locomotive limit reached");

      break;
    }

    _locoSyncAddresses[
        _locoSyncCount++] =
        address;
  }

  if (
      _locoSyncCount == 0
  ) {
    Logger::info(
        "Loco state sync: no valid DCC addresses");

    return;
  }

  _nextLocoSyncAt =
      now;

  Logger::info(
      "Loco state sync queued: " +
      String(
          _locoSyncCount) +
      " locomotive(s)");
}


void WsProtocol::pollLocoStateSync(
    unsigned long now) {
  if (
      !_commandCenter.connected() ||
      _locoSyncIndex >=
          _locoSyncCount
  ) {
    return;
  }

  if (
      _nextLocoSyncAt != 0 &&
      static_cast<long>(
          now -
          _nextLocoSyncAt) < 0
  ) {
    return;
  }

  const uint16_t address =
      _locoSyncAddresses[
          _locoSyncIndex];

  if (
      !requestLocoState(
          address,
          false)
  ) {
    _nextLocoSyncAt =
        now +
        LOCO_STATE_SYNC_INTERVAL_MS;

    return;
  }

  ++_locoSyncIndex;

  if (
      _locoSyncIndex >=
      _locoSyncCount
  ) {
    _nextLocoSyncAt =
        0;

    Logger::info(
        "Loco state sync requests completed");

    return;
  }

  _nextLocoSyncAt =
      now +
      LOCO_STATE_SYNC_INTERVAL_MS;
}


void WsProtocol::handleCommandCenterConnectionState(
    unsigned long now) {
  const bool connected =
      _commandCenter.connected();

  if (
      connected ==
      _lastCommandCenterConnected
  ) {
    return;
  }

  _lastCommandCenterConnected =
      connected;

  if (!connected) {
    _commandCenterConnectedSinceAt =
        0;

    _nextDccCurrentPollAt =
        0;

    _locoSyncCount =
        0;

    _locoSyncIndex =
        0;

    _nextLocoSyncAt =
        0;

    for (
        uint8_t index = 0;
        index < MAX_DCC_TRACKS;
        ++index
    ) {
      _dccTracks[index].configured =
          false;

      _dccTracks[index].mode =
          "";

      _dccTracks[index].powerKnown =
          false;

      _dccTracks[index].powerOn =
          false;

      _dccTracks[index].currentMa =
          -1;

      _dccTracks[index].tripMa =
          -1;

      _dccTracks[index].overload =
          false;
    }

    return;
  }

  _commandCenterConnectedSinceAt =
      now;

  _nextDccCurrentPollAt =
      0;

  _commandCenter
      .requestTrackConfiguration(
          false);

  _commandCenter
      .requestTripTelemetry(
          false);

  beginConfiguredLocoStateSync(
      now);
}


void WsProtocol::pollDccExTelemetry(
    unsigned long now) {
  if (
      !_commandCenter.connected() ||
      _wsClientCount == 0
  ) {
    return;
  }

  if (
      _nextDccCurrentPollAt == 0 ||
      static_cast<long>(
          now -
          _nextDccCurrentPollAt) >= 0
  ) {
    _commandCenter
        .requestCurrentTelemetry(
            false);

    _nextDccCurrentPollAt =
        now +
        DCC_CURRENT_POLL_MS;
  }
}


void WsProtocol::sendRuntimeSnapshot(
    AsyncWebSocketClient* client) {
  sendCommandCenterInfo(
      client);

  sendPowerInfo(
      client);

  sendDccExStatus(
      client);

  for (
      const auto& item :
      _runtime.accessories()
  ) {
    JsonDocument data;

    switch (
        item.kind
    ) {
      case RuntimeAccessoryKind::Turnout:
        data["address"] =
            item.address;

        data["closed"] =
            item.closed;

        send(
            client,
            "turnoutChanged",
            data.as<
                JsonVariantConst>());

        break;

      case RuntimeAccessoryKind::Signal:
        if (
            item.aspect >=
            0
        ) {
          data["address"] =
              item.address;

          data["aspect"] =
              item.aspect;

          send(
              client,
              "signalAspectChanged",
              data.as<
                  JsonVariantConst>());
        }

        break;

      case RuntimeAccessoryKind::Accessory:
        data["address"] =
            item.address;

        data["active"] =
            item.active;

        send(
            client,
            "accessoryChanged",
            data.as<
                JsonVariantConst>());

        break;

      case RuntimeAccessoryKind::VPin:
        data["vpin"] =
            item.address;

        data["active"] =
            item.active;

        send(
            client,
            "vpinChanged",
            data.as<
                JsonVariantConst>());

        break;
    }
  }

  for (
      const auto& sensor :
      _runtime.sensors()
  ) {
    JsonDocument data;

    data["address"] =
        sensor.address;

    data["on"] =
        sensor.on;

    send(
        client,
        "sensorChanged",
        data.as<
            JsonVariantConst>());
  }

  sendBlockStateSnapshot(
      client);
}


void WsProtocol::broadcastRuntimeSnapshot() {
  JsonDocument cc;

  cc["alive"] =
      _commandCenter.connected();

  cc["power"] =
      _trackPower;

  cc["type"] =
      _commandCenter.type();

  cc["name"] =
      _commandCenter.name();

  cc["ip"] =
      _commandCenter.host();

  cc["port"] =
      _commandCenter.port();

  broadcast(
      "commandCenterInfo",
      cc);

  broadcastPowerInfo();
  broadcastDccExStatus();

  for (
      const auto& item :
      _runtime.accessories()
  ) {
    JsonDocument data;

    switch (
        item.kind
    ) {
      case RuntimeAccessoryKind::Turnout:
        data["address"] =
            item.address;

        data["closed"] =
            item.closed;

        broadcast(
            "turnoutChanged",
            data);

        break;

      case RuntimeAccessoryKind::Signal:
        if (
            item.aspect >=
            0
        ) {
          data["address"] =
              item.address;

          data["aspect"] =
              item.aspect;

          broadcast(
              "signalAspectChanged",
              data);
        }

        break;

      case RuntimeAccessoryKind::Accessory:
        data["address"] =
            item.address;

        data["active"] =
            item.active;

        broadcast(
            "accessoryChanged",
            data);

        break;

      case RuntimeAccessoryKind::VPin:
        data["vpin"] =
            item.address;

        data["active"] =
            item.active;

        broadcast(
            "vpinChanged",
            data);

        break;
    }
  }

  for (
      const auto& sensor :
      _runtime.sensors()
  ) {
    JsonDocument data;

    data["address"] =
        sensor.address;

    data["on"] =
        sensor.on;

    broadcast(
        "sensorChanged",
        data);
  }

  broadcastBlockStateSnapshot();
}


void WsProtocol::broadcastRawInfo(
    const String& raw) {
  JsonDocument data;

  data["raw"] =
      raw;

  broadcast(
      "rawInfo",
      data);
}


WsProtocol::LocoState*
WsProtocol::getLoco(
    uint16_t address,
    bool create) {
  for (
      size_t index = 0;
      index < _locoCount;
      ++index
  ) {
    if (
        _locos[index].address ==
        address
    ) {
      return
          &_locos[index];
    }
  }

  if (
      !create ||
      _locoCount >=
          MAX_LOCOS
  ) {
    return nullptr;
  }

  auto& loco =
      _locos[
          _locoCount++];

  loco.address =
      address;

  loco.speed =
      0;

  loco.forward =
      true;

  loco.functionsMask =
      0;

  return &loco;
}


void WsProtocol::broadcastLoco(
    const LocoState& loco) {
  JsonDocument data;

  JsonObject out =
      data["loco"]
          .to<
              JsonObject>();

  out["address"] =
      loco.address;

  out["speed"] =
      loco.speed;

  out["direction"] =
      loco.forward
          ? "forward"
          : "reverse";

  out["functionsMask"] =
      loco.functionsMask;

  broadcast(
      "locoState",
      data);
}


void WsProtocol::handleStationInfo(
    const CommandCenterStationInfo& info) {
  _dccVersion =
      info.version;

  _dccProcessor =
      info.processor;

  _dccHardware =
      info.hardware;

  _dccBuild =
      info.build;

  _dccMaxLocos =
      info.maxLocos;
}


void WsProtocol::handleTrackConfiguration(
    const CommandCenterTrackConfiguration& info) {
  if (
      info.index >=
      MAX_DCC_TRACKS
  ) {
    return;
  }

  _dccTracks[
      info.index]
      .configured =
      true;

  _dccTracks[
      info.index]
      .mode =
      info.mode;
}


void WsProtocol::handleCurrentTelemetry(
    const CommandCenterCurrentTelemetry& info) {
  for (
      uint8_t index = 0;
      index < MAX_DCC_TRACKS;
      ++index
  ) {
    _dccTracks[index].currentMa =
        -1;

    _dccTracks[index].overload =
        false;
  }

  const size_t count =
      min(
          info.count,
          static_cast<size_t>(
              MAX_DCC_TRACKS));

  for (
      size_t index = 0;
      index < count;
      ++index
  ) {
    _dccTracks[index].overload =
        info.values[index] <
        0;

    _dccTracks[index].currentMa =
        info.values[index] <
                0
            ? 0
            : info.values[index];

    if (
        !_dccTracks[index]
             .configured
    ) {
      _dccTracks[index].configured =
          true;

      _dccTracks[index].mode =
          "TRACK";
    }
  }

  _dccCurrentUpdatedAt =
      millis();
}


void WsProtocol::handleTripTelemetry(
    const CommandCenterTripTelemetry& info) {
  for (
      uint8_t index = 0;
      index < MAX_DCC_TRACKS;
      ++index
  ) {
    _dccTracks[index].tripMa =
        -1;
  }

  const size_t count =
      min(
          info.count,
          static_cast<size_t>(
              MAX_DCC_TRACKS));

  for (
      size_t index = 0;
      index < count;
      ++index
  ) {
    _dccTracks[index].tripMa =
        info.values[index] <
                0
            ? 0
            : info.values[index];

    if (
        !_dccTracks[index]
             .configured
    ) {
      _dccTracks[index].configured =
          true;

      _dccTracks[index].mode =
          "TRACK";
    }
  }
}


void WsProtocol::handlePowerFeedback(
    const CommandCenterPowerFeedback& info) {
  const bool wasMainOn =
      _trackPower;

  const bool wasProgOn =
      _programmingPower;

  switch (
      info.target
  ) {
    case CommandCenterPowerTarget::All:
      _trackPower =
          info.on;

      _programmingPower =
          info.on;

      for (
          uint8_t index = 0;
          index < MAX_DCC_TRACKS;
          ++index
      ) {
        if (
            !_dccTracks[index]
                 .configured
        ) {
          continue;
        }

        _dccTracks[index].powerKnown =
            true;

        _dccTracks[index].powerOn =
            info.on;
      }

      break;

    case CommandCenterPowerTarget::Main:
      _trackPower =
          info.on;

      break;

    case CommandCenterPowerTarget::Programming:
      _programmingPower =
          info.on;

      break;

    case CommandCenterPowerTarget::Joined:
      _trackPower =
          info.on;

      _programmingPower =
          info.on;

      break;

    case CommandCenterPowerTarget::Track:
      if (
          info.trackIndex >=
          MAX_DCC_TRACKS
      ) {
        return;
      }

      _dccTracks[
          info.trackIndex]
          .powerKnown =
          true;

      _dccTracks[
          info.trackIndex]
          .powerOn =
          info.on;

      recomputePowerStateFromTrackTelemetry();

      break;
  }

  _emergencyStop =
      false;

  if (
      wasMainOn &&
      !_trackPower
  ) {
    _stateStore.save();
  }

  if (
      wasMainOn !=
          _trackPower ||
      wasProgOn !=
          _programmingPower
  ) {
    broadcastPowerInfo();
  }
}


void WsProtocol::handleLocoFeedback(
    const CommandCenterLocoFeedback& info) {
  if (
      info.address == 0 ||
      info.address > 10239 ||
      info.speed > 126
  ) {
    Logger::warn(
        "Ignoring malformed command-center loco feedback");

    return;
  }

  auto* loco =
      getLoco(
          info.address,
          true);

  if (!loco) {
    Logger::warn(
        "Cannot allocate loco state for DCC address " +
        String(
            info.address));

    return;
  }

  loco->forward =
      info.forward;

  loco->speed =
      info.speed;

  loco->functionsMask =
      info.functionsMask;

  if (
      _emergencyStop &&
      loco->speed > 0
  ) {
    _emergencyStop =
        false;

    broadcastPowerInfo();

    Logger::info(
        "ESTOP cleared by loco feedback");
  }

  broadcastLoco(
      *loco);

  Logger::info(
      "Loco feedback: " +
      String(
          loco->address) +
      " speed=" +
      String(
          loco->speed) +
      " direction=" +
      String(
          loco->forward
              ? "forward"
              : "reverse") +
      " functionsMask=" +
      String(
          loco->functionsMask));
}


void WsProtocol::handleEvent(
    AsyncWebSocket*,
    AsyncWebSocketClient* client,
    AwsEventType type,
    void* arg,
    uint8_t* data,
    size_t len) {
  if (
      type ==
      WS_EVT_CONNECT
  ) {
    if (
        _wsClientCount <
        255
    ) {
      ++_wsClientCount;
    }

    _nextDccCurrentPollAt =
        0;

    Logger::info(
        "WS client connected #" +
        String(
            client->id()));

    JsonDocument welcome;

    welcome["message"] =
        "DCCExpressHub";

    send(
        client,
        "ws:welcome",
        welcome.as<
            JsonVariantConst>());

    sendRuntimeSnapshot(
        client);

    return;
  }

  if (
      type ==
      WS_EVT_DISCONNECT
  ) {
    if (
        _wsClientCount >
        0
    ) {
      --_wsClientCount;
    }

    Logger::info(
        "WS client disconnected #" +
        String(
            client->id()));

    return;
  }

  if (
      type !=
      WS_EVT_DATA
  ) {
    return;
  }

  AwsFrameInfo* info =
      static_cast<
          AwsFrameInfo*>(
              arg);

  if (
      !info->final ||
      info->index != 0 ||
      info->len != len ||
      info->opcode !=
          WS_TEXT
  ) {
    Logger::warn(
        "Ignoring fragmented/non-text WS message");

    return;
  }

  String payload;

  payload.reserve(
      len +
      1);

  for (
      size_t index = 0;
      index < len;
      ++index
  ) {
    payload +=
        static_cast<char>(
            data[index]);
  }

  handleMessage(
      client,
      payload);
}


void WsProtocol::handleMessage(
    AsyncWebSocketClient* client,
    const String& payload) {
  JsonDocument message;

  const DeserializationError error =
      deserializeJson(
          message,
          payload);

  if (error) {
    JsonDocument data;

    data["message"] =
        error.c_str();

    send(
        client,
        "error",
        data.as<
            JsonVariantConst>());

    return;
  }

  const char* type =
      message["type"] |
      "";

  JsonObjectConst data =
      message["data"];

  if (
      strcmp(
          type,
          "heartbeat") ==
      0
  ) {
    JsonDocument empty;

    send(
        client,
        "heartbeatAck",
        empty.as<
            JsonVariantConst>());

    sendCommandCenterInfo(
        client);

    sendPowerInfo(
        client);

    return;
  }

  if (
      strcmp(
          type,
          "setTrackPower") ==
      0
  ) {
    const bool on =
        data["on"] |
        false;

    _commandCenter
        .setTrackPower(
            on,
            _powerIncludesProgramming);

    return;
  }

  if (
      strcmp(
          type,
          "setProgrammingPower") ==
      0
  ) {
    const bool on =
        data["on"] |
        false;

    _commandCenter
        .setProgrammingPower(
            on);

    return;
  }

  if (
      strcmp(
          type,
          "emergencyStop") ==
      0
  ) {
    if (
        _commandCenter
            .emergencyStop()
    ) {
      _emergencyStop =
          true;

      broadcastPowerInfo();
    }

    return;
  }

  if (
      strcmp(
          type,
          "writeDccExDirectCommand") ==
      0
  ) {
    const String command =
        data["command"] |
        "";

    const bool ok =
        _commandCenter
            .supportsRawCommand() &&
        _commandCenter
            .sendRawCommand(
                command);

    JsonDocument out;

    out["response"] =
        ok
            ? "sent"
            : "send failed";

    send(
        client,
        "dccExDirectCommandResponse",
        out.as<
            JsonVariantConst>());

    return;
  }

  if (
      strcmp(
          type,
          "setLoco") ==
      0
  ) {
    const uint16_t address =
        data["locoAddress"] |
        0;

    const uint8_t speed =
        min(
            126,
            max(
                0,
                data["speed"]
                    .as<
                        int>()));

    const bool forward =
        strcmp(
            data["direction"] |
                "forward",
            "reverse") != 0;

    auto* loco =
        getLoco(
            address,
            true);

    if (!loco) {
      return;
    }

    if (
        !_commandCenter
             .setLoco(
                 address,
                 speed,
                 forward)
    ) {
      return;
    }

    loco->speed =
        speed;

    loco->forward =
        forward;

    broadcastLoco(
        *loco);

    return;
  }

  if (
      strcmp(
          type,
          "getLoco") ==
      0
  ) {
    const uint16_t address =
        data["locoAddress"] |
        0;

    requestLocoState(
        address,
        false);

    return;
  }

  if (
      strcmp(
          type,
          "setLocoFunction") ==
      0
  ) {
    const uint16_t address =
        data["locoAddress"] |
        0;

    const uint8_t fn =
        data["functionNumber"] |
        0;

    const bool active =
        data["active"] |
        false;

    if (
        fn >
        MAX_LOCO_FUNCTION
    ) {
      Logger::warn(
          "Ignoring unsupported loco function F" +
          String(
              fn));

      return;
    }

    auto* loco =
        getLoco(
            address,
            true);

    if (!loco) {
      return;
    }

    if (
        !_commandCenter
             .setLocoFunction(
                 address,
                 fn,
                 active)
    ) {
      return;
    }

    const uint32_t bit =
        1UL <<
        fn;

    if (active) {
      loco->functionsMask |=
          bit;
    } else {
      loco->functionsMask &=
          ~bit;
    }

    broadcastLoco(
        *loco);

    return;
  }

  if (
      strcmp(
          type,
          "setTurnout") ==
      0
  ) {
    const uint16_t address =
        data["address"] |
        0;

    const bool physicalValue =
        data["closed"] |
        false;

    _runtime.setTurnout(
        address,
        physicalValue);

    _commandCenter.setTurnout(
        address,
        physicalValue);

    JsonDocument out;

    out["address"] =
        address;

    out["closed"] =
        physicalValue;

    broadcast(
        "turnoutChanged",
        out);

    return;
  }

  if (
      strcmp(
          type,
          "setSignalAspect") ==
      0
  ) {
    const uint16_t address =
        data["address"] |
        0;

    const int aspect =
        data["aspect"] |
        0;

    _runtime.setSignal(
        address,
        aspect);

    _commandCenter
        .setSignalAspect(
            address,
            aspect);

    JsonDocument out;

    out["address"] =
        address;

    out["aspect"] =
        aspect;

    broadcast(
        "signalAspectChanged",
        out);

    if (
        !data[
             "turnoutPhysicalValue"]
             .isNull()
    ) {
      const bool physicalValue =
          data[
              "turnoutPhysicalValue"]
              .as<
                  bool>();

      _runtime.setTurnout(
          address,
          physicalValue);

      JsonDocument turnout;

      turnout["address"] =
          address;

      turnout["closed"] =
          physicalValue;

      broadcast(
          "turnoutChanged",
          turnout);
    }

    return;
  }

  if (
      strcmp(
          type,
          "setBasicAccessory") ==
      0
  ) {
    const uint16_t address =
        data["address"] |
        0;

    const bool active =
        data["active"] |
        false;

    _runtime.setAccessory(
        address,
        active);

    _commandCenter.setAccessory(
        address,
        active);

    JsonDocument out;

    out["address"] =
        address;

    out["active"] =
        active;

    broadcast(
        "accessoryChanged",
        out);

    return;
  }

  if (
      strcmp(
          type,
          "setVpin") ==
      0
  ) {
    const uint16_t vpin =
        data["vpin"] |
        0;

    const bool active =
        data["active"] |
        false;

    _runtime.setVPin(
        vpin,
        active);

    _commandCenter.setVPin(
        vpin,
        active);

    JsonDocument out;

    out["vpin"] =
        vpin;

    out["active"] =
        active;

    broadcast(
        "vpinChanged",
        out);

    return;
  }

  if (
      strcmp(
          type,
          "setSensor") ==
      0
  ) {
    const uint16_t address =
        data["address"] |
        0;

    const bool on =
        data["on"] |
        false;

    _runtime.setSensor(
        address,
        on);

    JsonDocument out;

    out["address"] =
        address;

    out["on"] =
        on;

    broadcast(
        "sensorChanged",
        out);

    return;
  }

  if (
      strcmp(
          type,
          "setBlock") ==
      0
  ) {
    const uint16_t blockId =
        parseBlockId(
            data["blockId"]);

    const String locoId =
        data["locoId"]
            .isNull()
            ? String()
            : String(
                  data["locoId"]
                      .as<
                          const char*>());

    const long addressValue =
        data["locoAddress"] |
        0L;

    const uint16_t locoAddress =
        addressValue > 0 &&
        addressValue <= 10239
            ? static_cast<uint16_t>(
                  addressValue)
            : 0;

    if (
        !blockId ||
        (
            locoId.isEmpty() &&
            locoAddress == 0
        ) ||
        !_runtime.setBlock(
            blockId,
            locoId,
            locoAddress)
    ) {
      JsonDocument out;

      out["message"] =
          "invalid_block_assignment";

      send(
          client,
          "error",
          out.as<
              JsonVariantConst>());
    }

    return;
  }

  if (
      strcmp(
          type,
          "setBlockRemove") ==
      0
  ) {
    const uint16_t blockId =
        parseBlockId(
            data["blockId"]);

    const String locoId =
        data["locoId"]
            .isNull()
            ? String()
            : String(
                  data["locoId"]
                      .as<
                          const char*>());

    if (
        !blockId ||
        !_runtime.removeBlock(
            blockId,
            locoId)
    ) {
      JsonDocument out;

      out["message"] =
          "invalid_block_remove";

      send(
          client,
          "error",
          out.as<
              JsonVariantConst>());
    }

    return;
  }

  if (
      strcmp(
          type,
          "setBlocksReset") ==
      0
  ) {
    _runtime.clearBlocks();
    return;
  }

  if (
      strcmp(
          type,
          "getBlocks") ==
      0
  ) {
    sendBlockStateSnapshot(
        client);

    return;
  }

  if (
      strcmp(
          type,
          "getLayoutRuntimeSnapshot") ==
      0
  ) {
    sendRuntimeSnapshot(
        client);

    return;
  }

  JsonDocument ack;

  ack["ok"] =
      true;

  ack["message"] =
      String(
          "Not implemented yet: ") +
      type;

  send(
      client,
      "ack",
      ack.as<
          JsonVariantConst>());
}
