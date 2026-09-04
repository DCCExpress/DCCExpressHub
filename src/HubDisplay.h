#pragma once

#include <Arduino.h>

#ifndef HUB_USE_DISPLAY
#define HUB_USE_DISPLAY 0
#endif

class HubDisplay {
public:
  void begin();
  void showBoot();
  void showWifiConnecting(const String& ssid);
  void showWifiConnected(const String& ip, uint16_t httpPort);
  void showWifiFailed();
  void showCommandCenter(const String& host, uint16_t port, bool connected);
  void loop();
private:
#if HUB_USE_DISPLAY
  String _ip;
  uint16_t _httpPort = 80;
  String _ccHost;
  uint16_t _ccPort = 0;
  bool _ccConnected = false;
  bool _initialized = false;
  bool _dirty = false;
  void redraw();
#endif
};
