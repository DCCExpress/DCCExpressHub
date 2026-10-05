#include "App.h"

#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <WiFi.h>
#include <esp_heap_caps.h>

#include "Logger.h"

namespace {

void bootStep(
    const char* step,
    const String& message) {
  Logger::info(
      String("BOOT ") +
      step +
      " " +
      message);
}

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

void App::loadConfiguration() {
  bootStep(
      "02A",
      "configuration store begin");

  _config.begin();

  const auto& commandCenter =
      _config.commandCenter();

  Logger::info(
      "CONFIG CC host=" +
      commandCenter.host +
      " port=" +
      String(
          commandCenter.port) +
      " profile=" +
      String(
          CommandCenterBuild::profile()));

  _wsProtocol.setPowerIncludesProgramming(
      commandCenter.powerIncludesProgramming);

  _commandCenter.setCommandIntervalMs(
      commandCenter.commandIntervalMs);

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

  const unsigned long started =
      millis();

  unsigned long nextProgressAt =
      started;

  while (
      WiFi.status() != WL_CONNECTED &&
      millis() - started < 15000
  ) {
    const unsigned long now =
        millis();

    if (
        static_cast<long>(
            now -
            nextProgressAt) >= 0)
    {
      Logger::info(
          "WAIT Wi-Fi status=" +
          String(
              static_cast<int>(
                  WiFi.status())) +
          " elapsed=" +
          String(
              now -
              started) +
          "ms");

      nextProgressAt =
          now +
          1000;
    }

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

  _display.showFeedbackLink(
      _commandCenter.feedbackLinkName(),
      _commandCenter.feedbackLinkConnected());

  _display.loop();
}

void App::begin() {
  Logger::begin();
  bootStep(
      "00",
      "App::begin entered");

  bootStep(
      "01",
      "memory policy");

  // Keep scarce internal SRAM available for Wi-Fi/AsyncTCP and other
  // internal-memory-only allocations. On the N16R8 S3, prefer PSRAM for
  // larger ordinary malloc/new requests.
  if (ESP.getPsramSize() > 0) {
    heap_caps_malloc_extmem_enable(8192);

    Logger::info(
        "PSRAM enabled: total=" +
        String(ESP.getPsramSize() / 1024) +
        " KB free=" +
        String(ESP.getFreePsram() / 1024) +
        " KB; malloc >= 8 KB prefers PSRAM");
  } else {
    Logger::warn("PSRAM not detected");
  }

  bootStep(
      "02",
      "display begin");

  _display.begin();
  _display.showBoot();

  bootStep(
      "03",
      "load configuration");

  loadConfiguration();

  Logger::info(
      "BOOT 03 OK");

  bootStep(
      "04",
      "serial configurator begin");

  _serialConfigurator.begin();

  Logger::info(
      "BOOT 04 OK");

  bootStep(
      "05",
      "LittleFS mount");

  if (!LittleFS.begin(true)) {
    Logger::error(
        "BOOT 05 FAIL LittleFS mount failed");
    return;
  }

  Logger::info(
      "BOOT 05 OK");

  bootStep(
      "06",
      "locomotive configuration");

  if (
      !_commandCenter
           .beginLocomotiveConfiguration(
               LittleFS)
  ) {
    Logger::warn(
        "BOOT 06 WARN locomotive direction configuration could not be loaded");
  } else {
    Logger::info(
        "BOOT 06 OK");
  }

  bootStep(
      "07",
      "locomotive counters");

  if (
      !_locoCounters.begin(
          LittleFS)
  ) {
    Logger::warn(
        "BOOT 07 WARN locomotive counter configuration could not be loaded");
  } else {
    Logger::info(
        "BOOT 07 OK");
  }

  bootStep(
      "08",
      "layout runtime begin");

  _runtime.begin(
      LittleFS);

  Logger::info(
      "BOOT 08 OK");

  bootStep(
      "09",
      "runtime state store load");

  _stateStore.begin(
      LittleFS,
      _runtime);

  _stateStore.load();

  Logger::info(
      "BOOT 09 OK");

  bootStep(
      "10",
      "Wi-Fi connect");

  connectWifi();

  Logger::info(
      String("BOOT 10 ") +
      (
          WiFi.status() ==
                  WL_CONNECTED
              ? "OK"
              : "FAIL"));

  bootStep(
      "11",
      "construct HTTP/API server");

  _apiServer.reset(
      new ApiServer(
          _config.network().httpPort,
          _ws,
          static_cast<ICommandCenter&>(_commandCenter),
          _runtime,
          _stateStore,
          _config,
          _wsProtocol,
          _locoCounters,
          _signalAutomation,
          [this]() {
            return
                _commandCenter
                    .reloadLocomotiveConfiguration();
          }));

  Logger::info(
      "BOOT 11 OK");

  bootStep(
      "12",
      "HTTP/WS server begin");

  _apiServer->begin();

  Logger::info(
      "BOOT 12 OK HTTP/API port=" +
      String(
          _config.network().httpPort));

  bootStep(
      "13",
      "command center connect");

  if (
      WiFi.status() ==
      WL_CONNECTED)
  {
    const unsigned long ccStarted =
        millis();

    Logger::info(
        "CC ensureConnected begin host=" +
        _commandCenter.host() +
        ":" +
        String(
            _commandCenter.port()));

    const bool ccKick =
        _commandCenter.ensureConnected();

    Logger::info(
        "CC ensureConnected end queued=" +
        String(
            ccKick
                ? "true"
                : "false") +
        " elapsed=" +
        String(
            millis() -
            ccStarted) +
        "ms");
  }
  else
  {
    Logger::warn(
        "CC connect skipped: Wi-Fi is not connected");
  }

  _lastCommandCenterConnected =
      _commandCenter.connected();

  Logger::info(
      "BOOT 13 state CC=" +
      String(
          _lastCommandCenterConnected
              ? "OK"
              : "NOK") +
      " feedback=" +
      String(
          _commandCenter
                  .feedbackLinkConnected()
              ? "OK"
              : "NOK"));

  _display.showCommandCenter(
      _commandCenter.host(),
      _commandCenter.port(),
      _lastCommandCenterConnected);

  _display.showFeedbackLink(
      _commandCenter.feedbackLinkName(),
      _commandCenter.feedbackLinkConnected());

  bootStep(
      "14",
      "signal automation begin");

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
    Logger::info(
        "BOOT 15 requesting initial sensor snapshot");

    _commandCenter
        .requestSensorSnapshot(
            false);
  }

  updateDisplay();

  Logger::info(
      "BOOT COMPLETE heap=" +
      String(
          ESP.getFreeHeap() /
          1024) +
      "KB psram=" +
      String(
          ESP.getFreePsram() /
          1024) +
      "KB");
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
