#pragma once

#include <Arduino.h>

#ifndef HUB_USE_DISPLAY
#define HUB_USE_DISPLAY 0
#endif

#ifndef HUB_DISPLAY_M5STACK_BASIC
#define HUB_DISPLAY_M5STACK_BASIC 0
#endif

#ifndef HUB_DISPLAY_CYD_2432S028
#define HUB_DISPLAY_CYD_2432S028 0
#endif

#if HUB_USE_DISPLAY
  #if HUB_DISPLAY_CYD_2432S028
    #include "CydIli9341Display.h"
    using HubDisplayDevice = CydIli9341Display;
  #elif HUB_DISPLAY_M5STACK_BASIC
    #include "MiniIli9342Display.h"
    using HubDisplayDevice = MiniIli9342Display;
  #else
    #error "HUB_USE_DISPLAY=1 requires a supported HUB_DISPLAY_* target"
  #endif
#endif

class HubDisplay {
public:
  void begin();

  void showBoot();

  void showWifiConnecting(
      const String& ssid);

  void showWifiConnected(
      const String& ip,
      uint16_t httpPort);

  void showWifiFailed();

  void showCommandCenter(
      const String& host,
      uint16_t port,
      bool connected);

  // Synchronizes the CYD button with the real HUB E-STOP state.
  // State changes redraw only the button rectangle to avoid display flicker.
  void showEmergencyStopActive(
      bool active);

  void loop();

  // Returns and clears the pending display-generated E-STOP request.
  bool takeEmergencyStopRequest();

private:
#if HUB_USE_DISPLAY
  HubDisplayDevice _display;

  String _ip;
  uint16_t _httpPort = 80;

  String _ccHost;
  uint16_t _ccPort = 0;
  bool _ccConnected = false;

  bool _initialized = false;
  bool _dirty = false;

  bool _emergencyStopRequest = false;
  bool _emergencyStopActive = false;

  void redraw();

#if HUB_DISPLAY_CYD_2432S028
  void redrawEmergencyButton();
#endif
#endif
};
