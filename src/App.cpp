#include "App.h"

#include <ArduinoJson.h>
#include <algorithm>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <WiFi.h>

#include "Logger.h"
#include "S88I2CConfig.h"

namespace {

bool parseIp(
    const String& text,
    IPAddress& out,
    bool allowEmpty = false) {
  if (text.isEmpty()) {
    return allowEmpty;
  }

  return out.fromString(text);
}

#if defined(HUB_DISPLAY_WAVESHARE_S3_LCD7) && HUB_DISPLAY_WAVESHARE_S3_LCD7

struct WaveshareWsGuardState {
  bool congested = false;
  size_t maxQueue = 0;
  size_t clientCount = 0;
};

WaveshareWsGuardState tuneWaveshareWebSocketClients(
    AsyncWebSocket& ws) {
  WaveshareWsGuardState state;

  for (auto& client : ws.getClients()) {
    ++state.clientCount;

    client.setCloseClientOnQueueFull(false);

    const size_t queued = client.queueLen();
    if (queued > state.maxQueue) {
      state.maxQueue = queued;
    }

    if (queued >= 6U) {
      state.congested = true;
    }
  }

  return state;
}

void syncWaveshareRuntimeMonitor(
    const S88I2CMaster& s88,
    const LayoutRuntime& runtime) {
  static RuntimeSensor sensorViews[
      S88I2CMaster::MAX_DATA_BYTES *
      S88I2CMaster::BITS_PER_BYTE];

  size_t sensorCount = 0;

  if (s88.adapterInfoKnown()) {
    sensorCount = std::min<size_t>(
        s88.sensorCount(),
        S88I2CMaster::MAX_DATA_BYTES *
            S88I2CMaster::BITS_PER_BYTE);

    for (size_t i = 0; i < sensorCount; ++i) {
      const uint16_t address =
          static_cast<uint16_t>(
              s88.baseSensorAddress() + i);
      const uint8_t group =
          static_cast<uint8_t>(i / 16U);
      const uint8_t bit =
          static_cast<uint8_t>(i % 16U);
      const uint16_t mask =
          static_cast<uint16_t>(1U << bit);

      sensorViews[i].id = address;
      sensorViews[i].address = address;
      sensorViews[i].on =
          (s88.activeBitsForSnapshotGroup(group) & mask) != 0U;
    }
  }

  const auto& blocks = runtime.blocks();

  WaveshareS3Lcd7Display::setRuntimeSnapshot(
      sensorCount > 0 ? sensorViews : nullptr,
      sensorCount,
      blocks.empty() ? nullptr : blocks.data(),
      blocks.size());
}

String runtimeEventText(
    LayoutRuntime& runtime,
    RuntimeChangeKind kind,
    uint16_t id,
    uint8_t channel) {
  switch (kind) {
    case RuntimeChangeKind::Turnout: {
      auto* item = runtime.findAccessoryById(
          RuntimeAccessoryKind::Turnout,
          id,
          channel);
      if (!item) {
        return String("Turnout ") + String(id) + " changed";
      }
      return String("Turnout ") +
          String(item->address) +
          " -> " +
          (item->closed ? "CLOSED" : "THROWN");
    }

    case RuntimeChangeKind::Signal: {
      auto* item = runtime.findAccessoryById(
          RuntimeAccessoryKind::Signal,
          id,
          channel);
      if (!item) {
        return String("Signal ") + String(id) + " changed";
      }
      return String("Signal ") +
          String(item->address) +
          " -> aspect " +
          String(item->aspect);
    }

    case RuntimeChangeKind::Accessory: {
      auto* item = runtime.findAccessoryById(
          RuntimeAccessoryKind::Accessory,
          id,
          channel);
      if (!item) {
        return String("Accessory ") + String(id) + " changed";
      }
      return String("Accessory ") +
          String(item->address) +
          " -> " +
          (item->active ? "ON" : "OFF");
    }

    case RuntimeChangeKind::VPin: {
      auto* item = runtime.findAccessoryById(
          RuntimeAccessoryKind::VPin,
          id,
          channel);
      if (!item) {
        return String("VPin ") + String(id) + " changed";
      }
      return String("VPin ") +
          String(item->address) +
          " -> " +
          (item->active ? "ON" : "OFF");
    }

    case RuntimeChangeKind::Block: {
      if (id == 0) {
        return "All block assignments cleared";
      }

      auto* block = runtime.findBlockById(id);
      if (!block) {
        return String("Block ") + String(id) + " changed";
      }

      if (block->targetOnly()) {
        return String("Block ") + String(id) + " -> RESERVED";
      }

      if (!block->occupied()) {
        return String("Block ") + String(id) + " -> FREE";
      }

      String result = String("Block ") + String(id) + " -> OCCUPIED";
      if (block->locoAddress > 0) {
        result += String(" | LOCO #") + String(block->locoAddress);
      } else if (!block->locoId.isEmpty()) {
        result += String(" | ") + block->locoId;
      }
      return result;
    }

    case RuntimeChangeKind::Sensor:
      // S88 sensor events are emitted directly by broadcastS88SensorChanged(),
      // including addresses that are not represented in layout.json.
      return String();
  }

  return String();
}

#endif

void sendWsJson(
    AsyncWebSocket& ws,
    JsonDocument& document) {
  String body;

  serializeJson(document, body);

#if defined(HUB_DISPLAY_WAVESHARE_S3_LCD7) && HUB_DISPLAY_WAVESHARE_S3_LCD7
  if (!ws.availableForWriteAll()) {
    return;
  }
#endif

  ws.textAll(body);
}

}  // namespace

