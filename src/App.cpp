#include "App.h"

#include <LittleFS.h>
#include <WiFi.h>

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

  _dcc.begin(
      _commandCenterHost,
      _commandCenterPort);

  _display.showCommandCenter(
      _commandCenterHost,
      _commandCenterPort,
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

  if (connected !=
      _lastCommandCenterConnected) {
    _lastCommandCenterConnected =
        connected;

    _display.showCommandCenter(
        _commandCenterHost,
        _commandCenterPort,
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
      _commandCenterHost,
      _commandCenterPort,
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
