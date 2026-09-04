#include "HubDisplay.h"

#if HUB_USE_DISPLAY
#include <M5Unified.h>

void HubDisplay::begin() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  M5.Display.setTextSize(2);
  M5.Display.setTextWrap(false);
  _initialized = true;
  _dirty = true;
  redraw();
}

void HubDisplay::showBoot() {
  if (!_initialized) return;
  _ip = "";
  _ccHost = "";
  _ccPort = 0;
  _ccConnected = false;
  _dirty = true;
}

void HubDisplay::showWifiConnecting(const String& ssid) {
  if (!_initialized) return;
  M5.Display.clear();
  M5.Display.setCursor(8, 8);
  M5.Display.println("DCCExpressHub");
  M5.Display.println();
  M5.Display.println("WiFi...");
  M5.Display.println(ssid);
}

void HubDisplay::showWifiConnected(const String& ip, uint16_t httpPort) {
  if (!_initialized) return;
  _ip = ip;
  _httpPort = httpPort;
  _dirty = true;
}

void HubDisplay::showWifiFailed() {
  if (!_initialized) return;
  _ip = "NOT CONNECTED";
  _dirty = true;
}

void HubDisplay::showCommandCenter(const String& host, uint16_t port, bool connected) {
  if (!_initialized) return;
  if (_ccHost == host && _ccPort == port && _ccConnected == connected) return;
  _ccHost = host;
  _ccPort = port;
  _ccConnected = connected;
  _dirty = true;
}

void HubDisplay::loop() {
  if (!_initialized) return;
  M5.update();
  if (_dirty) redraw();
}

void HubDisplay::redraw() {
  if (!_initialized) return;
  _dirty = false;
  M5.Display.clear();
  M5.Display.setCursor(8, 8);
  M5.Display.println("DCCExpressHub");
  M5.Display.println();
  M5.Display.print("IP: " );
  M5.Display.println(_ip.length() ? _ip : String("-"));
  M5.Display.print("WEB: " );
  if (_ip.length() && _ip != "NOT CONNECTED") {
    M5.Display.print(_ip);
    M5.Display.print(":");
    M5.Display.println(_httpPort);
  } else {
    M5.Display.println("-");
  }
  M5.Display.println();
  M5.Display.print("DCC-EX: " );
  M5.Display.println(_ccConnected ? "CONNECTED" : "OFFLINE");
  M5.Display.print("CSB1: " );
  if (_ccHost.length()) {
    M5.Display.print(_ccHost);
    M5.Display.print(":");
    M5.Display.println(_ccPort);
  } else {
    M5.Display.println("-");
  }
}

#else
void HubDisplay::begin() {}
void HubDisplay::showBoot() {}
void HubDisplay::showWifiConnecting(const String&) {}
void HubDisplay::showWifiConnected(const String&, uint16_t) {}
void HubDisplay::showWifiFailed() {}
void HubDisplay::showCommandCenter(const String&, uint16_t, bool) {}
void HubDisplay::loop() {}
#endif