void App::broadcastS88SensorChanged(
    uint16_t address,
    bool occupied) {
  _runtime.setSensor(address, occupied);

#if defined(HUB_DISPLAY_WAVESHARE_S3_LCD7) && HUB_DISPLAY_WAVESHARE_S3_LCD7
  // The adapter deliberately publishes every bit on its first snapshot. Do
  // not flood the HMI event history with 32..256 startup FREE/OCCUPIED rows;
  // the periodic snapshot sync below will populate the Sensors page instead.
  if (_s88I2c.snapshotKnown()) {
    WaveshareS3Lcd7Display::pushRuntimeEvent(
        String("S88 ") +
            String(address) +
            " -> " +
            (occupied ? "OCCUPIED" : "FREE"),
        millis());

    syncWaveshareRuntimeMonitor(
        _s88I2c,
        _runtime);
  }
#endif

  JsonDocument message;
  message["type"] = "sensorChanged";

  JsonObject data =
      message["data"].to<JsonObject>();

  data["address"] = address;
  data["on"] = occupied;

  sendWsJson(_ws, message);

  Logger::info(
      "S88 WS sensorChanged: address=" +
      String(address) +
      " on=" +
      String(occupied ? "true" : "false"));
}

void App::broadcastS88Snapshot() {
  if (
      !_s88I2c.enabled() ||
      !_s88I2c.dataFresh()
  ) {
    return;
  }

  JsonDocument message;
  message["type"] = "sensorSnapshot";

  JsonObject data =
      message["data"].to<JsonObject>();

  JsonArray groups =
      data["groups"].to<JsonArray>();

  for (
      uint8_t groupIndex = 0;
      groupIndex < _s88I2c.snapshotGroupCount();
      ++groupIndex
  ) {
    JsonArray group = groups.add<JsonArray>();

    group.add(
        static_cast<uint16_t>(
            _s88I2c.baseSensorAddress() +
            static_cast<uint16_t>(groupIndex) * 16U));

    group.add(
        _s88I2c.activeBitsForSnapshotGroup(groupIndex));

    group.add(
        _s88I2c.knownBitsForSnapshotGroup(groupIndex));
  }

  sendWsJson(_ws, message);
}

void App::updateS88WebSocket() {
  if (
      !_s88I2c.enabled() ||
      !_s88I2c.dataFresh()
  ) {
    return;
  }

  const unsigned long now = millis();

  if (
      now - _lastS88WsSnapshotAt <
      S88_WS_SNAPSHOT_INTERVAL_MS
  ) {
    return;
  }

  _lastS88WsSnapshotAt = now;
  broadcastS88Snapshot();
}

void App::loadConfiguration() {
  _config.begin();

  const auto& commandCenter =
      _config.commandCenter();

  _wsProtocol.setPowerIncludesProgramming(
      commandCenter.powerIncludesProgramming);

  _commandCenter.begin(
      commandCenter.host,
      commandCenter.port);

  Logger::info(
      String("Firmware command center: ") +
      _commandCenter.name());

  _display.showCommandCenter(
      _commandCenter.host(),
      _commandCenter.port(),
      false);
}

