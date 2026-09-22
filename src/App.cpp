#include "App.h"

#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <WiFi.h>

#include "Logger.h"

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

void sendWsJson(
    AsyncWebSocket& ws,
    JsonDocument& document) {
  String body;

  serializeJson(document, body);

  ws.textAll(body);
}

}  // namespace

void App::publishSensorChanged(
    uint16_t address,
    bool on) {
  if (address == 0) {
    return;
  }

  _runtime.setSensor(
      address,
      on);

  JsonDocument message;
  message["type"] =
      "sensorChanged";

  JsonObject data =
      message["data"]
          .to<JsonObject>();

  data["address"] =
      address;

  data["on"] =
      on;

  sendWsJson(
      _ws,
      message);

  Logger::info(
      "Sensor runtime: address=" +
      String(address) +
      " on=" +
      String(on ? "true" : "false"));
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
    _lastCommandCenterConnected =
        connected;

    if (connected) {
      // Re-apply the safe/current automation result as soon as the command
      // center becomes writable again. A previous evaluation may have
      // happened while the physical connection was offline.
      _signalAutomation.evaluate();

      // Then refresh the authoritative physical sensor state. Every Q/q
      // response enters LayoutRuntime::setSensor() and triggers another
      // automation evaluation when the state changed.
      _commandCenter
          .requestSensorSnapshot(
              false);
    }

    _display.showCommandCenter(
        _commandCenter.host(),
        _commandCenter.port(),
        connected);
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

  if (
      !_commandCenter
           .beginLocomotiveConfiguration(
               LittleFS)
  ) {
    Logger::warn(
        "Locomotive direction configuration could not be loaded");
  }

  _runtime.begin(LittleFS);

  _stateStore.begin(
      LittleFS,
      _runtime);

  _stateStore.load();

  // Every physical sensor source ends up in the same runtime state.
  _commandCenter.onSensorFeedback(
      [this](
          const CommandCenterSensorFeedback& feedback) {
        publishSensorChanged(
            feedback.address,
            feedback.on);
      });


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
          _signalAutomation,
          [this]() {
            return
                _commandCenter
                    .reloadLocomotiveConfiguration();
          }));

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

  // If the command center was already online before automation came up,
  // refresh its authoritative physical sensor state now.
  if (_lastCommandCenterConnected) {
    _commandCenter
        .requestSensorSnapshot(
            false);
  }

  updateDisplay();
}

void App::loop() {
  _serialConfigurator.loop();

  _commandCenter.loop();
  _wsProtocol.loop();
  _wsProtocol.cleanupClients();

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
