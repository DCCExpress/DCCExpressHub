#include "HubDisplay.h"

#if HUB_USE_DISPLAY

void HubDisplay::begin() {
  _display.begin();

  _display.setTextSize(
      2);

  _display.setTextColor(
      HubDisplayDevice::WHITE,
      HubDisplayDevice::BLACK);

  _initialized =
      true;

  _dirty =
      true;

  redraw();
}

void HubDisplay::showBoot() {
  if (!_initialized) {
    return;
  }

  _ip =
      "";

  _ccHost =
      "";

  _ccPort =
      0;

  _ccConnected =
      false;

  _dirty =
      true;
}

void HubDisplay::showWifiConnecting(
    const String& ssid) {
  if (!_initialized) {
    return;
  }

  _display.clear();

  _display.setCursor(
      8,
      8);

  _display.println(
      "DCCExpressHub");

  _display.println();

  _display.println(
      "WiFi...");

  _display.println(
      ssid);

#if HUB_DISPLAY_CYD_2432S028
  redrawEmergencyButton();
#endif
}

void HubDisplay::showWifiConnected(
    const String& ip,
    uint16_t httpPort) {
  if (!_initialized) {
    return;
  }

  _ip =
      ip;

  _httpPort =
      httpPort;

  _dirty =
      true;
}

void HubDisplay::showWifiFailed() {
  if (!_initialized) {
    return;
  }

  _ip =
      "NOT CONNECTED";

  _dirty =
      true;
}

void HubDisplay::showCommandCenter(
    const String& host,
    uint16_t port,
    bool connected) {
  if (!_initialized) {
    return;
  }

  if (
      _ccHost == host &&
      _ccPort == port &&
      _ccConnected == connected
  ) {
    return;
  }

  _ccHost =
      host;

  _ccPort =
      port;

  _ccConnected =
      connected;

  _dirty =
      true;
}

void HubDisplay::showEmergencyStopActive(
    bool active) {
  if (
      _emergencyStopActive ==
      active
  ) {
    return;
  }

  _emergencyStopActive =
      active;

#if HUB_DISPLAY_CYD_2432S028
  // Do NOT mark the whole display dirty. The emergency button has a fixed
  // rectangle, so repainting only that region avoids the visible full-screen
  // clear/redraw flicker.
  if (_initialized) {
    redrawEmergencyButton();
  }
#endif
}

bool HubDisplay::takeEmergencyStopRequest() {
  const bool pending =
      _emergencyStopRequest;

  _emergencyStopRequest =
      false;

  return pending;
}

void HubDisplay::loop() {
  if (!_initialized) {
    return;
  }

#if HUB_DISPLAY_CYD_2432S028
  if (
      _display
          .takeEmergencyButtonPress()
  ) {
    _emergencyStopRequest =
        true;
  }
#endif

  if (!_dirty) {
    return;
  }

  redraw();
}

#if HUB_DISPLAY_CYD_2432S028

void HubDisplay::redrawEmergencyButton() {
  _display.drawEmergencyButton(
      "EMERGENCY STOP",
      _emergencyStopActive
          ? HubDisplayDevice::RED
          : HubDisplayDevice::DARK_GREY);
}

#endif

void HubDisplay::redraw() {
  if (!_initialized) {
    return;
  }

  _dirty =
      false;

  _display.clear();

  _display.setCursor(
      8,
      8);

  _display.setTextSize(
      2);

  _display.setTextColor(
      HubDisplayDevice::WHITE,
      HubDisplayDevice::BLACK);

  _display.println(
      "DCCExpressHub");

  _display.println();

  _display.print(
      "IP: ");

  _display.println(
      _ip.length()
          ? _ip
          : String("-"));

  _display.print(
      "WEB: ");

  if (
      _ip.length() &&
      _ip !=
          "NOT CONNECTED"
  ) {
    _display.print(
        _ip);

    _display.print(
        ":");

    _display.println(
        static_cast<uint32_t>(
            _httpPort));
  } else {
    _display.println(
        "-");
  }

  _display.println();

  _display.print(
      "CC: ");

  _display.println(
      _ccConnected
          ? "CONNECTED"
          : "OFFLINE");

  _display.print(
      "HOST: ");

  if (_ccHost.length()) {
    _display.print(
        _ccHost);

    _display.print(
        ":");

    _display.println(
        static_cast<uint32_t>(
            _ccPort));
  } else {
    _display.println(
        "-");
  }

#if HUB_DISPLAY_CYD_2432S028
  redrawEmergencyButton();
#endif
}

#else

void HubDisplay::begin() {}

void HubDisplay::showBoot() {}

void HubDisplay::showWifiConnecting(
    const String&) {}

void HubDisplay::showWifiConnected(
    const String&,
    uint16_t) {}

void HubDisplay::showWifiFailed() {}

void HubDisplay::showCommandCenter(
    const String&,
    uint16_t,
    bool) {}

void HubDisplay::showEmergencyStopActive(
    bool) {}

void HubDisplay::loop() {}

bool HubDisplay::takeEmergencyStopRequest() {
  return false;
}

#endif
