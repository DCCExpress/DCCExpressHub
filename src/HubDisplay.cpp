#include "HubDisplay.h"

#if HUB_USE_DISPLAY

namespace {

String formatI2CAddress(
    uint8_t address) {
  char buffer[5];

  snprintf(
      buffer,
      sizeof(buffer),
      "0x%02X",
      address);

  return String(buffer);
}

}

void HubDisplay::begin() {
  _display.begin();

#if HUB_DISPLAY_M5STACK_BASIC
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

  _s88Address =
      0;

  _s88Connected =
      false;

  _s88StatusKnown =
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

  _display.setTextSize(
      2);

  _display.setTextColor(
      HubDisplayDevice::WHITE,
      HubDisplayDevice::BLACK);

  _display.println(
      "DCCExpressHub");

  _display.println();

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

void HubDisplay::showS88Status(
    uint8_t address,
    bool connected) {
  if (!_initialized) {
    return;
  }

  if (
      _s88StatusKnown &&
      _s88Address == address &&
      _s88Connected == connected
  ) {
    return;
  }

  _s88Address =
      address;

  _s88Connected =
      connected;

  _s88StatusKnown =
      true;

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

#if HUB_DISPLAY_WAVESHARE_S3_LCD7
  switch (
      _display
          .takeButtonPress()
  ) {
    case WaveshareS3Lcd7Display::TouchButton::Power:
      _powerToggleRequest =
          true;
      break;

    case WaveshareS3Lcd7Display::TouchButton::Emergency:
      _emergencyStopRequest =
          true;
      break;

    case WaveshareS3Lcd7Display::TouchButton::Info:
      _infoRequest =
          true;
      break;

    case WaveshareS3Lcd7Display::TouchButton::None:
    default:
      break;
  }
#elif HUB_DISPLAY_CYD_2432S028
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

  // Keep the whole status area readable on the 320x240 M5Stack display.
  // Shorter rows are preferable to tiny text.
  _display.setTextSize(
      2);

  _display.setTextColor(
      HubDisplayDevice::WHITE,
      HubDisplayDevice::BLACK);

  _display.println(
      "DCCExpressHub");

  _display.println();

  // WEB
  _display.print(
      "WEB: ");

  if (
      _ip.length() &&
      _ip !=
          "NOT CONNECTED"
  ) {
    _display.println(
        _ip);
  } else {
    _display.setTextColor(
        HubDisplayDevice::RED,
        HubDisplayDevice::BLACK);

    _display.println(
        "NOK");

    _display.setTextColor(
        HubDisplayDevice::WHITE,
        HubDisplayDevice::BLACK);
  }

  // Command center state.
  _display.print(
      "CC: ");

  _display.setTextColor(
      _ccConnected
          ? HubDisplayDevice::LIME
          : HubDisplayDevice::RED,
      HubDisplayDevice::BLACK);

  _display.println(
      _ccConnected
          ? "OK"
          : "NOK");

  _display.setTextColor(
      HubDisplayDevice::WHITE,
      HubDisplayDevice::BLACK);

  // Host gets its own row so the large text remains readable.
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

  // S88 I2C adapter state.
  _display.print(
      "S88: ");

  if (_s88StatusKnown) {
    _display.print(
        formatI2CAddress(
            _s88Address));

    _display.print(
        " ");

    _display.setTextColor(
        _s88Connected
            ? HubDisplayDevice::LIME
            : HubDisplayDevice::RED,
        HubDisplayDevice::BLACK);

    _display.println(
        _s88Connected
            ? "OK"
            : "NOK");

    _display.setTextColor(
        HubDisplayDevice::WHITE,
        HubDisplayDevice::BLACK);
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

void HubDisplay::showS88Status(
    uint8_t,
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
