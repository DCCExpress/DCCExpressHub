#pragma once

#include <Arduino.h>

#ifndef HUB_DISPLAY_WAVESHARE_S3_LCD7
#define HUB_DISPLAY_WAVESHARE_S3_LCD7 0
#endif

#if HUB_DISPLAY_WAVESHARE_S3_LCD7

#include <esp_display_panel.hpp>
#include <lvgl.h>

class WaveshareS3Lcd7Display {
public:
  enum class TouchButton : uint8_t {
    None,
    Power,
    Emergency,
    Info
  };

  static constexpr uint16_t BLACK = 0x0000;
  static constexpr uint16_t WHITE = 0xFFFF;
  static constexpr uint16_t RED = 0xF800;
  static constexpr uint16_t LIME = 0x07E0;
  static constexpr uint16_t DARK_GREY = 0x4208;

  void begin();

  // Waveshare-only dashboard statistic. App.cpp feeds the current number of
  // connected WebSocket/browser clients without changing the legacy displays.
  static void setConnectedWebClients(size_t count);

  // Waveshare-only dashboard telemetry. Updated at a deliberately low rate
  // from App.cpp so the display gains useful health/runtime information
  // without introducing new network traffic or aggressive UI polling.
  static void setDashboardSystemStats(
      uint32_t freeHeapBytes,
      uint32_t freePsramBytes,
      uint32_t uptimeMs,
      size_t accessoryCount,
      size_t sensorCount,
      size_t blockCount);

  // Legacy HubDisplay drawing API. On the Waveshare target these functions no
  // longer paint pixels directly: they feed the LVGL dashboard state. Keeping
  // the same interface means M5Stack/CYD code paths remain untouched.
  void clear(uint16_t color = BLACK);
  void setCursor(int16_t x, int16_t y);
  void setTextSize(uint8_t size);
  void setTextColor(uint16_t foreground, uint16_t background = BLACK);
  void print(const String& text);
  void print(const char* text);
  void print(uint32_t value);
  void println();
  void println(const String& text);
  void println(const char* text);
  void println(uint32_t value);

  void drawEmergencyButton(const char* label, uint16_t fillColor);
  void drawPowerButton(
      const char* label,
      uint16_t fillColor,
      uint16_t textColor = WHITE);
  void drawInfoButton(
      const char* label,
      uint16_t fillColor,
      uint16_t textColor = WHITE);

  TouchButton takeButtonPress();

private:
  enum class Page : uint8_t {
    Dashboard = 0,
    Control = 1,
    Sensors = 2,
    System = 3
  };

  static constexpr int SCREEN_WIDTH = 800;
  static constexpr int SCREEN_HEIGHT = 480;
  static constexpr int I2C_SDA = 8;
  static constexpr int I2C_SCL = 9;
  static constexpr uint32_t I2C_HZ = 100000UL;

  esp_panel::board::Board* _board = nullptr;
  esp_panel::drivers::LCD* _lcd = nullptr;
  esp_panel::drivers::Touch* _touch = nullptr;
  lv_disp_t* _lvglDisplay = nullptr;
  lv_indev_t* _lvglTouch = nullptr;

  bool _initialized = false;
  volatile uint8_t _pendingTouchButton =
      static_cast<uint8_t>(TouchButton::None);

  // State mirrored from the existing HubDisplay text/status calls.
  bool _wifiConnected = false;
  bool _wifiConnecting = false;
  bool _ccConnected = false;
  bool _s88Known = false;
  bool _s88Connected = false;
  bool _powerActive = false;
  bool _emergencyActive = false;
  String _wifiIp = "-";
  String _wifiSsid = "";
  String _ccEndpoint = "-";
  String _s88Address = "-";
  uint8_t _webClientCount = 0;
  uint32_t _freeHeapBytes = 0;
  uint32_t _freePsramBytes = 0;
  uint32_t _uptimeMs = 0;
  size_t _runtimeAccessoryCount = 0;
  size_t _runtimeSensorCount = 0;
  size_t _runtimeBlockCount = 0;

  // Legacy text-capture parser.
  String _legacyLine;
  bool _expectWifiSsid = false;
  bool _expectCcEndpoint = false;

