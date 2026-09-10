#include "App.h"

#include <ArduinoJson.h>
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

  return out.fromString(
      text);
}

void sendWsJson(
    AsyncWebSocket& ws,
    JsonDocument& document) {
  String body;

  serializeJson(
      document,
      body);

  ws.textAll(
      body);
}

}

void App::broadcastS88SensorChanged(
    uint16_t address,
    bool occupied) {
  _runtime.setSensor(
      address,
      occupied);

  JsonDocument message;

  message["type"] =
      "sensorChanged";

  JsonObject data =
      message["data"]
          .to<JsonObject>();

  data["address"] =
      address;

  data["on"] =
      occupied;

  sendWsJson(
      _ws,
      message);

  Logger::info(
      "S88 WS sensorChanged: address=" +
      String(address) +
      " on=" +
      String(
          occupied
              ? "true"
              : "false"));
}

void App::broadcastS88Snapshot() {
  if (
      !_s88I2c.enabled() ||
      !_s88I2c.dataFresh()
  ) {
    return;
  }

  JsonDocument message;

  message["type"] =
      "sensorSnapshot";

  JsonObject data =
      message["data"]
          .to<JsonObject>();

  JsonArray groups =
      data["groups"]
          .to<JsonArray>();

  // WebSocket compatibility: browser snapshots are still packed into
  // 16-bit groups. A chain with an odd number of S88 bytes therefore has an
  // 0x00FF known-mask in the last WebSocket group.
  for (
      uint8_t groupIndex = 0;
      groupIndex <
          _s88I2c.snapshotGroupCount();
      ++groupIndex
  ) {
    JsonArray group =
        groups.add<JsonArray>();

    group.add(
        static_cast<uint16_t>(
            _s88I2c.baseSensorAddress() +
            static_cast<uint16_t>(
                groupIndex) *
                16U));

    group.add(
        _s88I2c.activeBitsForSnapshotGroup(
            groupIndex));

    group.add(
        _s88I2c.knownBitsForSnapshotGroup(
            groupIndex));
  }

  sendWsJson(
      _ws,
      message);
}

void App::updateS88WebSocket() {
  if (
      !_s88I2c.enabled() ||
      !_s88I2c.dataFresh()
  ) {
    return;
  }

  const unsigned long now =
      millis();

  if (
      now -
          _lastS88WsSnapshotAt <
      S88_WS_SNAPSHOT_INTERVAL_MS
  ) {
    return;
  }

  _lastS88WsSnapshotAt =
      now;

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

  WiFi.mode(
      WIFI_STA);

  WiFi.setHostname(
      network.hostname.c_str());

  if (!network.dhcp) {
    IPAddress ip;
    IPAddress gateway;
    IPAddress subnet;
    IPAddress dns1;
    IPAddress dns2;

    const bool valid =
        parseIp(
            network.ip,
            ip) &&
        parseIp(
            network.gateway,
            gateway) &&
        parseIp(
            network.subnet,
            subnet) &&
        parseIp(
            network.dns1,
            dns1,
            true) &&
        parseIp(
            network.dns2,
            dns2,
            true);

    if (valid) {
      if (
          !WiFi.config(
              ip,
              gateway,
              subnet,
              dns1,
              dns2)
      ) {
        Logger::warn(
            "Static Wi-Fi configuration failed");
      }
    } else {
      Logger::warn(
          "Invalid persisted static Wi-Fi configuration; falling back to DHCP");
    }
  }

  _display.showWifiConnecting(
      network.wifiSsid);

  WiFi.begin(
      network.wifiSsid.c_str(),
      network.wifiPassword.c_str());

  Logger::info(
      "Connecting Wi-Fi: " +
      network.wifiSsid);

  const unsigned long started =
      millis();

  while (
      WiFi.status() !=
          WL_CONNECTED &&
      millis() -
          started <
          15000
  ) {
    _serialConfigurator.loop();

    _s88I2c.loop();
    updateS88WebSocket();

    if (_s88I2c.enabled()) {
      _display.showS88Status(
          _s88I2c.slaveAddress(),
          _s88I2c.slavePresent());
    }

    _display.loop();
    delay(25);
  }

  if (
      WiFi.status() ==
      WL_CONNECTED
  ) {
    const String ip =
        WiFi.localIP().toString();

    Logger::info(
        "Wi-Fi connected: " +
        ip);

    if (
        MDNS.begin(
            network.hostname.c_str())
    ) {
      Logger::info(
          "mDNS ready: " +
          network.hostname +
          ".local");
    } else {
      Logger::warn(
          "mDNS initialization failed");
    }

    _display.showWifiConnected(
        ip,
        network.httpPort);
  } else {
    Logger::warn(
        "Wi-Fi connection timeout");

    _display.showWifiFailed();
  }
}

