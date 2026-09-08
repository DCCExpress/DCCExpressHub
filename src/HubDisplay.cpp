#include "HubDisplay.h"

#if HUB_USE_DISPLAY

void HubDisplay::begin() {
  _display.begin();

#if HUB_DISPLAY_M5STACK_BASIC
  // The M5Stack ILI9342C panel needs normal landscape (rotation 1) and
  // inversion ON. The original low-level init leaves it inverse-landscape
  // with inverted/white-looking colours on this panel revision.
  _display.configureForHub();
#endif

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

#if HUB_DISPLAY_M5STACK_BASIC
  _display.setTextSize(
      1);
#endif

  _display.println(
      "WiFi...");

  _display.println(
      ssid);

  redrawControlButtons();
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

  if (_initialized) {
    redrawEmergencyButton();
  }
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

  if (_initialized) {
    redrawPowerButton();
  }
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

bool HubDisplay::takeInfoRequest() {
  const bool pending =
      _infoRequest;

  _infoRequest =
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
    case CydIli9341Display::TouchButton::Power:
      _powerToggleRequest =
          true;
      break;

    case CydIli9341Display::TouchButton::Emergency:
      _emergencyStopRequest =
          true;
      break;

    case CydIli9341Display::TouchButton::Info:
      _infoRequest =
          true;
      break;

    case CydIli9341Display::TouchButton::None:
    default:
      break;
  }
#elif HUB_DISPLAY_M5STACK_BASIC
  switch (
      _display
          .takeButtonPress()
  ) {
    case MiniIli9342Display::PhysicalButton::Power:
      _powerToggleRequest =
          true;
      break;

    case MiniIli9342Display::PhysicalButton::Emergency:
      _emergencyStopRequest =
          true;
      break;

    case MiniIli9342Display::PhysicalButton::Info:
      _infoRequest =
          true;
      break;

    case MiniIli9342Display::PhysicalButton::None:
    default:
      break;
  }
#endif

  if (!_dirty) {
    return;
  }

  redraw();
}

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
      "PWR",
      _powerActive
          ? HubDisplayDevice::LIME
          : HubDisplayDevice::DARK_GREY,
      _powerActive
          ? HubDisplayDevice::BLACK
          : HubDisplayDevice::WHITE);
}

void HubDisplay::redrawInfoButton() {
  _display.drawInfoButton(
      "INFO",
      HubDisplayDevice::DARK_GREY,
      HubDisplayDevice::WHITE);
}

void HubDisplay::redrawControlButtons() {
  redrawPowerButton();
  redrawEmergencyButton();
  redrawInfoButton();
}

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

#if HUB_DISPLAY_M5STACK_BASIC
  // The M5 native 8x8 font at 2x cannot fit a full WEB/HOST IP:port line
  // inside 320 pixels. Keep the title large, but render status rows at 1x.
  _display.setTextSize(
      1);
#endif

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

  _display.setTextColor(
      _ccConnected
          ? HubDisplayDevice::LIME
          : HubDisplayDevice::RED,
      HubDisplayDevice::BLACK);

  _display.println(
      _ccConnected
          ? "CONNECTED"
          : "DISCONNECTED");

  _display.setTextColor(
      HubDisplayDevice::WHITE,
      HubDisplayDevice::BLACK);

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

  redrawControlButtons();
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

bool HubDisplay::takeInfoRequest() {
  return false;
}

#endif
