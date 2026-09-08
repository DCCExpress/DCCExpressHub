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
      millis() - started <
          15000
  ) {
    _serialConfigurator.loop();

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
          _signalAutomation));

  _apiServer->begin();

  updateDisplay();
}

void App::loop() {
  _serialConfigurator.loop();
  _commandCenter.loop();
  _wsProtocol.loop();
  _wsProtocol.cleanupClients();

  // Signal automation already evaluates synchronously from LayoutRuntime
  // turnout/sensor change callbacks. Keep a light polling fallback as well:
  // it makes automation resilient to a missed callback or a future runtime
  // producer that updates state without notifying observers.
  //
  // applySignal() caches the last applied value, so unchanged signal outputs
  // are NOT re-transmitted every 100 ms.
  static unsigned long nextSignalAutomationEvaluateAt =
      0;

  static unsigned long nextSignalAutomationHealthLogAt =
      0;

  const unsigned long now =
      millis();

  if (
      nextSignalAutomationEvaluateAt == 0 ||
      static_cast<long>(
          now -
          nextSignalAutomationEvaluateAt) >= 0
  ) {
    _signalAutomation.evaluate();

    nextSignalAutomationEvaluateAt =
        now +
        100;
  }

  if (
      nextSignalAutomationHealthLogAt == 0 ||
      static_cast<long>(
          now -
          nextSignalAutomationHealthLogAt) >= 0
  ) {
    Logger::info(
        "SignalAutomation health: enabled=" +
        String(
            _signalAutomation.enabled()
                ? "true"
                : "false") +
        " ruleSets=" +
        String(
            _signalAutomation.signalCount()) +
        " cc=" +
        String(
            _commandCenter.connected()
                ? "online"
                : "offline"));

    nextSignalAutomationHealthLogAt =
        now +
        5000;
  }

  updateDisplay();

  delay(1);
}