  // Root UI objects.
  lv_obj_t* _screen = nullptr;
  lv_obj_t* _topBar = nullptr;
  lv_obj_t* _wifiChip = nullptr;
  lv_obj_t* _wifiChipLabel = nullptr;
  lv_obj_t* _ccChip = nullptr;
  lv_obj_t* _ccChipLabel = nullptr;
  lv_obj_t* _s88Chip = nullptr;
  lv_obj_t* _s88ChipLabel = nullptr;
  lv_obj_t* _topPowerButton = nullptr;
  lv_obj_t* _topPowerLabel = nullptr;
  lv_obj_t* _topEmergencyButton = nullptr;
  lv_obj_t* _topEmergencyLabel = nullptr;

  lv_obj_t* _pages[4] = {nullptr, nullptr, nullptr, nullptr};
  lv_obj_t* _navButtons[4] = {nullptr, nullptr, nullptr, nullptr};
  Page _page = Page::Dashboard;

  // Dashboard.
  lv_obj_t* _dashCcStatus = nullptr;
  lv_obj_t* _dashCcEndpoint = nullptr;
  lv_obj_t* _dashS88Status = nullptr;
  lv_obj_t* _dashS88Address = nullptr;
  lv_obj_t* _dashWifiValue = nullptr;
  lv_obj_t* _dashWifiClients = nullptr;
  lv_obj_t* _dashWifiHost = nullptr;
  lv_obj_t* _dashRuntimeState = nullptr;
  lv_obj_t* _dashRuntimeAccessories = nullptr;
  lv_obj_t* _dashRuntimeSensors = nullptr;
  lv_obj_t* _dashRuntimeBlocks = nullptr;
  lv_obj_t* _dashSystemHealth = nullptr;
  lv_obj_t* _dashSystemHeap = nullptr;
  lv_obj_t* _dashSystemPsram = nullptr;
  lv_obj_t* _dashSystemUptime = nullptr;

  // Control page.
  lv_obj_t* _controlPowerButton = nullptr;
  lv_obj_t* _controlPowerLabel = nullptr;
  lv_obj_t* _controlEmergencyButton = nullptr;
  lv_obj_t* _controlEmergencyLabel = nullptr;
  lv_obj_t* _controlCcValue = nullptr;

  // Sensors page.
  lv_obj_t* _sensorHeadline = nullptr;
  lv_obj_t* _sensorAddressLabel = nullptr;
  lv_obj_t* _sensorStateLabel = nullptr;

  // System page / keyboard touch test.
  lv_obj_t* _systemWifiValue = nullptr;
  lv_obj_t* _systemCcValue = nullptr;
  lv_obj_t* _systemS88Value = nullptr;
  lv_obj_t* _systemTouchButton = nullptr;
  lv_obj_t* _systemInfoButton = nullptr;
  lv_obj_t* _keyboardOverlay = nullptr;
  lv_obj_t* _keyboardTextArea = nullptr;
  lv_obj_t* _keyboard = nullptr;

  void buildUi();
  void buildTopBar();
  void buildNavigation();
  void buildDashboardPage();
  void buildControlPage();
  void buildSensorsPage();
  void buildSystemPage();
  void buildKeyboardOverlay();

  void showPage(Page page);
  void showKeyboardTest(bool show);
  void refreshUi();
  void refreshStatusChips();
  void refreshActionButtons();
  void processLegacyLine(const String& line);
  void appendLegacyText(const String& text, bool newline);
  void queueTouchButton(TouchButton button);

  static void navEvent(lv_event_t* event);
  static void actionEvent(lv_event_t* event);
  static void keyboardEvent(lv_event_t* event);

  static lv_color_t color(uint32_t rgb);
  static void stylePanel(lv_obj_t* object, uint32_t background, uint32_t border);
  static lv_obj_t* makeLabel(
      lv_obj_t* parent,
      const char* text,
      const lv_font_t* font,
      uint32_t rgb);
  static lv_obj_t* makeCard(
      lv_obj_t* parent,
      int x,
      int y,
      int width,
      int height,
      uint32_t background = 0x0F1A2A,
      uint32_t border = 0x1D2D42);
  static lv_obj_t* makeButton(
      lv_obj_t* parent,
      int x,
      int y,
      int width,
      int height,
      const char* text,
      lv_obj_t** labelOut);
};

#endif