void App::connectWifi() {
  const auto& network =
      _config.network();

  WiFi.mode(WIFI_STA);

#if defined(HUB_DISPLAY_WAVESHARE_S3_LCD7) && HUB_DISPLAY_WAVESHARE_S3_LCD7
  WiFi.setSleep(false);
  Logger::info("Waveshare Wi-Fi power save disabled");
#endif

  WiFi.setHostname(network.hostname.c_str());

  if (!network.dhcp) {
    IPAddress ip;
    IPAddress gateway;
    IPAddress subnet;
    IPAddress dns1;
    IPAddress dns2;

    const bool valid =
        parseIp(network.ip, ip) &&
        parseIp(network.gateway, gateway) &&
        parseIp(network.subnet, subnet) &&
        parseIp(network.dns1, dns1, true) &&
        parseIp(network.dns2, dns2, true);

    if (valid) {
      if (!WiFi.config(ip, gateway, subnet, dns1, dns2)) {
        Logger::warn("Static Wi-Fi configuration failed");
      }
    } else {
      Logger::warn(
          "Invalid persisted static Wi-Fi configuration; falling back to DHCP");
    }
  }

  _display.showWifiConnecting(network.wifiSsid);

  WiFi.begin(
      network.wifiSsid.c_str(),
      network.wifiPassword.c_str());

  Logger::info(
      "Connecting Wi-Fi: " +
      network.wifiSsid);

  const unsigned long started = millis();

  while (
      WiFi.status() != WL_CONNECTED &&
      millis() - started < 15000
  ) {
    _serialConfigurator.loop();

    _s88I2c.loop();
    updateS88WebSocket();

    if (_s88I2c.enabled()) {
      _display.showS88Status(
          _s88I2c.slaveAddress(),
          _s88I2c.ready());
    }

    _display.loop();
    delay(25);
  }

  if (WiFi.status() == WL_CONNECTED) {
    const String ip = WiFi.localIP().toString();

    Logger::info(
        "Wi-Fi connected: " +
        ip +
        " RSSI=" +
        String(WiFi.RSSI()) +
        "dBm");

    if (MDNS.begin(network.hostname.c_str())) {
      Logger::info(
          "mDNS ready: " +
          network.hostname +
          ".local");
    } else {
      Logger::warn("mDNS initialization failed");
    }

    _display.showWifiConnected(
        ip,
        network.httpPort);
  } else {
    Logger::warn("Wi-Fi connection timeout");
    _display.showWifiFailed();
  }
}

void App::updateDisplay() {
  const bool connected =
      _commandCenter.connected();

  if (connected != _lastCommandCenterConnected) {
    _lastCommandCenterConnected = connected;

    _display.showCommandCenter(
        _commandCenter.host(),
        _commandCenter.port(),
        connected);
  }

  if (_s88I2c.enabled()) {
    _display.showS88Status(
        _s88I2c.slaveAddress(),
        _s88I2c.ready());
  }

  _display.loop();
}

void App::begin() {
  Logger::begin();
  Logger::info("DCCExpressHub booting");

  _display.begin();
  _display.showBoot();

  loadConfiguration();

  _serialConfigurator.begin();

  if (!LittleFS.begin(true)) {
    Logger::error("LittleFS mount failed");
    return;
  }

  _runtime.begin(LittleFS);

  _stateStore.begin(
      LittleFS,
      _runtime);

  _stateStore.load();

#if defined(HUB_DISPLAY_WAVESHARE_S3_LCD7) && HUB_DISPLAY_WAVESHARE_S3_LCD7
  _runtime.onChange(
      [this](
          RuntimeChangeKind kind,
          uint16_t id,
          uint8_t channel) {
        syncWaveshareRuntimeMonitor(
            _s88I2c,
            _runtime);

        const String eventText =
            runtimeEventText(
                _runtime,
                kind,
                id,
                channel);

        if (!eventText.isEmpty()) {
          WaveshareS3Lcd7Display::pushRuntimeEvent(
              eventText,
              millis());
        }
      });
#endif

  _s88I2c.onSensorChange(
      [this](
          uint16_t address,
          bool occupied) {
        broadcastS88SensorChanged(
            address,
            occupied);
      });

  _s88I2c.begin(LittleFS);

  if (_s88I2c.enabled()) {
    _display.showS88Status(
        _s88I2c.slaveAddress(),
        _s88I2c.ready());
  }

#if defined(HUB_DISPLAY_WAVESHARE_S3_LCD7) && HUB_DISPLAY_WAVESHARE_S3_LCD7
  syncWaveshareRuntimeMonitor(
      _s88I2c,
      _runtime);

  WaveshareS3Lcd7Display::pushRuntimeEvent(
      "Runtime monitor ready",
      millis());
#endif

  connectWifi();

  _apiServer.reset(
      new ApiServer(
          _config.network().httpPort,
          _ws,
          static_cast<ICommandCenter&>(_commandCenter),
          _runtime,
          _stateStore,
          _config,
          _wsProtocol,
          _s88I2c,
          _signalAutomation));

  _apiServer->begin();

  Logger::info(
      "Hub HTTP/API started on port " +
      String(_config.network().httpPort));

  if (WiFi.status() == WL_CONNECTED) {
    _commandCenter.ensureConnected();
  }

  _lastCommandCenterConnected =
      _commandCenter.connected();

  _display.showCommandCenter(
      _commandCenter.host(),
      _commandCenter.port(),
      _lastCommandCenterConnected);

  const bool signalAutomationStarted =
      _signalAutomation.begin(LittleFS);

  Logger::info(
      "SignalAutomation health: begin=" +
      String(signalAutomationStarted ? "true" : "false") +
      " enabled=" +
      String(_signalAutomation.enabled() ? "true" : "false") +
      " ruleSets=" +
      String(_signalAutomation.signalCount()));

  updateDisplay();
}

