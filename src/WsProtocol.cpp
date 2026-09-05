#include "WsProtocol.h"
#include "Logger.h"
#include "config.h"

#include <WiFi.h>
#include <LittleFS.h>
#include <esp_freertos_hooks.h>
#include <esp_system.h>
#include <stdlib.h>

namespace {
volatile uint32_t cpuIdleCounters[2] = {0, 0};
uint32_t cpuIdleBaseline[2] = {1, 1};
uint32_t cpuIdlePrevious[2] = {0, 0};
uint8_t cpuUsagePercent[2] = {0, 0};
unsigned long lastCpuSampleAtMs = 0;
esp_reset_reason_t bootResetReason = ESP_RST_UNKNOWN;

bool cpuIdleHook0() {
  ++cpuIdleCounters[0];
  return false;
}

bool cpuIdleHook1() {
  ++cpuIdleCounters[1];
  return false;
}

void updateCpuUsage() {
  const unsigned long now = millis();

  if (now - lastCpuSampleAtMs < 1000) {
    return;
  }

  lastCpuSampleAtMs = now;

  for (uint8_t core = 0; core < 2; ++core) {
    const uint32_t current = cpuIdleCounters[core];
    const uint32_t idleDelta = current - cpuIdlePrevious[core];
    cpuIdlePrevious[core] = current;

    if (idleDelta > cpuIdleBaseline[core]) {
      cpuIdleBaseline[core] = idleDelta;
    }

    const uint32_t baseline =
        cpuIdleBaseline[core] > 0
            ? cpuIdleBaseline[core]
            : 1;

    const uint32_t measuredIdlePercent =
        (idleDelta * 100ULL) / baseline;

    const uint32_t idlePercent =
        measuredIdlePercent > 100
            ? 100
            : measuredIdlePercent;

    cpuUsagePercent[core] =
        static_cast<uint8_t>(100 - idlePercent);
  }
}

const char* resetReasonName(esp_reset_reason_t reason) {
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

size_t parseIntegerList(
    const String& text,
    int32_t* values,
    size_t maxValues) {
  if (!values || maxValues == 0) {
    return 0;
  }

  const char* cursor = text.c_str();
  size_t count = 0;

  while (*cursor && count < maxValues) {
    while (*cursor &&
           (*cursor == ' ' ||
            *cursor == '\t' ||
            *cursor == ',')) {
      ++cursor;
    }

    if (!*cursor) {
      break;
    }

    char* end = nullptr;
    const long value = strtol(cursor, &end, 10);

    if (end == cursor) {
      while (*cursor &&
             *cursor != ' ' &&
             *cursor != '\t' &&
             *cursor != ',') {
        ++cursor;
      }
      continue;
    }

    values[count++] =
        static_cast<int32_t>(value);

    cursor = end;
  }

  return count;
}

String cleanDccVersion(String value) {
  value.trim();

  if (value.startsWith("DCC-EX")) {
    value.remove(0, 6);
  } else if (value.startsWith("DCCEX")) {
    value.remove(0, 5);
  }

  value.trim();

  if (value.startsWith("V-")) {
    value.remove(0, 2);
  } else if (value.startsWith("V")) {
    value.remove(0, 1);
  }

  value.trim();
  return value;
}
}

WsProtocol::WsProtocol(
    AsyncWebSocket& ws,
    DccExBridge& dcc,
    LayoutRuntime& runtime,
    RuntimeStateStore& stateStore)
    : _ws(ws), _dcc(dcc), _runtime(runtime), _stateStore(stateStore) {}

void WsProtocol::begin() {
  _ws.onEvent([this](
      AsyncWebSocket* server,
      AsyncWebSocketClient* client,
      AwsEventType type,
      void* arg,
      uint8_t* data,
      size_t len) {
    handleEvent(server, client, type, arg, data, len);
  });

  _dcc.onFrame([this](const String& frame) {
    handleDccFrame(frame);
  });

  bootResetReason = esp_reset_reason();

  esp_register_freertos_idle_hook_for_cpu(
      cpuIdleHook0,
      0);

  esp_register_freertos_idle_hook_for_cpu(
      cpuIdleHook1,
      1);

  // Short calibration sample, same approach as DCCExpressLite.
  delay(250);

  for (uint8_t core = 0; core < 2; ++core) {
    cpuIdleBaseline[core] =
        cpuIdleCounters[core]
            ? cpuIdleCounters[core] * 4
            : 1;

    cpuIdlePrevious[core] =
        cpuIdleCounters[core];
  }

  lastCpuSampleAtMs = millis();
  _lastDccConnected = _dcc.connected();

  if (_lastDccConnected) {
    _dccConnectedSinceAt = millis();
  }
}

void WsProtocol::loop() {
  const unsigned long now = millis();

  updateCpuUsage();
  handleDccConnectionState(now);
  pollLocoStateSync(now);
  pollDccExTelemetry(now);

  if (_nextHubStatusAt == 0 ||
      static_cast<long>(now - _nextHubStatusAt) >= 0) {
    if (_wsClientCount > 0) {
      broadcastDccExStatus();
    }

    _nextHubStatusAt =
        now + HUB_STATUS_INTERVAL_MS;
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
  out["type"] = type;
  out["data"].set(data);

  String body;
  serializeJson(out, body);
  client->text(body);
}

void WsProtocol::broadcast(const char* type, JsonDocument& data) {
  JsonDocument out;
  out["type"] = type;
  out["data"].set(data.as<JsonVariantConst>());

  String body;
  serializeJson(out, body);
  _ws.textAll(body);
}

void WsProtocol::sendCommandCenterInfo(AsyncWebSocketClient* client) {
  JsonDocument data;
  data["alive"] = _dcc.connected();
  data["power"] = _trackPower;
  data["type"] = "dcc-ex-tcp";
  data["name"] = "DCC-EX CommandStation";
  data["ip"] = _dcc.host();
  data["port"] = _dcc.port();
  data["connectionString"] = _dcc.host() + ":" + String(_dcc.port());

  send(client, "commandCenterInfo", data.as<JsonVariantConst>());
}

void WsProtocol::sendPowerInfo(AsyncWebSocketClient* client) {
  JsonDocument data;
  data["emergencyStop"] = _emergencyStop;
  data["trackVoltageOn"] = _trackPower;
  data["trackVoltageOff"] = !_trackPower;
  data["shortCircuit"] = false;
  data["programmingModeActive"] = _programmingPower;

  send(client, "powerInfo", data.as<JsonVariantConst>());
}

void WsProtocol::broadcastPowerInfo() {
  JsonDocument data;
  data["emergencyStop"] = _emergencyStop;
  data["trackVoltageOn"] = _trackPower;
  data["trackVoltageOff"] = !_trackPower;
  data["shortCircuit"] = false;
  data["programmingModeActive"] = _programmingPower;

  broadcast("powerInfo", data);
}

void WsProtocol::recomputePowerStateFromTrackTelemetry() {
  bool mainSeen = false;
  bool mainKnown = true;
  bool mainOn = true;

  bool progSeen = false;
  bool progKnown = true;
  bool progOn = true;

  for (uint8_t index = 0;
       index < MAX_DCC_TRACKS;
       ++index) {
    const DccTrackState& track =
        _dccTracks[index];

    if (!track.configured) {
      continue;
    }

    if (track.mode.startsWith("MAIN")) {
      mainSeen = true;

      if (!track.powerKnown) {
        mainKnown = false;
      } else if (!track.powerOn) {
        mainOn = false;
      }
    }

    if (track.mode.startsWith("PROG")) {
      progSeen = true;

      if (!track.powerKnown) {
        progKnown = false;
      } else if (!track.powerOn) {
        progOn = false;
      }
    }
  }

  if (mainSeen && mainKnown) {
    _trackPower = mainOn;
  }

  if (progSeen && progKnown) {
    _programmingPower = progOn;
  }
}

void WsProtocol::appendHubStatus(JsonObject hub) {
  hub["uptimeMs"] = millis();
  hub["chipModel"] = ESP.getChipModel();
  hub["chipRevision"] = ESP.getChipRevision();
  hub["cpuCores"] = 2;
  hub["cpuFrequencyMhz"] = ESP.getCpuFreqMHz();
  hub["cpuCore0Percent"] = cpuUsagePercent[0];
  hub["cpuCore1Percent"] = cpuUsagePercent[1];
  hub["chipTemperatureC"] = temperatureRead();

  hub["heapSizeBytes"] = ESP.getHeapSize();
  hub["freeHeapBytes"] = ESP.getFreeHeap();
  hub["minimumFreeHeapBytes"] = ESP.getMinFreeHeap();
  hub["largestFreeHeapBlockBytes"] = ESP.getMaxAllocHeap();

  hub["psramSizeBytes"] = ESP.getPsramSize();
  hub["freePsramBytes"] = ESP.getFreePsram();

  hub["hostname"] = DEVICE_HOSTNAME;
  hub["wifiIp"] = WiFi.localIP().toString();
  hub["wifiRssiDbm"] = WiFi.RSSI();
  hub["wifiSsid"] = WiFi.SSID();
  hub["wifiMac"] = WiFi.macAddress();
  hub["wifiChannel"] = WiFi.channel();

  hub["wsClients"] = _wsClientCount;
  hub["runtimeAccessories"] = _runtime.accessoryCount();
  hub["runtimeSensors"] = _runtime.sensorCount();

  hub["flashChipBytes"] = ESP.getFlashChipSize();
  hub["sketchBytes"] = ESP.getSketchSize();
  hub["freeSketchBytes"] = ESP.getFreeSketchSpace();
  hub["sdkVersion"] = ESP.getSdkVersion();
  hub["resetReason"] = resetReasonName(bootResetReason);
}

void WsProtocol::appendDccExStatus(JsonDocument& data) {
  const bool alive = _dcc.connected();

  int32_t mainCurrentMa = -1;
  int32_t progCurrentMa = -1;

  for (uint8_t index = 0; index < MAX_DCC_TRACKS; ++index) {
    const DccTrackState& track = _dccTracks[index];

    if (!track.configured) {
      continue;
    }

    if (track.mode.startsWith("MAIN") &&
        mainCurrentMa < 0) {
      mainCurrentMa = track.currentMa;
    }

    if (track.mode.startsWith("PROG") &&
        progCurrentMa < 0) {
      progCurrentMa = track.currentMa;
    }
  }

  data["version"] = _dccVersion;
  data["processor"] = _dccProcessor;
  data["hardware"] = _dccHardware;
  data["build"] = _dccBuild;
  data["host"] = _dcc.host();
  data["port"] = _dcc.port();
  data["alive"] = alive;
  data["maxLocos"] = _dccMaxLocos;

  data["trackVoltageOn"] = _trackPower;
  data["voltageMeasured"] = false;
  data["trackVoltageV"] = nullptr;
  data["mainCurrentMa"] =
      mainCurrentMa >= 0 ? mainCurrentMa : 0;
  data["progCurrentMa"] =
      progCurrentMa >= 0 ? progCurrentMa : 0;
  data["currentUpdatedAtMs"] = _dccCurrentUpdatedAt;
  data["linkUptimeMs"] =
      alive && _dccConnectedSinceAt
          ? millis() - _dccConnectedSinceAt
          : 0;

  JsonArray tracks =
      data["tracks"].to<JsonArray>();

  for (uint8_t index = 0; index < MAX_DCC_TRACKS; ++index) {
    const DccTrackState& track = _dccTracks[index];

    if (!track.configured) {
      continue;
    }

    JsonObject out =
        tracks.add<JsonObject>();

    char letter[2] = {
        static_cast<char>('A' + index),
        '\0'};

    out["letter"] = letter;
    out["mode"] = track.mode;

    if (track.currentMa >= 0) {
      out["currentMa"] = track.currentMa;
    } else {
      out["currentMa"] = nullptr;
    }

    out["overload"] = track.overload;

    if (track.tripMa >= 0) {
      out["tripMa"] = track.tripMa;
    } else {
      out["tripMa"] = nullptr;
    }
  }

  JsonObject hub =
      data["hub"].to<JsonObject>();

  appendHubStatus(hub);

  // Backward compatibility for the old Lite-derived Info panel and any
  // other clients that still consume these top-level ESP32 fields.
  data["uptimeMs"] = millis();
  data["freeHeapBytes"] = ESP.getFreeHeap();
  data["cpuCores"] = 2;
  data["cpuFrequencyMhz"] = ESP.getCpuFreqMHz();
  data["cpuCore0Percent"] = cpuUsagePercent[0];
  data["cpuCore1Percent"] = cpuUsagePercent[1];
  data["chipTemperatureC"] = temperatureRead();
  data["wsClients"] = _wsClientCount;
  data["minimumFreeHeapBytes"] = ESP.getMinFreeHeap();
  data["largestFreeHeapBlockBytes"] = ESP.getMaxAllocHeap();
  data["resetReason"] = resetReasonName(bootResetReason);
}

void WsProtocol::sendDccExStatus(
    AsyncWebSocketClient* client) {
  JsonDocument data;
  appendDccExStatus(data);

  send(
      client,
      "dccExStatus",
      data.as<JsonVariantConst>());
}

void WsProtocol::broadcastDccExStatus() {
  JsonDocument data;
  appendDccExStatus(data);
  broadcast("dccExStatus", data);
}

bool WsProtocol::requestLocoState(
    uint16_t address,
    bool logCommand) {
  if (address == 0 ||
      address > 10239 ||
      !_dcc.connected()) {
    return false;
  }

  return _dcc.sendCommand(
      "<t " +
          String(address) +
          ">",
      logCommand);
}

void WsProtocol::beginConfiguredLocoStateSync(
    unsigned long now) {
  _locoSyncCount = 0;
  _locoSyncIndex = 0;
  _nextLocoSyncAt = 0;

  static constexpr const char* LOCOS_PATH =
      "/config/locos.json";

  if (!LittleFS.exists(LOCOS_PATH)) {
    Logger::info(
        "Loco state sync: no saved locomotive list");
    return;
  }

  File file =
      LittleFS.open(
          LOCOS_PATH,
          "r");

  if (!file) {
    Logger::warn(
        "Loco state sync: cannot open locos.json");
    return;
  }

  // The sync only needs DCC addresses. ArduinoJson's filter keeps the
  // image/function/action metadata out of RAM even when locos.json grows.
  JsonDocument filter;
  filter[0]["address"] = true;

  JsonDocument document;
  const DeserializationError error =
      deserializeJson(
          document,
          file,
          DeserializationOption::Filter(filter));

  file.close();

  if (error ||
      !document.is<JsonArray>()) {
    Logger::warn(
        "Loco state sync: invalid locos.json");
    return;
  }

  for (JsonObjectConst item :
       document.as<JsonArrayConst>()) {
    const int addressValue =
        item["address"] | 0;

    if (addressValue <= 0 ||
        addressValue > 10239) {
      continue;
    }

    const uint16_t address =
        static_cast<uint16_t>(
            addressValue);

    bool duplicate = false;

    for (size_t index = 0;
         index < _locoSyncCount;
         ++index) {
      if (_locoSyncAddresses[index] ==
          address) {
        duplicate = true;
        break;
      }
    }

    if (duplicate) {
      continue;
    }

    if (_locoSyncCount >= MAX_LOCOS) {
      Logger::warn(
          "Loco state sync: locomotive limit reached");
      break;
    }

    _locoSyncAddresses[
        _locoSyncCount++] =
        address;
  }

  if (_locoSyncCount == 0) {
    Logger::info(
        "Loco state sync: no valid DCC addresses");
    return;
  }

  _nextLocoSyncAt = now;

  Logger::info(
      "Loco state sync queued: " +
      String(_locoSyncCount) +
      " locomotive(s)");
}

void WsProtocol::pollLocoStateSync(
    unsigned long now) {
  if (!_dcc.connected() ||
      _locoSyncIndex >= _locoSyncCount) {
    return;
  }

  if (_nextLocoSyncAt != 0 &&
      static_cast<long>(
          now - _nextLocoSyncAt) < 0) {
    return;
  }

  const uint16_t address =
      _locoSyncAddresses[
          _locoSyncIndex];

  if (!requestLocoState(
          address,
          false)) {
    _nextLocoSyncAt =
        now +
        LOCO_STATE_SYNC_INTERVAL_MS;
    return;
  }

  ++_locoSyncIndex;

  if (_locoSyncIndex >=
      _locoSyncCount) {
    _nextLocoSyncAt = 0;

    Logger::info(
        "Loco state sync requests completed");
    return;
  }

  _nextLocoSyncAt =
      now +
      LOCO_STATE_SYNC_INTERVAL_MS;
}

void WsProtocol::handleDccConnectionState(
    unsigned long now) {
  const bool connected = _dcc.connected();

  if (connected == _lastDccConnected) {
    return;
  }

  _lastDccConnected = connected;

  if (!connected) {
    _dccConnectedSinceAt = 0;
    _nextDccCurrentPollAt = 0;

    _locoSyncCount = 0;
    _locoSyncIndex = 0;
    _nextLocoSyncAt = 0;

    for (uint8_t index = 0; index < MAX_DCC_TRACKS; ++index) {
      _dccTracks[index].configured = false;
      _dccTracks[index].mode = "";
      _dccTracks[index].powerKnown = false;
      _dccTracks[index].powerOn = false;
      _dccTracks[index].currentMa = -1;
      _dccTracks[index].tripMa = -1;
      _dccTracks[index].overload = false;
    }

    return;
  }

  _dccConnectedSinceAt = now;
  _nextDccCurrentPollAt = 0;

  // Static/slow station information. TX logging is intentionally disabled
  // for background telemetry commands.
  // DccExBridge already sends <s> immediately after each TCP connect.
  // Query the slower TrackManager metadata once the heartbeat proves
  // that the remote command station is alive.
  _dcc.sendCommand("<=>", false);
  _dcc.sendCommand("<JG>", false);

  // DCC-EX <t cab> requests the current speed/direction/function map without
  // modifying the locomotive. <l ...> remains the one authoritative state path.
  beginConfiguredLocoStateSync(now);
}

void WsProtocol::pollDccExTelemetry(
    unsigned long now) {
  if (!_dcc.connected() ||
      _wsClientCount == 0) {
    return;
  }

  if (_nextDccCurrentPollAt == 0 ||
      static_cast<long>(now - _nextDccCurrentPollAt) >= 0) {
    _dcc.sendCommand("<JI>", false);

    _nextDccCurrentPollAt =
        now + DCC_CURRENT_POLL_MS;
  }

}

void WsProtocol::sendRuntimeSnapshot(AsyncWebSocketClient* client) {
  sendCommandCenterInfo(client);
  sendPowerInfo(client);
  sendDccExStatus(client);

  for (const auto& item : _runtime.accessories()) {
    JsonDocument data;

    switch (item.kind) {
      case RuntimeAccessoryKind::Turnout:
        data["address"] = item.address;
        data["closed"] = item.closed;
        send(client, "turnoutChanged", data.as<JsonVariantConst>());
        break;

      case RuntimeAccessoryKind::Signal:
        if (item.aspect >= 0) {
          data["address"] = item.address;
          data["aspect"] = item.aspect;
          send(client, "signalAspectChanged", data.as<JsonVariantConst>());
        }
        break;

      case RuntimeAccessoryKind::Accessory:
        data["address"] = item.address;
        data["active"] = item.active;
        send(client, "accessoryChanged", data.as<JsonVariantConst>());
        break;

      case RuntimeAccessoryKind::VPin:
        data["vpin"] = item.address;
        data["active"] = item.active;
        send(client, "vpinChanged", data.as<JsonVariantConst>());
        break;
    }
  }

  for (const auto& sensor : _runtime.sensors()) {
    JsonDocument data;
    data["address"] = sensor.address;
    data["on"] = sensor.on;
    send(client, "sensorChanged", data.as<JsonVariantConst>());
  }
}

void WsProtocol::broadcastRuntimeSnapshot() {
  JsonDocument cc;
  cc["alive"] = _dcc.connected();
  cc["power"] = _trackPower;
  cc["type"] = "dcc-ex-tcp";
  cc["name"] = "DCC-EX CommandStation";
  cc["ip"] = _dcc.host();
  cc["port"] = _dcc.port();

  broadcast("commandCenterInfo", cc);
  broadcastPowerInfo();
  broadcastDccExStatus();

  for (const auto& item : _runtime.accessories()) {
    JsonDocument data;

    switch (item.kind) {
      case RuntimeAccessoryKind::Turnout:
        data["address"] = item.address;
        data["closed"] = item.closed;
        broadcast("turnoutChanged", data);
        break;

      case RuntimeAccessoryKind::Signal:
        if (item.aspect >= 0) {
          data["address"] = item.address;
          data["aspect"] = item.aspect;
          broadcast("signalAspectChanged", data);
        }
        break;

      case RuntimeAccessoryKind::Accessory:
        data["address"] = item.address;
        data["active"] = item.active;
        broadcast("accessoryChanged", data);
        break;

      case RuntimeAccessoryKind::VPin:
        data["vpin"] = item.address;
        data["active"] = item.active;
        broadcast("vpinChanged", data);
        break;
    }
  }

  for (const auto& sensor : _runtime.sensors()) {
    JsonDocument data;
    data["address"] = sensor.address;
    data["on"] = sensor.on;
    broadcast("sensorChanged", data);
  }
}

void WsProtocol::broadcastRawInfo(const String& raw) {
  JsonDocument data;
  data["raw"] = raw;
  broadcast("rawInfo", data);
}

WsProtocol::LocoState* WsProtocol::getLoco(uint16_t address, bool create) {
  for (size_t i = 0; i < _locoCount; ++i) {
    if (_locos[i].address == address) {
      return &_locos[i];
    }
  }

  if (!create || _locoCount >= MAX_LOCOS) {
    return nullptr;
  }

  auto& loco = _locos[_locoCount++];
  loco.address = address;
  loco.speed = 0;
  loco.forward = true;
  loco.functionsMask = 0;

  return &loco;
}

void WsProtocol::broadcastLoco(const LocoState& loco) {
  JsonDocument data;
  JsonObject out = data["loco"].to<JsonObject>();

  out["address"] = loco.address;
  out["speed"] = loco.speed;
  out["direction"] = loco.forward ? "forward" : "reverse";

  // One compact 32-bit value. F0 is bit 0, F28 is bit 28.
  out["functionsMask"] = loco.functionsMask;

  broadcast("locoState", data);
}

void WsProtocol::handleDccFrame(const String& frame) {
  // Keep high-rate telemetry out of the operator log/console. Heartbeat
  // remains visible because the existing DCC-EX status indicator uses it.
  if (!frame.startsWith("<jI") &&
      !frame.startsWith("<jG")) {
    broadcastRawInfo(frame);
  }

  if (frame.startsWith("<#")) {
    unsigned int maxLocos = 0;

    if (sscanf(
            frame.c_str(),
            "<# %u>",
            &maxLocos) == 1 &&
        maxLocos <= 65535) {
      _dccMaxLocos =
          static_cast<uint16_t>(maxLocos);
    }
  }

  if (frame.startsWith("<i")) {
    String body =
        frame.substring(2, frame.length() - 1);

    String fields[4];
    uint8_t fieldCount = 0;
    int start = 0;

    while (fieldCount < 4) {
      const int slash = body.indexOf('/', start);

      if (slash < 0) {
        fields[fieldCount++] = body.substring(start);
        break;
      }

      fields[fieldCount++] =
          body.substring(start, slash);
      start = slash + 1;
    }

    for (uint8_t index = 0; index < fieldCount; ++index) {
      fields[index].trim();
    }

    if (fieldCount > 0) {
      _dccVersion = cleanDccVersion(fields[0]);
    }

    if (fieldCount > 1) {
      _dccProcessor = fields[1];
    }

    if (fieldCount > 2) {
      _dccHardware = fields[2];

      // Current DCC-EX builds commonly format the last section as
      // "MOTOR_DRIVER G-gitsha" instead of using a fourth slash field.
      const int buildAt =
          _dccHardware.lastIndexOf(" G-");

      if (buildAt >= 0) {
        _dccBuild =
            _dccHardware.substring(buildAt + 1);
        _dccHardware =
            _dccHardware.substring(0, buildAt);
        _dccHardware.trim();
        _dccBuild.trim();
      }
    }

    if (fieldCount > 3) {
      _dccBuild = fields[3];
    }
  }

  if (frame.startsWith("<= ") &&
      frame.length() >= 6) {
    const char letter = frame.charAt(3);

    if (letter >= 'A' && letter <= 'H') {
      const uint8_t index =
          static_cast<uint8_t>(letter - 'A');

      String mode =
          frame.substring(5, frame.length() - 1);
      mode.trim();

      _dccTracks[index].configured = true;
      _dccTracks[index].mode = mode;
    }
  }

  if (frame.startsWith("<jI")) {
    const String body =
        frame.substring(3, frame.length() - 1);

    int32_t values[MAX_DCC_TRACKS] = {};
    const size_t count =
        parseIntegerList(
            body,
            values,
            MAX_DCC_TRACKS);

    for (uint8_t index = 0; index < MAX_DCC_TRACKS; ++index) {
      _dccTracks[index].currentMa = -1;
      _dccTracks[index].overload = false;
    }

    for (size_t index = 0; index < count; ++index) {
      _dccTracks[index].overload =
          values[index] < 0;

      _dccTracks[index].currentMa =
          values[index] < 0 ? 0 : values[index];

      // If an older station does not answer <=> but does answer <JI>,
      // still expose the current channel instead of hiding it.
      if (!_dccTracks[index].configured) {
        _dccTracks[index].configured = true;
        _dccTracks[index].mode = "TRACK";
      }
    }

    _dccCurrentUpdatedAt = millis();
  }

  if (frame.startsWith("<jG")) {
    const String body =
        frame.substring(3, frame.length() - 1);

    int32_t values[MAX_DCC_TRACKS] = {};
    const size_t count =
        parseIntegerList(
            body,
            values,
            MAX_DCC_TRACKS);

    for (uint8_t index = 0; index < MAX_DCC_TRACKS; ++index) {
      _dccTracks[index].tripMa = -1;
    }

    for (size_t index = 0; index < count; ++index) {
      _dccTracks[index].tripMa =
          values[index] < 0 ? 0 : values[index];

      if (!_dccTracks[index].configured) {
        _dccTracks[index].configured = true;
        _dccTracks[index].mode = "TRACK";
      }
    }
  }

  if (frame.startsWith("<p0") ||
      frame.startsWith("<p1")) {
    const bool on =
        frame.charAt(2) == '1';

    String target =
        frame.substring(
            3,
            frame.length() - 1);

    target.trim();

    const bool wasMainOn =
        _trackPower;

    const bool wasProgOn =
        _programmingPower;

    bool handled = false;

    if (target.length() == 0) {
      _trackPower = on;
      _programmingPower = on;

      for (uint8_t index = 0;
           index < MAX_DCC_TRACKS;
           ++index) {
        if (!_dccTracks[index].configured) {
          continue;
        }

        _dccTracks[index].powerKnown = true;
        _dccTracks[index].powerOn = on;
      }

      handled = true;
    } else if (target == "MAIN") {
      _trackPower = on;
      handled = true;
    } else if (target == "PROG") {
      _programmingPower = on;
      handled = true;
    } else if (target == "JOIN") {
      _trackPower = on;
      _programmingPower = on;
      handled = true;
    } else if (target.length() == 1) {
      const char letter =
          target.charAt(0);

      if (letter >= 'A' &&
          letter <= 'H') {
        const uint8_t index =
            static_cast<uint8_t>(
                letter - 'A');

        _dccTracks[index].powerKnown = true;
        _dccTracks[index].powerOn = on;

        recomputePowerStateFromTrackTelemetry();
        handled = true;
      }
    }

    if (handled) {
      _emergencyStop = false;

      // Runtime persistence is tied to an authoritative MAIN
      // ON -> OFF transition, never merely to a requested command.
      if (wasMainOn &&
          !_trackPower) {
        _stateStore.save();
      }

      if (wasMainOn != _trackPower ||
          wasProgOn != _programmingPower) {
        broadcastPowerInfo();
      }

      return;
    }
  }

  // DCC-EX authoritative loco feedback:
  //   <l loco reg speedByte functMap>
  //
  // speedByte:
  //   reverse: 0=stop, 1=ESTOP, 2..127=speed 1..126
  //   forward: 128=stop, 129=ESTOP, 130..255=speed 1..126
  //
  // DCC-EX broadcasts these frames after throttle/function changes,
  // including one for each loco in the reminder list after <!>.
  if (frame.startsWith("<l ")) {
    unsigned int addressValue = 0;
    int registerValue = 0;
    unsigned int speedByteValue = 0;
    unsigned long functionMapValue = 0;

    const int parsed = sscanf(
        frame.c_str(),
        "<l %u %d %u %lu>",
        &addressValue,
        &registerValue,
        &speedByteValue,
        &functionMapValue);

    (void)registerValue;

    if (parsed != 4 ||
        addressValue == 0 ||
        addressValue > 10239 ||
        speedByteValue > 255) {
      Logger::warn(
          "Ignoring malformed DCC-EX loco feedback: " +
          frame);
      return;
    }

    auto* loco = getLoco(
        static_cast<uint16_t>(addressValue),
        true);

    if (!loco) {
      Logger::warn(
          "Cannot allocate loco state for DCC address " +
          String(addressValue));
      return;
    }

    const uint8_t speedByte =
        static_cast<uint8_t>(speedByteValue);

    const uint8_t encodedSpeed =
        speedByte & 0x7f;

    loco->forward =
        (speedByte & 0x80) != 0;

    // Both normal STOP and ESTOP are displayed as speed 0 in the UI.
    // DCC-EX uses encodedSpeed=0 for STOP and =1 for ESTOP.
    loco->speed =
        encodedSpeed <= 1
            ? 0
            : static_cast<uint8_t>(
                  encodedSpeed - 1);

    loco->functionsMask =
        static_cast<uint32_t>(
            functionMapValue);

    // A non-zero authoritative loco speed means DCC-EX is no longer
    // in the global emergency-stop state. Do not clear ESTOP merely
    // because a command was requested; clear it only from feedback.
    if (_emergencyStop &&
        loco->speed > 0) {
      _emergencyStop = false;
      broadcastPowerInfo();

      Logger::info(
          "DCC-EX ESTOP cleared by loco feedback");
    }

    broadcastLoco(*loco);

    Logger::info(
        "Loco feedback: " +
        String(loco->address) +
        " speed=" +
        String(loco->speed) +
        " direction=" +
        String(loco->forward ? "forward" : "reverse") +
        " functionsMask=" +
        String(loco->functionsMask));

    return;
  }
}

void WsProtocol::handleEvent(
    AsyncWebSocket*,
    AsyncWebSocketClient* client,
    AwsEventType type,
    void* arg,
    uint8_t* data,
    size_t len) {
  if (type == WS_EVT_CONNECT) {
    if (_wsClientCount < 255) {
      ++_wsClientCount;
    }

    // First browser should get a fresh current sample immediately.
    _nextDccCurrentPollAt = 0;

    Logger::info("WS client connected #" + String(client->id()));

    JsonDocument welcome;
    welcome["message"] = "DCCExpressHub";
    send(client, "ws:welcome", welcome.as<JsonVariantConst>());
    sendRuntimeSnapshot(client);
    return;
  }

  if (type == WS_EVT_DISCONNECT) {
    if (_wsClientCount > 0) {
      --_wsClientCount;
    }

    Logger::info("WS client disconnected #" + String(client->id()));
    return;
  }

  if (type != WS_EVT_DATA) {
    return;
  }

  AwsFrameInfo* info = static_cast<AwsFrameInfo*>(arg);

  if (!info->final ||
      info->index != 0 ||
      info->len != len ||
      info->opcode != WS_TEXT) {
    Logger::warn("Ignoring fragmented/non-text WS message");
    return;
  }

  String payload;
  payload.reserve(len + 1);

  for (size_t i = 0; i < len; ++i) {
    payload += static_cast<char>(data[i]);
  }

  handleMessage(client, payload);
}

void WsProtocol::handleMessage(
    AsyncWebSocketClient* client,
    const String& payload) {
  JsonDocument message;
  DeserializationError error = deserializeJson(message, payload);

  if (error) {
    JsonDocument data;
    data["message"] = error.c_str();
    send(client, "error", data.as<JsonVariantConst>());
    return;
  }

  const char* type = message["type"] | "";
  JsonObjectConst data = message["data"];

  if (strcmp(type, "heartbeat") == 0) {
    JsonDocument empty;
    send(client, "heartbeatAck", empty.as<JsonVariantConst>());
    sendCommandCenterInfo(client);
    sendPowerInfo(client);
    return;
  }

  if (strcmp(type, "setTrackPower") == 0) {
    const bool on =
        data["on"] | false;

    const String command =
        _powerIncludesProgramming
            ? (on ? "<1>" : "<0>")
            : (on ? "<1 MAIN>" : "<0 MAIN>");

    // Command = request. MAIN / PROG state and runtime persistence
    // are updated only from the resulting authoritative <p...> feedback.
    _dcc.sendCommand(command);
    return;
  }

  if (strcmp(type, "setProgrammingPower") == 0) {
    const bool on =
        data["on"] | false;

    _dcc.sendCommand(
        on
            ? "<1 PROG>"
            : "<0 PROG>");

    return;
  }

  if (strcmp(type, "emergencyStop") == 0) {
    // Command = request. Loco state is updated from the resulting
    // authoritative <l ...> broadcasts sent by DCC-EX.
    if (_dcc.sendCommand("<!>")) {
      _emergencyStop = true;
      broadcastPowerInfo();
    }

    return;
  }

  if (strcmp(type, "writeDccExDirectCommand") == 0) {
    const String command = data["command"] | "";
    const bool ok = _dcc.sendCommand(command);

    JsonDocument out;
    out["response"] = ok ? "sent" : "send failed";
    send(client, "dccExDirectCommandResponse", out.as<JsonVariantConst>());
    return;
  }

  if (strcmp(type, "setLoco") == 0) {
    const uint16_t address = data["locoAddress"] | 0;
    const uint8_t speed =
        min(126, max(0, data["speed"].as<int>()));

    const bool forward =
        strcmp(data["direction"] | "forward", "reverse") != 0;

    auto* loco = getLoco(address, true);
    if (!loco) {
      return;
    }

    loco->speed = speed;
    loco->forward = forward;

    _dcc.sendCommand(
        "<t " +
        String(address) +
        " " +
        String(speed) +
        " " +
        String(forward ? 1 : 0) +
        ">");

    broadcastLoco(*loco);
    return;
  }

  if (strcmp(type, "getLoco") == 0) {
    const uint16_t address =
        data["locoAddress"] | 0;

    // Do not answer from the Hub cache. Query the command station and let
    // its authoritative <l ...> response update every connected client.
    requestLocoState(
        address,
        false);

    return;
  }

  if (strcmp(type, "setLocoFunction") == 0) {
    const uint16_t address = data["locoAddress"] | 0;
    const uint8_t fn = data["functionNumber"] | 0;
    const bool active = data["active"] | false;

    if (fn > MAX_LOCO_FUNCTION) {
      Logger::warn("Ignoring unsupported loco function F" + String(fn));
      return;
    }

    auto* loco = getLoco(address, true);
    if (!loco) {
      return;
    }

    const bool sent = _dcc.sendCommand(
        "<F " +
        String(address) +
        " " +
        String(fn) +
        " " +
        String(active ? 1 : 0) +
        ">");

    if (!sent) {
      return;
    }

    const uint32_t bit = (1UL << fn);

    if (active) {
      loco->functionsMask |= bit;
    } else {
      loco->functionsMask &= ~bit;
    }

    broadcastLoco(*loco);
    return;
  }

  if (strcmp(type, "setTurnout") == 0) {
    const uint16_t address = data["address"] | 0;
    const bool physicalValue = data["closed"] | false;

    _runtime.setTurnout(address, physicalValue);

    _dcc.sendCommand(
        "<a " +
        String(address) +
        " " +
        String(physicalValue ? 1 : 0) +
        ">");

    JsonDocument out;
    out["address"] = address;
    out["closed"] = physicalValue;
    broadcast("turnoutChanged", out);
    return;
  }

  if (strcmp(type, "setSignalAspect") == 0) {
    const uint16_t address = data["address"] | 0;
    const int aspect = data["aspect"] | 0;

    _runtime.setSignal(address, aspect);

    _dcc.sendCommand(
        "<A " +
        String(address) +
        " " +
        String(aspect) +
        ">");

    JsonDocument out;
    out["address"] = address;
    out["aspect"] = aspect;
    broadcast("signalAspectChanged", out);

    if (!data["turnoutPhysicalValue"].isNull()) {
      const bool physicalValue =
          data["turnoutPhysicalValue"].as<bool>();

      _runtime.setTurnout(address, physicalValue);

      JsonDocument turnout;
      turnout["address"] = address;
      turnout["closed"] = physicalValue;
      broadcast("turnoutChanged", turnout);
    }

    return;
  }

  if (strcmp(type, "setBasicAccessory") == 0) {
    const uint16_t address = data["address"] | 0;
    const bool active = data["active"] | false;

    _runtime.setAccessory(address, active);

    _dcc.sendCommand(
        "<a " +
        String(address) +
        " " +
        String(active ? 1 : 0) +
        ">");

    JsonDocument out;
    out["address"] = address;
    out["active"] = active;
    broadcast("accessoryChanged", out);
    return;
  }

  if (strcmp(type, "setVpin") == 0) {
    const uint16_t vpin = data["vpin"] | 0;
    const bool active = data["active"] | false;

    _runtime.setVPin(vpin, active);

    _dcc.sendCommand(
        "<z " +
        String(
            active
                ? vpin
                : -static_cast<int>(vpin)) +
        ">");

    JsonDocument out;
    out["vpin"] = vpin;
    out["active"] = active;
    broadcast("vpinChanged", out);
    return;
  }

  if (strcmp(type, "setSensor") == 0) {
    const uint16_t address = data["address"] | 0;
    const bool on = data["on"] | false;

    _runtime.setSensor(address, on);

    JsonDocument out;
    out["address"] = address;
    out["on"] = on;
    broadcast("sensorChanged", out);
    return;
  }

  if (strcmp(type, "getLayoutRuntimeSnapshot") == 0) {
    sendRuntimeSnapshot(client);
    return;
  }

  JsonDocument ack;
  ack["ok"] = true;
  ack["message"] = String("Not implemented yet: ") + type;
  send(client, "ack", ack.as<JsonVariantConst>());
}
