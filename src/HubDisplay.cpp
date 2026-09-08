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
  redrawControlButtons();
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
  if (_initialized) {
    redrawEmergencyButton();
  }
#endif
}

void HubDisplay::showPowerActive(
    bool active) {
  if (
      _powerActive ==
      active
  ) {
    return;
  }

  _powerActive =
      active;

#if HUB_DISPLAY_CYD_2432S028
  if (_initialized) {
    redrawPowerButton();
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

bool HubDisplay::takePowerToggleRequest() {
  const bool pending =
      _powerToggleRequest;

  _powerToggleRequest =
      false;

  return pending;
}

void HubDisplay::loop() {
  if (!_initialized) {
    return;
  }

#if HUB_DISPLAY_CYD_2432S028
  switch (
      _display
          .takeButtonPress()
  ) {
    case CydIli9341Display::TouchButton::Emergency:
      _emergencyStopRequest =
          true;
      break;

    case CydIli9341Display::TouchButton::Power:
      _powerToggleRequest =
          true;
      break;

    case CydIli9341Display::TouchButton::None:
    default:
      break;
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
      _emergencyStopActive
          ? "RESUME"
          : "E-STOP",
      _emergencyStopActive
          ? HubDisplayDevice::RED
          : HubDisplayDevice::DARK_GREY);
}

void HubDisplay::redrawPowerButton() {
  _display.drawPowerButton(
      "POWER",
      _powerActive
          ? HubDisplayDevice::LIME
          : HubDisplayDevice::DARK_GREY,
      _powerActive
          ? HubDisplayDevice::BLACK
          : HubDisplayDevice::WHITE);
}

void HubDisplay::redrawControlButtons() {
  redrawEmergencyButton();
  redrawPowerButton();
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

#if HUB_DISPLAY_CYD_2432S028
  _display.setTextColor(
      _ccConnected
          ? HubDisplayDevice::LIME
          : HubDisplayDevice::RED,
      HubDisplayDevice::BLACK);
#endif

  _display.println(
      _ccConnected
          ? "CONNECTED"
          : "DISCONNECTED");

#if HUB_DISPLAY_CYD_2432S028
  _display.setTextColor(
      HubDisplayDevice::WHITE,
      HubDisplayDevice::BLACK);
#endif

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
  redrawControlButtons();
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

void HubDisplay::showPowerActive(
    bool) {}

void HubDisplay::loop() {}

bool HubDisplay::takeEmergencyStopRequest() {
  return false;
}

bool HubDisplay::takePowerToggleRequest() {
  return false;
}

#endif