void App::loop() {
  _serialConfigurator.loop();

  _s88I2c.loop();
  updateS88WebSocket();

#if defined(HUB_DISPLAY_WAVESHARE_S3_LCD7) && HUB_DISPLAY_WAVESHARE_S3_LCD7
  const WaveshareWsGuardState wsGuard =
      tuneWaveshareWebSocketClients(_ws);

  WaveshareS3Lcd7Display::setConnectedWebClients(
      wsGuard.clientCount);

  static unsigned long nextDashboardStatsAt = 0;
  const unsigned long dashboardNow = millis();

  if (
      nextDashboardStatsAt == 0 ||
      static_cast<long>(dashboardNow - nextDashboardStatsAt) >= 0
  ) {
    WaveshareS3Lcd7Display::setDashboardSystemStats(
        ESP.getFreeHeap(),
        ESP.getFreePsram(),
        dashboardNow,
        _runtime.accessoryCount(),
        _runtime.sensorCount(),
        _runtime.blockCount());

    // Also re-copy the monitor model periodically. This catches runtime/layout
    // rebuilds that legitimately change the vectors without emitting a state
    // transition callback for every newly-created object.
    syncWaveshareRuntimeMonitor(
        _s88I2c,
        _runtime);

    nextDashboardStatsAt =
        dashboardNow + 5000UL;
  }

  _commandCenter.loop();

  if (!wsGuard.congested) {
    _wsProtocol.loop();
  } else {
    static unsigned long lastWsGuardLogAt = 0;
    const unsigned long now = millis();

    if (now - lastWsGuardLogAt >= 1000UL) {
      lastWsGuardLogAt = now;

      Logger::warn(
          "Waveshare WS backpressure: queue=" +
          String(static_cast<unsigned>(wsGuard.maxQueue)) +
          " freeHeap=" +
          String(ESP.getFreeHeap()) +
          " maxBlock=" +
          String(ESP.getMaxAllocHeap()));
    }
  }

  _wsProtocol.cleanupClients();
#else
  _commandCenter.loop();
  _wsProtocol.loop();
  _wsProtocol.cleanupClients();
#endif

  _wsProtocol.syncEmergencyStopState();

  _display.showEmergencyStopActive(
      _wsProtocol.emergencyStopActive());

  _display.showPowerActive(
      _wsProtocol.trackPowerOn());

  updateDisplay();

  if (_display.takeEmergencyStopRequest()) {
    Logger::warn("DISPLAY E-STOP toggle requested");

    const bool sent =
        _wsProtocol.triggerEmergencyStop();

    _display.showEmergencyStopActive(
        _wsProtocol.emergencyStopActive());

    if (sent) {
      Logger::warn("DISPLAY E-STOP toggle sent");
    } else {
      Logger::error("DISPLAY E-STOP toggle failed");
    }
  }

  if (_display.takePowerToggleRequest()) {
    const bool targetOn =
        !_wsProtocol.trackPowerOn();

    Logger::info(
        String("DISPLAY PWR toggle requested -> ") +
        (targetOn ? "ON" : "OFF"));

    if (!_wsProtocol.triggerTrackPowerToggle()) {
      Logger::error("DISPLAY PWR toggle failed");
    }
  }

  if (_display.takeInfoRequest()) {
    Logger::info("DISPLAY INFO requested");
  }

  delay(1);
}
