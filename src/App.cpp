#include "App.h"

#include <LittleFS.h>
#include <WiFi.h>
#include <ESPmDNS.h>

#include "config.h"
#include "Logger.h"

namespace {
constexpr uint16_t HUB_HTTP_PORT = 80;
}

void App::loadConfiguration() {
  _prefs.begin(
      "dcchub",
      false);

  _commandCenterHost =
      _prefs.getString(
          "csbHost",
          DEFAULT_CSB1_HOST);

  _commandCenterPort =
      _prefs.getUShort(
          "csbPort",
          DEFAULT_CSB1_PORT);

  const bool powerIncludesProgramming =
      _prefs.getBool(
          "powerProg",
          true);

  _wsProtocol.setPowerIncludesProgramming(
      powerIncludesProgramming);

  _dcc.begin(
      _commandCenterHost,
      _commandCenterPort);

  _display.showCommandCenter(
      _dcc.host(),
      _dcc.port(),
      false);
}

void App::connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(
      DEVICE_HOSTNAME);

  _display.showWifiConnecting(
      WIFI_SSID);

  WiFi.begin(
      WIFI_SSID,
      WIFI_PASSWORD);

  Logger::info(
      "Connecting Wi-Fi: " +
      String(WIFI_SSID));

  const unsigned long started =
      millis();

  while (
      WiFi.status() != WL_CONNECTED &&
      millis() - started < 15000) {
    _display.loop();
    delay(250);
  }

  if (WiFi.status() == WL_CONNECTED) {
    const String ip =
        WiFi.localIP().toString();

    Logger::info(
        "Wi-Fi connected: " + ip);

    if (MDNS.begin(DEVICE_HOSTNAME)) {
      Logger::info(
          "mDNS ready: " +
          String(DEVICE_HOSTNAME) +
          ".local");
    } else {
      Logger::warn(
          "mDNS initialization failed");
    }

    _display.showWifiConnected(
        ip,
        HUB_HTTP_PORT);
  } else {
    Logger::warn(
        "Wi-Fi connection timeout");

    _display.showWifiFailed();
  }
}

void App::updateDisplay() {
  const bool connected =
      _dcc.connected();

  const bool endpointChanged =
      _commandCenterHost != _dcc.host() ||
      _commandCenterPort != _dcc.port();

  if (connected !=
          _lastCommandCenterConnected ||
      endpointChanged) {
    _lastCommandCenterConnected =
        connected;

    _commandCenterHost =
        _dcc.host();
    _commandCenterPort =
        _dcc.port();

    _display.showCommandCenter(
        _dcc.host(),
        _dcc.port(),
        connected);
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

  if (!LittleFS.begin(true)) {
    Logger::error(
        "LittleFS mount failed");
    return;
  }

  LittleFS.mkdir("/config");
  LittleFS.mkdir("/state");

  _runtime.begin(LittleFS);

  _stateStore.begin(
      LittleFS,
      _runtime);

  _stateStore.load();

  connectWifi();

  if (WiFi.status() ==
      WL_CONNECTED) {
    _dcc.ensureConnected();
  }

  _lastCommandCenterConnected =
      _dcc.connected();

  _display.showCommandCenter(
      _dcc.host(),
      _dcc.port(),
      _lastCommandCenterConnected);

  // Register runtime-change callbacks only AFTER persisted state has been
  // restored, so boot restoration does not fire automation mid-load.
  _signalAutomation.begin(
      LittleFS);

  _apiServer.begin();

  updateDisplay();
}

void App::loop() {
  _dcc.loop();
  _wsProtocol.loop();
  _wsProtocol.cleanupClients();
  updateDisplay();
  delay(1);
}
