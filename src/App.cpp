#include "App.h"

#include <LittleFS.h>
#include <WiFi.h>

#include "config.h"
#include "Logger.h"

void App::loadConfiguration() {
  _prefs.begin("dcchub", false);

  const String host =
      _prefs.getString("csbHost", DEFAULT_CSB1_HOST);
  const uint16_t port =
      _prefs.getUShort("csbPort", DEFAULT_CSB1_PORT);

  _dcc.begin(host, port);
}

void App::connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(DEVICE_HOSTNAME);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Logger::info("Connecting Wi-Fi: " + String(WIFI_SSID));

  const unsigned long started = millis();
  while (
      WiFi.status() != WL_CONNECTED &&
      millis() - started < 15000) {
    delay(250);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Logger::info(
        "Wi-Fi connected: " +
        WiFi.localIP().toString());
  } else {
    Logger::warn("Wi-Fi connection timeout");
  }
}

void App::begin() {
  Logger::begin();
  Logger::info("DCCExpressHub booting");

  loadConfiguration();

  if (!LittleFS.begin(true)) {
    Logger::error("LittleFS mount failed");
    return;
  }

  LittleFS.mkdir("/config");
  LittleFS.mkdir("/state");

  // Build only accessory + sensor runtime state from the layout.
  _runtime.begin(LittleFS);

  // Restore the last clean shutdown state.
  _stateStore.begin(LittleFS, _runtime);
  _stateStore.load();

  connectWifi();

  if (WiFi.status() == WL_CONNECTED) {
    _dcc.ensureConnected();
  }

  _apiServer.begin();
}

void App::loop() {
  _dcc.loop();
  _wsProtocol.cleanupClients();

  // No runtime flash writes here.
  delay(1);
}
