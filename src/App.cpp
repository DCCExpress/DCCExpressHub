#include "App.h"

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

  return out.fromString(
      text);
}
}

void App::loadConfiguration() {
  _config.begin();

  const auto& commandCenter =
      _config.commandCenter();

  _wsProtocol.setPowerIncludesProgramming(
      commandCenter.powerIncludesProgramming);

  _dcc.begin(
      commandCenter.host,
      commandCenter.port);

  _display.showCommandCenter(
      _dcc.host(),
      _dcc.port(),
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
      if (!WiFi.config(
              ip,
              gateway,
              subnet,
              dns1,
              dns2)) {
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
      millis() - started <
          15000) {
    // Keep the serial recovery path alive even while normal networking
    // is unavailable or badly configured.
    _serialConfigurator.loop();

    _display.loop();
    delay(25);
  }

  if (WiFi.status() ==
      WL_CONNECTED) {
    const String ip =
        WiFi.localIP().toString();

    Logger::info(
        "Wi-Fi connected: " +
        ip);

    if (MDNS.begin(
            network.hostname.c_str())) {
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
      _dcc.connected();

  if (connected !=
      _lastCommandCenterConnected) {
    _lastCommandCenterConnected =
        connected;

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

  // Start the recovery/configuration protocol before Wi-Fi is touched.
  _serialConfigurator.begin();

  if (!LittleFS.begin(true)) {
    Logger::error(
        "LittleFS mount failed");
    return;
  }

  LittleFS.mkdir(
      "/config");

  LittleFS.mkdir(
      "/state");

  _runtime.begin(
      LittleFS);

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

  _signalAutomation.begin(
      LittleFS);

  _apiServer.reset(
      new ApiServer(
          _config.network().httpPort,
          _ws,
          _dcc,
          _runtime,
          _stateStore,
          _config,
          _wsProtocol));

  _apiServer->begin();

  updateDisplay();
}

void App::loop() {
  _serialConfigurator.loop();
  _dcc.loop();
  _wsProtocol.loop();
  _wsProtocol.cleanupClients();
  updateDisplay();
  delay(1);
}
