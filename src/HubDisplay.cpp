#include "HubDisplay.h"

#if HUB_USE_DISPLAY

#include <LittleFS.h>

#include "Logger.h"
#include "StorageManager.h"

namespace {

String formatBytesCompact(
    uint64_t bytes) {
  constexpr uint64_t KB = 1024ULL;
  constexpr uint64_t MB = 1024ULL * 1024ULL;
  constexpr uint64_t GB = 1024ULL * 1024ULL * 1024ULL;

  if (bytes >= GB) {
    const uint64_t tenths =
        bytes * 10ULL /
        GB;

    return
        String(
            static_cast<unsigned long>(
                tenths / 10ULL)) +
        "." +
        String(
            static_cast<unsigned long>(
                tenths % 10ULL)) +
        "G";
  }

  if (bytes >= MB) {
    const uint64_t tenths =
        bytes * 10ULL /
        MB;

    return
        String(
            static_cast<unsigned long>(
                tenths / 10ULL)) +
        "." +
        String(
            static_cast<unsigned long>(
                tenths % 10ULL)) +
        "M";
  }

  return
      String(
          static_cast<unsigned long>(
              bytes / KB)) +
      "K";
}

}

void HubDisplay::begin() {
#if HUB_DISPLAY_M5STACK_BASIC
  constexpr uint8_t M5STACK_SD_CS_PIN = 4;

  pinMode(
      M5STACK_SD_CS_PIN,
      OUTPUT);

  digitalWrite(
      M5STACK_SD_CS_PIN,
      HIGH);

  Logger::info(
      "M5Stack SD deselected before display init");
#endif

  Logger::info(
      "Display init starting");

  _display.begin();

  Logger::info(
      "Display init complete");

#if HUB_DISPLAY_M5STACK_BASIC
  _display.configureForHub();

  Logger::info(
      "SD init starting");

  StorageManager::instance().begin();

  Logger::info(
      "SD init complete");
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

  _infoPage =
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

#if HUB_DISPLAY_M5STACK_BASIC || HUB_DISPLAY_SUNTON_8048S043
  switch (
      _display
          .takeButtonPress()
  ) {
    case HubDisplayDevice::PhysicalButton::Power:
      _powerToggleRequest =
          true;
      break;

    case HubDisplayDevice::PhysicalButton::Emergency:
      _emergencyStopRequest =
          true;
      break;

    case HubDisplayDevice::PhysicalButton::Info:
      _infoPage =
          !_infoPage;

      _dirty =
          true;

      _infoRequest =
          true;
      break;

    case HubDisplayDevice::PhysicalButton::None:
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
      _infoPage
          ? "BACK"
          : "INFO",
      HubDisplayDevice::DARK_GREY,
      HubDisplayDevice::WHITE);
}

void HubDisplay::redrawControlButtons() {
  redrawPowerButton();
  redrawEmergencyButton();
  redrawInfoButton();
}

void HubDisplay::redrawInfoPage() {
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
      "DCCExpressHub INFO");

  _display.println();

  _display.print(
      "Heap: ");

  _display.print(
      static_cast<uint32_t>(
          ESP.getFreeHeap() /
          1024U));

  _display.println(
      " KB");

  const uint64_t flashUsed =
      LittleFS.usedBytes();

  const uint64_t flashTotal =
      LittleFS.totalBytes();

  _display.print(
      "Flash: ");

  _display.print(
      formatBytesCompact(
          flashUsed));

  _display.print(
      "/");

  _display.println(
      formatBytesCompact(
          flashTotal));

  StorageManager& storage =
      StorageManager::instance();

  _display.print(
      "SD: ");

  if (!storage.sdAvailable()) {
    _display.setTextColor(
        HubDisplayDevice::RED,
        HubDisplayDevice::BLACK);

    _display.println(
        "NOT PRESENT");

    _display.setTextColor(
        HubDisplayDevice::WHITE,
        HubDisplayDevice::BLACK);
  } else {
    _display.setTextColor(
        HubDisplayDevice::LIME,
        HubDisplayDevice::BLACK);

    _display.println(
        storage.sdCardTypeName());

    _display.setTextColor(
        HubDisplayDevice::WHITE,
        HubDisplayDevice::BLACK);

    _display.print(
        "Size: ");

    _display.println(
        formatBytesCompact(
            storage.sdCardSizeBytes()));

    _display.print(
        "Used: ");

    _display.print(
        formatBytesCompact(
            storage.usedBytes(
                StorageMedium::SdCard)));

    _display.print(
        " Free: ");

    _display.println(
        formatBytesCompact(
            storage.freeBytes(
                StorageMedium::SdCard)));
  }

  redrawControlButtons();
}

void HubDisplay::redraw() {
  if (!_initialized) {
    return;
  }

  _dirty =
      false;

#if HUB_DISPLAY_M5STACK_BASIC || HUB_DISPLAY_SUNTON_8048S043
  if (_infoPage) {
    redrawInfoPage();
    return;
  }
#endif

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