void App::updateDisplay() {
  const bool connected =
      _commandCenter.connected();

  if (
      connected !=
      _lastCommandCenterConnected
  ) {
    _lastCommandCenterConnected =
        connected;

    _display.showCommandCenter(
        _commandCenter.host(),
        _commandCenter.port(),
        connected);
  }

  if (_s88I2c.enabled()) {
    _display.showS88Status(
        _s88I2c.slaveAddress(),
        _s88I2c.slavePresent());
  }

  _display.loop();
}

void App::begin() {
  Logger::begin();

  Logger::info(
      "DCCExpressHub booting");

  _display.begin();
  _display.showBoot();

  loadConfiguration();

  _serialConfigurator.begin();

  // Device configuration now participates in S88 startup, so LittleFS must
  // already be mounted before the I2C master loads its runtime settings.
  if (!LittleFS.begin(true)) {
    Logger::error(
        "LittleFS mount failed");

    return;
  }

  _runtime.begin(
      LittleFS);

  _stateStore.begin(
      LittleFS,
      _runtime);

  _stateStore.load();

  _s88I2c.onSensorChange(
      [this](
          uint16_t address,
          bool occupied) {
        broadcastS88SensorChanged(
            address,
            occupied);
      });

  _s88I2c.begin(
      LittleFS);

  if (_s88I2c.enabled()) {
    _display.showS88Status(
        _s88I2c.slaveAddress(),
        _s88I2c.slavePresent());
  }

  connectWifi();

  if (
      WiFi.status() ==
      WL_CONNECTED
  ) {
    _commandCenter.ensureConnected();
  }

  _lastCommandCenterConnected =
      _commandCenter.connected();

  _display.showCommandCenter(
      _commandCenter.host(),
      _commandCenter.port(),
      _lastCommandCenterConnected);

  const bool signalAutomationStarted =
      _signalAutomation.begin(
          LittleFS);

  Logger::info(
      "SignalAutomation health: begin=" +
      String(
          signalAutomationStarted
              ? "true"
              : "false") +
      " enabled=" +
      String(
          _signalAutomation.enabled()
              ? "true"
              : "false") +
      " ruleSets=" +
      String(
          _signalAutomation.signalCount()));

  _apiServer.reset(
      new ApiServer(
          _config.network().httpPort,
          _ws,
          static_cast<ICommandCenter&>(
              _commandCenter),
          _runtime,
          _stateStore,
          _config,
          _wsProtocol,
          _s88I2c,
          _signalAutomation));

  _apiServer->begin();

  updateDisplay();
}

void App::loop() {
  _serialConfigurator.loop();

  _s88I2c.loop();
  updateS88WebSocket();

  _commandCenter.loop();
  _wsProtocol.loop();
  _wsProtocol.cleanupClients();

  _wsProtocol.syncEmergencyStopState();

  _display.showEmergencyStopActive(
      _wsProtocol.emergencyStopActive());

  _display.showPowerActive(
      _wsProtocol.trackPowerOn());

  updateDisplay();

  if (
      _display
          .takeEmergencyStopRequest()
  ) {
    Logger::warn(
        "DISPLAY E-STOP toggle requested");

    const bool sent =
        _wsProtocol
            .triggerEmergencyStop();

    _display.showEmergencyStopActive(
        _wsProtocol.emergencyStopActive());

    if (sent) {
      Logger::warn(
          "DISPLAY E-STOP toggle sent");
    } else {
      Logger::error(
          "DISPLAY E-STOP toggle failed");
    }
  }

  if (
      _display
          .takePowerToggleRequest()
  ) {
    const bool targetOn =
        !_wsProtocol
             .trackPowerOn();

    Logger::info(
        String("DISPLAY PWR toggle requested -> ") +
        (
            targetOn
                ? "ON"
                : "OFF"
        ));

    if (
        !_wsProtocol
             .triggerTrackPowerToggle()
    ) {
      Logger::error(
          "DISPLAY PWR toggle failed");
    }
  }

  if (
      _display
          .takeInfoRequest()
  ) {
    Logger::info(
        "DISPLAY INFO requested");
  }

  delay(1);
}
