#include "WaveshareS3Lcd7Display.h"

#if HUB_DISPLAY_WAVESHARE_S3_LCD7

#include <Wire.h>
#include <algorithm>

#include "WaveshareLvglAdapter.h"

using esp_panel::drivers::BusI2C;
using esp_panel::drivers::BusRGB;

namespace {

WaveshareS3Lcd7Display* g_activeWaveshareDisplay = nullptr;

constexpr uint32_t COLOR_BG = 0x07111E;
constexpr uint32_t COLOR_PANEL = 0x0E1A2A;
constexpr uint32_t COLOR_PANEL_ALT = 0x111F31;
constexpr uint32_t COLOR_BORDER = 0x20344D;
constexpr uint32_t COLOR_TEXT = 0xF3F7FC;
constexpr uint32_t COLOR_MUTED = 0x8EA1B8;
constexpr uint32_t COLOR_BLUE = 0x37A1FF;
constexpr uint32_t COLOR_GREEN = 0x35D07F;
constexpr uint32_t COLOR_GREEN_DARK = 0x143B2A;
constexpr uint32_t COLOR_RED = 0xFF4D5D;
constexpr uint32_t COLOR_RED_DARK = 0x461923;
constexpr uint32_t COLOR_AMBER = 0xFFB84D;
constexpr uint32_t COLOR_AMBER_DARK = 0x493516;
constexpr uint32_t COLOR_GREY_CHIP = 0x19283B;

void setObjectText(lv_obj_t* label, const String& text) {
  if (label) {
    lv_label_set_text(label, text.c_str());
  }
}

String formatEventTime(uint32_t timestampMs) {
  const uint32_t totalSeconds = timestampMs / 1000UL;
  const uint32_t hours = (totalSeconds / 3600UL) % 100UL;
  const uint32_t minutes = (totalSeconds / 60UL) % 60UL;
  const uint32_t seconds = totalSeconds % 60UL;

  char text[16];
  snprintf(
      text,
      sizeof(text),
      "%02lu:%02lu:%02lu",
      static_cast<unsigned long>(hours),
      static_cast<unsigned long>(minutes),
      static_cast<unsigned long>(seconds));
  return String(text);
}

}  // namespace

lv_color_t WaveshareS3Lcd7Display::color(uint32_t rgb) {
  return lv_color_hex(rgb);
}

void WaveshareS3Lcd7Display::stylePanel(
    lv_obj_t* object,
    uint32_t background,
    uint32_t border) {
  if (!object) {
    return;
  }

  lv_obj_set_style_bg_color(object, color(background), 0);
  lv_obj_set_style_bg_opa(object, LV_OPA_COVER, 0);
  lv_obj_set_style_border_color(object, color(border), 0);
  lv_obj_set_style_border_width(object, 1, 0);
  lv_obj_set_style_radius(object, 18, 0);
  lv_obj_set_style_pad_all(object, 0, 0);
  lv_obj_set_style_shadow_width(object, 0, 0);
}

lv_obj_t* WaveshareS3Lcd7Display::makeLabel(
    lv_obj_t* parent,
    const char* text,
    const lv_font_t* font,
    uint32_t rgb) {
  lv_obj_t* label = lv_label_create(parent);
  lv_label_set_text(label, text);
  lv_obj_set_style_text_color(label, color(rgb), 0);
  lv_obj_set_style_text_font(label, font, 0);
  return label;
}

lv_obj_t* WaveshareS3Lcd7Display::makeCard(
    lv_obj_t* parent,
    int x,
    int y,
    int width,
    int height,
    uint32_t background,
    uint32_t border) {
  lv_obj_t* card = lv_obj_create(parent);
  lv_obj_set_pos(card, x, y);
  lv_obj_set_size(card, width, height);
  stylePanel(card, background, border);
  lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);
  return card;
}

lv_obj_t* WaveshareS3Lcd7Display::makeButton(
    lv_obj_t* parent,
    int x,
    int y,
    int width,
    int height,
    const char* text,
    lv_obj_t** labelOut) {
  lv_obj_t* button = lv_btn_create(parent);
  lv_obj_set_pos(button, x, y);
  lv_obj_set_size(button, width, height);
  lv_obj_set_style_radius(button, 18, 0);
  lv_obj_set_style_border_width(button, 1, 0);
  lv_obj_set_style_border_color(button, color(COLOR_BORDER), 0);
  lv_obj_set_style_bg_color(button, color(COLOR_PANEL_ALT), 0);
  lv_obj_set_style_bg_opa(button, LV_OPA_COVER, 0);
  lv_obj_set_style_shadow_width(button, 0, 0);

  lv_obj_t* label = makeLabel(
      button,
      text,
      &lv_font_montserrat_20,
      COLOR_TEXT);
  lv_obj_center(label);

  if (labelOut) {
    *labelOut = label;
  }

  return button;
}

void WaveshareS3Lcd7Display::begin() {
  if (_initialized) {
    return;
  }

  Serial.println("Waveshare HMI: starting shared I2C on GPIO8/GPIO9");

  if (!Wire.begin(I2C_SDA, I2C_SCL, I2C_HZ)) {
    Serial.println("Waveshare HMI: Wire.begin failed");
    return;
  }

  _board = new esp_panel::board::Board();
  if (!_board || !_board->init()) {
    Serial.println("Waveshare HMI: board init failed");
    return;
  }

  _lcd = _board->getLCD();
  _touch = _board->getTouch();

  if (!_lcd) {
    Serial.println("Waveshare HMI: LCD driver missing");
    return;
  }

  if (_touch) {
    auto* touchBus = static_cast<BusI2C*>(_touch->getBus());
    if (!touchBus->configI2C_HostSkipInit()) {
      Serial.println("Waveshare HMI: touch shared-I2C configuration failed");
      return;
    }
  }

  auto* expander = _board->getIO_Expander();
  if (expander && !expander->skipInitHost()) {
    Serial.println("Waveshare HMI: CH422G shared-I2C configuration failed");
    return;
  }

  auto* lcdBus = _lcd->getBus();
  if (
      lcdBus &&
      lcdBus->getBasicAttributes().type == ESP_PANEL_BUS_TYPE_RGB
  ) {
    _lcd->configFrameBufferNumber(1);

    auto* rgbBus = static_cast<BusRGB*>(lcdBus);
    rgbBus->configRGB_BounceBufferSize(
        static_cast<size_t>(_lcd->getFrameWidth()) * 10U);

    Serial.println("Waveshare HMI: using stock 16 MHz RGB PCLK");
  }

  if (!_board->begin()) {
    Serial.println("Waveshare HMI: board begin failed");
    return;
  }

  WaveshareLvglAdapterConfig adapterConfig;
  adapterConfig.tickPeriodMs = 5;
  adapterConfig.minDelayMs = 10;
  adapterConfig.maxDelayMs = 50;

  if (!waveshareLvglInit(adapterConfig)) {
    Serial.println("Waveshare HMI: LVGL init failed");
    return;
  }

  if (
      !waveshareLvglRegister(
          _lcd,
          _touch,
          &_lvglDisplay,
          &_lvglTouch)
  ) {
    Serial.println("Waveshare HMI: LVGL display/touch registration failed");
    return;
  }

  g_activeWaveshareDisplay = this;

  if (!waveshareLvglLock()) {
    Serial.println("Waveshare HMI: LVGL lock failed before UI build");
    return;
  }

  buildUi();
  refreshUi();
  waveshareLvglUnlock();

  if (!waveshareLvglStart()) {
    Serial.println("Waveshare HMI: LVGL task start failed");
    return;
  }

  _initialized = true;

  Serial.printf(
      "Waveshare HMI: ready 800x480 LVGL, touch=%s\n",
      _lvglTouch ? "GT911 direct-Wire input registered" : "NOT AVAILABLE");
}

void WaveshareS3Lcd7Display::buildUi() {
  _screen = lv_scr_act();
  lv_obj_set_style_bg_color(_screen, color(COLOR_BG), 0);
  lv_obj_set_style_bg_opa(_screen, LV_OPA_COVER, 0);
  lv_obj_clear_flag(_screen, LV_OBJ_FLAG_SCROLLABLE);

  buildTopBar();

  for (int i = 0; i < 4; ++i) {
    _pages[i] = lv_obj_create(_screen);
    lv_obj_set_pos(_pages[i], 10, 72);
    lv_obj_set_size(_pages[i], 780, 330);
    lv_obj_set_style_bg_opa(_pages[i], LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(_pages[i], 0, 0);
    lv_obj_set_style_pad_all(_pages[i], 0, 0);
    lv_obj_clear_flag(_pages[i], LV_OBJ_FLAG_SCROLLABLE);
  }

  buildDashboardPage();
  buildSensorsPage();
  buildBlocksPage();
  buildEventsPage();
  buildNavigation();

  showPage(Page::Dashboard);
}

void WaveshareS3Lcd7Display::buildTopBar() {
  _topBar = makeCard(
      _screen,
      10,
      8,
      780,
      54,
      0x0B1726,
      COLOR_BORDER);

  lv_obj_t* title = makeLabel(
      _topBar,
      "DCCExpressHub",
      &lv_font_montserrat_24,
      COLOR_TEXT);
  lv_obj_set_pos(title, 18, 7);

  lv_obj_t* subtitle = makeLabel(
      _topBar,
      "RAILWAY CONTROL CENTER",
      &lv_font_montserrat_14,
      COLOR_MUTED);
  lv_obj_set_pos(subtitle, 18, 32);

  auto makeChip = [this](
                      int x,
                      int width,
                      const char* initialText,
                      lv_obj_t** chipOut,
                      lv_obj_t** labelOut) {
    lv_obj_t* chip = makeCard(
        _topBar,
        x,
        10,
        width,
        34,
        COLOR_GREY_CHIP,
        COLOR_BORDER);
    lv_obj_t* label = makeLabel(
        chip,
        initialText,
        &lv_font_montserrat_14,
        COLOR_MUTED);
    lv_obj_center(label);
    *chipOut = chip;
    *labelOut = label;
  };

  makeChip(318, 84, "WiFi --", &_wifiChip, &_wifiChipLabel);
  makeChip(408, 72, "CC --", &_ccChip, &_ccChipLabel);
  makeChip(486, 82, "S88 --", &_s88Chip, &_s88ChipLabel);

  _topPowerButton = makeButton(
      _topBar,
      574,
      10,
      90,
      34,
      "PWR OFF",
      &_topPowerLabel);
  lv_obj_set_style_radius(_topPowerButton, 12, 0);
  lv_obj_set_style_text_font(_topPowerLabel, &lv_font_montserrat_14, 0);
  lv_obj_add_event_cb(
      _topPowerButton,
      actionEvent,
      LV_EVENT_CLICKED,
      this);

  _topEmergencyButton = makeButton(
      _topBar,
      670,
      10,
      96,
      34,
      "E-STOP",
      &_topEmergencyLabel);
  lv_obj_set_style_radius(_topEmergencyButton, 12, 0);
  lv_obj_set_style_text_font(_topEmergencyLabel, &lv_font_montserrat_14, 0);
  lv_obj_add_event_cb(
      _topEmergencyButton,
      actionEvent,
      LV_EVENT_CLICKED,
      this);
}

void WaveshareS3Lcd7Display::buildDashboardPage() {
  lv_obj_t* page = _pages[static_cast<uint8_t>(Page::Dashboard)];

  lv_obj_t* ccCard = makeCard(page, 0, 0, 376, 112);
  makeLabel(ccCard, "COMMAND CENTER", &lv_font_montserrat_14, COLOR_MUTED);
  lv_obj_set_pos(lv_obj_get_child(ccCard, 0), 18, 14);
  _dashCcStatus = makeLabel(
      ccCard,
      "OFFLINE",
      &lv_font_montserrat_24,
      COLOR_RED);
  lv_obj_set_pos(_dashCcStatus, 18, 38);
  _dashCcEndpoint = makeLabel(
      ccCard,
      "-",
      &lv_font_montserrat_14,
      COLOR_MUTED);
  lv_obj_set_pos(_dashCcEndpoint, 18, 78);

  lv_obj_t* s88Card = makeCard(page, 392, 0, 376, 112);
  makeLabel(s88Card, "S88 FEEDBACK", &lv_font_montserrat_14, COLOR_MUTED);
  lv_obj_set_pos(lv_obj_get_child(s88Card, 0), 18, 14);
  _dashS88Status = makeLabel(
      s88Card,
      "WAITING",
      &lv_font_montserrat_24,
      COLOR_AMBER);
  lv_obj_set_pos(_dashS88Status, 18, 38);
  _dashS88Address = makeLabel(
      s88Card,
      "I2C -",
      &lv_font_montserrat_14,
      COLOR_MUTED);
  lv_obj_set_pos(_dashS88Address, 18, 78);

  lv_obj_t* wifiCard = makeCard(page, 0, 124, 244, 186);
  makeLabel(wifiCard, "NETWORK", &lv_font_montserrat_14, COLOR_MUTED);
  lv_obj_set_pos(lv_obj_get_child(wifiCard, 0), 18, 14);

  _dashWifiValue = makeLabel(
      wifiCard,
      "Starting...",
      &lv_font_montserrat_20,
      COLOR_TEXT);
  lv_obj_set_pos(_dashWifiValue, 18, 42);
  lv_obj_set_width(_dashWifiValue, 205);
  lv_label_set_long_mode(_dashWifiValue, LV_LABEL_LONG_DOT);

  _dashWifiClients = makeLabel(
      wifiCard,
      "Web clients: 0",
      &lv_font_montserrat_16,
      COLOR_GREEN);
  lv_obj_set_pos(_dashWifiClients, 18, 82);

  _dashWifiHost = makeLabel(
      wifiCard,
      "dccexpresshub.local",
      &lv_font_montserrat_14,
      COLOR_MUTED);
  lv_obj_set_pos(_dashWifiHost, 18, 116);
  lv_obj_set_width(_dashWifiHost, 205);
  lv_label_set_long_mode(_dashWifiHost, LV_LABEL_LONG_DOT);

  lv_obj_t* runtimeCard = makeCard(page, 260, 124, 244, 186);
  makeLabel(runtimeCard, "RUNTIME", &lv_font_montserrat_14, COLOR_MUTED);
  lv_obj_set_pos(lv_obj_get_child(runtimeCard, 0), 18, 14);

  _dashRuntimeState = makeLabel(
      runtimeCard,
      "LAYOUT ACTIVE",
      &lv_font_montserrat_20,
      COLOR_GREEN);
  lv_obj_set_pos(_dashRuntimeState, 18, 42);

  _dashRuntimeAccessories = makeLabel(
      runtimeCard,
      "Accessories: -",
      &lv_font_montserrat_16,
      COLOR_TEXT);
  lv_obj_set_pos(_dashRuntimeAccessories, 18, 82);

  _dashRuntimeSensors = makeLabel(
      runtimeCard,
      "Sensors: -",
      &lv_font_montserrat_14,
      COLOR_MUTED);
  lv_obj_set_pos(_dashRuntimeSensors, 18, 116);

  _dashRuntimeBlocks = makeLabel(
      runtimeCard,
      "Blocks: -",
      &lv_font_montserrat_14,
      COLOR_MUTED);
  lv_obj_set_pos(_dashRuntimeBlocks, 18, 142);

  lv_obj_t* systemCard = makeCard(page, 520, 124, 248, 186);
  makeLabel(systemCard, "SYSTEM HEALTH", &lv_font_montserrat_14, COLOR_MUTED);
  lv_obj_set_pos(lv_obj_get_child(systemCard, 0), 18, 14);

  _dashSystemHealth = makeLabel(
      systemCard,
      "HEALTHY",
      &lv_font_montserrat_20,
      COLOR_GREEN);
  lv_obj_set_pos(_dashSystemHealth, 18, 42);

  _dashSystemHeap = makeLabel(
      systemCard,
      "Heap: -",
      &lv_font_montserrat_14,
      COLOR_TEXT);
  lv_obj_set_pos(_dashSystemHeap, 18, 82);

  _dashSystemPsram = makeLabel(
      systemCard,
      "PSRAM: -",
      &lv_font_montserrat_14,
      COLOR_MUTED);
  lv_obj_set_pos(_dashSystemPsram, 18, 108);

  _dashSystemUptime = makeLabel(
      systemCard,
      "Uptime: -",
      &lv_font_montserrat_14,
      COLOR_MUTED);
  lv_obj_set_pos(_dashSystemUptime, 18, 134);
}

void WaveshareS3Lcd7Display::buildSensorsPage() {
  lv_obj_t* page = _pages[static_cast<uint8_t>(Page::Sensors)];

  lv_obj_t* title = makeLabel(
      page,
      "S88 Sensors",
      &lv_font_montserrat_28,
      COLOR_TEXT);
  lv_obj_set_pos(title, 2, 0);

  _sensorHeadline = makeLabel(
      page,
      "Waiting for S88 adapter",
      &lv_font_montserrat_14,
      COLOR_AMBER);
  lv_obj_set_pos(_sensorHeadline, 4, 38);

  _sensorAddressLabel = makeLabel(
      page,
      "I2C: -",
      &lv_font_montserrat_14,
      COLOR_MUTED);
  lv_obj_set_pos(_sensorAddressLabel, 250, 38);

  _sensorStateLabel = makeLabel(
      page,
      "0 configured",
      &lv_font_montserrat_14,
      COLOR_MUTED);
  lv_obj_set_pos(_sensorStateLabel, 385, 38);

  _sensorPrevButton = makeButton(
      page, 600, 4, 50, 42, "<", nullptr);
  _sensorNextButton = makeButton(
      page, 656, 4, 50, 42, ">", nullptr);
  _sensorPageLabel = makeLabel(
      page,
      "1/1",
      &lv_font_montserrat_14,
      COLOR_MUTED);
  lv_obj_set_pos(_sensorPageLabel, 716, 17);

  lv_obj_add_event_cb(_sensorPrevButton, actionEvent, LV_EVENT_CLICKED, this);
  lv_obj_add_event_cb(_sensorNextButton, actionEvent, LV_EVENT_CLICKED, this);

  for (size_t i = 0; i < SENSOR_PAGE_SIZE; ++i) {
    const int column = static_cast<int>(i % 8U);
    const int row = static_cast<int>(i / 8U);
    const int x = column * 96;
    const int y = 64 + row * 62;

    _sensorCells[i] = makeCard(
        page,
        x,
        y,
        88,
        54,
        COLOR_PANEL_ALT,
        COLOR_BORDER);

    _sensorCellLabels[i] = makeLabel(
        _sensorCells[i],
        "--\nFREE",
        &lv_font_montserrat_14,
        COLOR_MUTED);
    lv_obj_set_style_text_align(
        _sensorCellLabels[i],
        LV_TEXT_ALIGN_CENTER,
        0);
    lv_obj_center(_sensorCellLabels[i]);
  }
}

void WaveshareS3Lcd7Display::buildBlocksPage() {
  lv_obj_t* page = _pages[static_cast<uint8_t>(Page::Blocks)];

  lv_obj_t* title = makeLabel(
      page,
      "Blocks",
      &lv_font_montserrat_28,
      COLOR_TEXT);
  lv_obj_set_pos(title, 2, 0);

  _blockHeadline = makeLabel(
      page,
      "Live block occupancy / locomotive assignment",
      &lv_font_montserrat_14,
      COLOR_MUTED);
  lv_obj_set_pos(_blockHeadline, 4, 38);

  _blockPrevButton = makeButton(
      page, 600, 4, 50, 42, "<", nullptr);
  _blockNextButton = makeButton(
      page, 656, 4, 50, 42, ">", nullptr);
  _blockPageLabel = makeLabel(
      page,
      "1/1",
      &lv_font_montserrat_14,
      COLOR_MUTED);
  lv_obj_set_pos(_blockPageLabel, 716, 17);

  lv_obj_add_event_cb(_blockPrevButton, actionEvent, LV_EVENT_CLICKED, this);
  lv_obj_add_event_cb(_blockNextButton, actionEvent, LV_EVENT_CLICKED, this);

  for (size_t i = 0; i < BLOCK_PAGE_SIZE; ++i) {
    const int column = static_cast<int>(i % 2U);
    const int row = static_cast<int>(i / 2U);
    const int x = column * 392;
    const int y = 64 + row * 62;

    _blockRows[i] = makeCard(
        page,
        x,
        y,
        376,
        54,
        COLOR_PANEL_ALT,
        COLOR_BORDER);

    _blockIdLabels[i] = makeLabel(
        _blockRows[i],
        "BLOCK --",
        &lv_font_montserrat_16,
        COLOR_TEXT);
    lv_obj_set_pos(_blockIdLabels[i], 14, 8);

    _blockStateLabels[i] = makeLabel(
        _blockRows[i],
        "FREE",
        &lv_font_montserrat_14,
        COLOR_GREEN);
    lv_obj_set_pos(_blockStateLabels[i], 14, 30);

    _blockLocoLabels[i] = makeLabel(
        _blockRows[i],
        "",
        &lv_font_montserrat_14,
        COLOR_MUTED);
    lv_obj_set_width(_blockLocoLabels[i], 190);
    lv_label_set_long_mode(_blockLocoLabels[i], LV_LABEL_LONG_DOT);
    lv_obj_align(_blockLocoLabels[i], LV_ALIGN_RIGHT_MID, -14, 0);
  }
}

void WaveshareS3Lcd7Display::buildEventsPage() {
  lv_obj_t* page = _pages[static_cast<uint8_t>(Page::Events)];

  lv_obj_t* title = makeLabel(
      page,
      "Events",
      &lv_font_montserrat_28,
      COLOR_TEXT);
  lv_obj_set_pos(title, 2, 0);

  _eventHeadline = makeLabel(
      page,
      "Recent railway runtime events",
      &lv_font_montserrat_14,
      COLOR_MUTED);
  lv_obj_set_pos(_eventHeadline, 4, 38);

  _eventClearButton = makeButton(
      page,
      650,
      4,
      118,
      42,
      "CLEAR",
      nullptr);
  lv_obj_add_event_cb(_eventClearButton, actionEvent, LV_EVENT_CLICKED, this);

  for (size_t i = 0; i < EVENT_VISIBLE_ROWS; ++i) {
    const int y = 64 + static_cast<int>(i) * 30;

    _eventRows[i] = makeCard(
        page,
        0,
        y,
        768,
        26,
        (i % 2U == 0U) ? COLOR_PANEL : COLOR_PANEL_ALT,
        COLOR_BORDER);
    lv_obj_set_style_radius(_eventRows[i], 8, 0);

    _eventTimeLabels[i] = makeLabel(
        _eventRows[i],
        "--:--:--",
        &lv_font_montserrat_14,
        COLOR_MUTED);
    lv_obj_set_pos(_eventTimeLabels[i], 10, 5);

    _eventTextLabels[i] = makeLabel(
        _eventRows[i],
        "",
        &lv_font_montserrat_14,
        COLOR_TEXT);
    lv_obj_set_pos(_eventTextLabels[i], 92, 5);
    lv_obj_set_width(_eventTextLabels[i], 660);
    lv_label_set_long_mode(_eventTextLabels[i], LV_LABEL_LONG_DOT);
  }
}

void WaveshareS3Lcd7Display::buildNavigation() {
  lv_obj_t* nav = makeCard(
      _screen,
      10,
      412,
      780,
      60,
      0x0B1726,
      COLOR_BORDER);

  const char* names[4] = {
      "DASHBOARD",
      "SENSORS",
      "BLOCKS",
      "EVENTS"
  };

  for (int i = 0; i < 4; ++i) {
    lv_obj_t* label = nullptr;
    _navButtons[i] = makeButton(
        nav,
        8 + i * 192,
        7,
        184,
        46,
        names[i],
        &label);
    lv_obj_set_style_radius(_navButtons[i], 14, 0);
    lv_obj_set_style_text_font(label, &lv_font_montserrat_14, 0);
    lv_obj_add_event_cb(
        _navButtons[i],
        navEvent,
        LV_EVENT_CLICKED,
        this);
  }
}

void WaveshareS3Lcd7Display::showPage(Page page) {
  _page = page;

  for (int i = 0; i < 4; ++i) {
    if (!_pages[i]) {
      continue;
    }

    if (i == static_cast<int>(page)) {
      lv_obj_clear_flag(_pages[i], LV_OBJ_FLAG_HIDDEN);
    } else {
      lv_obj_add_flag(_pages[i], LV_OBJ_FLAG_HIDDEN);
    }

    if (_navButtons[i]) {
      const bool selected = i == static_cast<int>(page);
      lv_obj_set_style_bg_color(
          _navButtons[i],
          color(selected ? 0x143B5E : COLOR_PANEL_ALT),
          0);
      lv_obj_set_style_border_color(
          _navButtons[i],
          color(selected ? COLOR_BLUE : COLOR_BORDER),
          0);
    }
  }

  if (page == Page::Sensors) {
    refreshSensorsPage();
  } else if (page == Page::Blocks) {
    refreshBlocksPage();
  } else if (page == Page::Events) {
    refreshEventsPage();
  }
}

void WaveshareS3Lcd7Display::refreshStatusChips() {
  auto updateChip = [this](
                        lv_obj_t* chip,
                        lv_obj_t* label,
                        const String& text,
                        bool ok,
                        bool warning) {
    if (!chip || !label) {
      return;
    }

    const uint32_t background =
        ok
            ? COLOR_GREEN_DARK
            : (warning ? COLOR_AMBER_DARK : COLOR_RED_DARK);
    const uint32_t foreground =
        ok
            ? COLOR_GREEN
            : (warning ? COLOR_AMBER : COLOR_RED);

    lv_obj_set_style_bg_color(chip, color(background), 0);
    lv_obj_set_style_border_color(chip, color(foreground), 0);
    lv_obj_set_style_text_color(label, color(foreground), 0);
    setObjectText(label, text);
  };

  if (_wifiConnecting) {
    updateChip(_wifiChip, _wifiChipLabel, "WiFi ...", false, true);
  } else {
    updateChip(
        _wifiChip,
        _wifiChipLabel,
        _wifiConnected ? "WiFi ON" : "WiFi OFF",
        _wifiConnected,
        false);
  }

  updateChip(
      _ccChip,
      _ccChipLabel,
      _ccConnected ? "CC ON" : "CC OFF",
      _ccConnected,
      false);

  if (!_s88Known) {
    updateChip(_s88Chip, _s88ChipLabel, "S88 WAIT", false, true);
  } else {
    updateChip(
        _s88Chip,
        _s88ChipLabel,
        _s88Connected ? "S88 LIVE" : "S88 OFF",
        _s88Connected,
        false);
  }
}

void WaveshareS3Lcd7Display::refreshActionButtons() {
  if (_topPowerButton && _topPowerLabel) {
    lv_obj_set_style_bg_color(
        _topPowerButton,
        color(_powerActive ? COLOR_GREEN_DARK : COLOR_PANEL_ALT),
        0);
    lv_obj_set_style_border_color(
        _topPowerButton,
        color(_powerActive ? COLOR_GREEN : COLOR_BORDER),
        0);
    lv_obj_set_style_text_color(
        _topPowerLabel,
        color(_powerActive ? COLOR_GREEN : COLOR_TEXT),
        0);
    lv_label_set_text(
        _topPowerLabel,
        _powerActive ? "PWR ON" : "PWR OFF");
  }

  if (_topEmergencyButton && _topEmergencyLabel) {
    lv_obj_set_style_bg_color(
        _topEmergencyButton,
        color(_emergencyActive ? COLOR_RED : COLOR_RED_DARK),
        0);
    lv_obj_set_style_border_color(
        _topEmergencyButton,
        color(COLOR_RED),
        0);
    lv_obj_set_style_text_color(
        _topEmergencyLabel,
        color(_emergencyActive ? 0xFFFFFF : COLOR_RED),
        0);
    lv_label_set_text(
        _topEmergencyLabel,
        _emergencyActive ? "RESUME" : "E-STOP");
  }
}

void WaveshareS3Lcd7Display::refreshSensorsPage() {
  const size_t pages = std::max<size_t>(
      1U,
      (_sensorItemCount + SENSOR_PAGE_SIZE - 1U) / SENSOR_PAGE_SIZE);

  if (_sensorPage >= pages) {
    _sensorPage = pages - 1U;
  }

  setObjectText(
      _sensorPageLabel,
      String(static_cast<unsigned>(_sensorPage + 1U)) +
          "/" +
          String(static_cast<unsigned>(pages)));

  setObjectText(
      _sensorStateLabel,
      String(static_cast<unsigned>(_sensorItemCount)) +
          " configured");

  const size_t first = _sensorPage * SENSOR_PAGE_SIZE;

  for (size_t i = 0; i < SENSOR_PAGE_SIZE; ++i) {
    const size_t index = first + i;
    lv_obj_t* card = _sensorCells[i];
    lv_obj_t* label = _sensorCellLabels[i];

    if (!card || !label) {
      continue;
    }

    if (index >= _sensorItemCount) {
      setObjectText(label, "--\n-");
      lv_obj_set_style_bg_color(card, color(COLOR_PANEL_ALT), 0);
      lv_obj_set_style_border_color(card, color(COLOR_BORDER), 0);
      lv_obj_set_style_text_color(label, color(COLOR_MUTED), 0);
      continue;
    }

    const auto& item = _sensorItems[index];
    setObjectText(
        label,
        String(item.address) +
            (item.on ? "\nOCC" : "\nFREE"));

    lv_obj_set_style_bg_color(
        card,
        color(item.on ? COLOR_RED_DARK : COLOR_GREEN_DARK),
        0);
    lv_obj_set_style_border_color(
        card,
        color(item.on ? COLOR_RED : COLOR_GREEN),
        0);
    lv_obj_set_style_text_color(
        label,
        color(item.on ? COLOR_RED : COLOR_GREEN),
        0);
  }
}

void WaveshareS3Lcd7Display::refreshBlocksPage() {
  const size_t pages = std::max<size_t>(
      1U,
      (_blockItemCount + BLOCK_PAGE_SIZE - 1U) / BLOCK_PAGE_SIZE);

  if (_blockPage >= pages) {
    _blockPage = pages - 1U;
  }

  setObjectText(
      _blockPageLabel,
      String(static_cast<unsigned>(_blockPage + 1U)) +
          "/" +
          String(static_cast<unsigned>(pages)));

  setObjectText(
      _blockHeadline,
      String(static_cast<unsigned>(_blockItemCount)) +
          " blocks | live occupancy / locomotive assignment");

  const size_t first = _blockPage * BLOCK_PAGE_SIZE;

  for (size_t i = 0; i < BLOCK_PAGE_SIZE; ++i) {
    const size_t index = first + i;
    lv_obj_t* row = _blockRows[i];

    if (!row) {
      continue;
    }

    if (index >= _blockItemCount) {
      setObjectText(_blockIdLabels[i], "BLOCK --");
      setObjectText(_blockStateLabels[i], "-");
      setObjectText(_blockLocoLabels[i], "");
      lv_obj_set_style_bg_color(row, color(COLOR_PANEL_ALT), 0);
      lv_obj_set_style_border_color(row, color(COLOR_BORDER), 0);
      continue;
    }

    const auto& block = _blockItems[index];
    setObjectText(
        _blockIdLabels[i],
        String("BLOCK ") + String(block.id));

    const char* stateText =
        block.targetOnly
            ? "RESERVED"
            : (block.occupied ? "OCCUPIED" : "FREE");
    const uint32_t stateColor =
        block.targetOnly
            ? COLOR_AMBER
            : (block.occupied ? COLOR_RED : COLOR_GREEN);
    const uint32_t stateBg =
        block.targetOnly
            ? COLOR_AMBER_DARK
            : (block.occupied ? COLOR_RED_DARK : COLOR_GREEN_DARK);

    setObjectText(_blockStateLabels[i], stateText);
    lv_obj_set_style_text_color(
        _blockStateLabels[i],
        color(stateColor),
        0);
    lv_obj_set_style_bg_color(row, color(stateBg), 0);
    lv_obj_set_style_border_color(row, color(stateColor), 0);

    String locoText;
    if (block.locoAddress > 0) {
      locoText = String("LOCO #") + String(block.locoAddress);
    } else if (!block.locoId.isEmpty()) {
      locoText = block.targetOnly ? String("TARGET") : block.locoId;
    }
    setObjectText(_blockLocoLabels[i], locoText);
  }
}

void WaveshareS3Lcd7Display::refreshEventsPage() {
  setObjectText(
      _eventHeadline,
      _eventCount == 0
          ? String("No runtime events yet")
          : String(static_cast<unsigned>(_eventCount)) +
                " recent runtime events");

  for (size_t row = 0; row < EVENT_VISIBLE_ROWS; ++row) {
    if (row >= _eventCount) {
      setObjectText(_eventTimeLabels[row], "--:--:--");
      setObjectText(_eventTextLabels[row], "");
      continue;
    }

    const size_t index = _eventCount - 1U - row;
    setObjectText(
        _eventTimeLabels[row],
        formatEventTime(_events[index].timestampMs));
    setObjectText(
        _eventTextLabels[row],
        _events[index].text);
  }
}

void WaveshareS3Lcd7Display::refreshUi() {
  refreshStatusChips();
  refreshActionButtons();

  const String wifiText =
      _wifiConnecting
          ? String("Connecting") +
                (_wifiSsid.length() ? String(" to ") + _wifiSsid : String("..."))
          : (_wifiConnected ? _wifiIp : String("Not connected"));

  setObjectText(_dashWifiValue, wifiText);

  setObjectText(
      _dashWifiClients,
      String("Web clients: ") +
          String(static_cast<unsigned>(_webClientCount)));

  if (_dashWifiClients) {
    lv_obj_set_style_text_color(
        _dashWifiClients,
        color(_webClientCount > 0 ? COLOR_GREEN : COLOR_MUTED),
        0);
  }

  setObjectText(
      _dashCcStatus,
      _ccConnected ? "ONLINE" : "OFFLINE");
  if (_dashCcStatus) {
    lv_obj_set_style_text_color(
        _dashCcStatus,
        color(_ccConnected ? COLOR_GREEN : COLOR_RED),
        0);
  }
  setObjectText(_dashCcEndpoint, _ccEndpoint);

  if (!_s88Known) {
    setObjectText(_dashS88Status, "WAITING");
    if (_dashS88Status) {
      lv_obj_set_style_text_color(_dashS88Status, color(COLOR_AMBER), 0);
    }
    setObjectText(_sensorHeadline, "Waiting for S88 adapter");
    if (_sensorHeadline) {
      lv_obj_set_style_text_color(_sensorHeadline, color(COLOR_AMBER), 0);
    }
  } else if (_s88Connected) {
    setObjectText(_dashS88Status, "DATA LIVE");
    if (_dashS88Status) {
      lv_obj_set_style_text_color(_dashS88Status, color(COLOR_GREEN), 0);
    }
    setObjectText(_sensorHeadline, "S88 feedback bus live");
    if (_sensorHeadline) {
      lv_obj_set_style_text_color(_sensorHeadline, color(COLOR_GREEN), 0);
    }
  } else {
    setObjectText(_dashS88Status, "OFFLINE");
    if (_dashS88Status) {
      lv_obj_set_style_text_color(_dashS88Status, color(COLOR_RED), 0);
    }
    setObjectText(_sensorHeadline, "S88 adapter offline");
    if (_sensorHeadline) {
      lv_obj_set_style_text_color(_sensorHeadline, color(COLOR_RED), 0);
    }
  }

  setObjectText(
      _dashS88Address,
      String("I2C ") + _s88Address);
  setObjectText(
      _sensorAddressLabel,
      String("I2C: ") + _s88Address);

  const bool runtimeActive =
      _runtimeAccessoryCount > 0 ||
      _runtimeSensorCount > 0 ||
      _runtimeBlockCount > 0;

  setObjectText(
      _dashRuntimeState,
      runtimeActive ? "LAYOUT ACTIVE" : "LAYOUT EMPTY");
  if (_dashRuntimeState) {
    lv_obj_set_style_text_color(
        _dashRuntimeState,
        color(runtimeActive ? COLOR_GREEN : COLOR_AMBER),
        0);
  }

  setObjectText(
      _dashRuntimeAccessories,
      String("Accessories: ") +
          String(static_cast<unsigned>(_runtimeAccessoryCount)));
  setObjectText(
      _dashRuntimeSensors,
      String("Sensors: ") +
          String(static_cast<unsigned>(_runtimeSensorCount)));
  setObjectText(
      _dashRuntimeBlocks,
      String("Blocks: ") +
          String(static_cast<unsigned>(_runtimeBlockCount)));

  const bool heapHealthy = _freeHeapBytes >= 50000U;
  const bool heapWarning = _freeHeapBytes >= 25000U;

  setObjectText(
      _dashSystemHealth,
      heapHealthy
          ? "HEALTHY"
          : (heapWarning ? "MEMORY TIGHT" : "LOW MEMORY"));
  if (_dashSystemHealth) {
    lv_obj_set_style_text_color(
        _dashSystemHealth,
        color(
            heapHealthy
                ? COLOR_GREEN
                : (heapWarning ? COLOR_AMBER : COLOR_RED)),
        0);
  }

  setObjectText(
      _dashSystemHeap,
      String("Heap: ") +
          String(_freeHeapBytes / 1024U) +
          " KB");

  const uint32_t psramTenthsMb =
      static_cast<uint32_t>(
          (static_cast<uint64_t>(_freePsramBytes) * 10ULL) /
          (1024ULL * 1024ULL));

  setObjectText(
      _dashSystemPsram,
      String("PSRAM: ") +
          String(psramTenthsMb / 10U) +
          "." +
          String(psramTenthsMb % 10U) +
          " MB");

  const uint32_t uptimeMinutes = _uptimeMs / 60000UL;
  const uint32_t uptimeHours = uptimeMinutes / 60UL;
  const uint32_t uptimeDays = uptimeHours / 24UL;

  String uptimeText = "Uptime: ";
  if (uptimeDays > 0) {
    uptimeText += String(uptimeDays) + "d ";
  }
  uptimeText +=
      String(uptimeHours % 24UL) +
      "h " +
      String(uptimeMinutes % 60UL) +
      "m";
  setObjectText(_dashSystemUptime, uptimeText);

  refreshSensorsPage();
  refreshBlocksPage();
  refreshEventsPage();
}

void WaveshareS3Lcd7Display::copyRuntimeSnapshot(
    const RuntimeSensor* sensors,
    size_t sensorCount,
    const RuntimeBlock* blocks,
    size_t blockCount) {
  _sensorItemCount = std::min(sensorCount, MAX_MONITOR_SENSORS);
  for (size_t i = 0; i < _sensorItemCount; ++i) {
    _sensorItems[i].id = sensors[i].id;
    _sensorItems[i].address = sensors[i].address;
    _sensorItems[i].on = sensors[i].on;
  }

  std::sort(
      _sensorItems,
      _sensorItems + _sensorItemCount,
      [](const SensorMonitorItem& a, const SensorMonitorItem& b) {
        return a.address < b.address;
      });

  _blockItemCount = std::min(blockCount, MAX_MONITOR_BLOCKS);
  for (size_t i = 0; i < _blockItemCount; ++i) {
    _blockItems[i].id = blocks[i].id;
    _blockItems[i].locoId = blocks[i].locoId;
    _blockItems[i].locoAddress = blocks[i].locoAddress;
    _blockItems[i].occupied = blocks[i].occupied();
    _blockItems[i].targetOnly = blocks[i].targetOnly();
  }

  std::sort(
      _blockItems,
      _blockItems + _blockItemCount,
      [](const BlockMonitorItem& a, const BlockMonitorItem& b) {
        return a.id < b.id;
      });
}

void WaveshareS3Lcd7Display::addRuntimeEvent(
    const String& text,
    uint32_t timestampMs) {
  if (text.isEmpty()) {
    return;
  }

  if (_eventCount < MAX_EVENTS) {
    _events[_eventCount].text = text;
    _events[_eventCount].timestampMs = timestampMs;
    ++_eventCount;
    return;
  }

  for (size_t i = 1; i < MAX_EVENTS; ++i) {
    _events[i - 1U] = _events[i];
  }

  _events[MAX_EVENTS - 1U].text = text;
  _events[MAX_EVENTS - 1U].timestampMs = timestampMs;
}

void WaveshareS3Lcd7Display::setConnectedWebClients(size_t count) {
  WaveshareS3Lcd7Display* display = g_activeWaveshareDisplay;
  if (!display) {
    return;
  }

  const uint8_t boundedCount =
      static_cast<uint8_t>(std::min<size_t>(count, 255U));

  if (display->_webClientCount == boundedCount) {
    return;
  }

  display->_webClientCount = boundedCount;

  if (display->_initialized && waveshareLvglLock(0)) {
    display->refreshUi();
    waveshareLvglUnlock();
  }
}

void WaveshareS3Lcd7Display::setDashboardSystemStats(
    uint32_t freeHeapBytes,
    uint32_t freePsramBytes,
    uint32_t uptimeMs,
    size_t accessoryCount,
    size_t sensorCount,
    size_t blockCount) {
  WaveshareS3Lcd7Display* display = g_activeWaveshareDisplay;
  if (!display) {
    return;
  }

  display->_freeHeapBytes = freeHeapBytes;
  display->_freePsramBytes = freePsramBytes;
  display->_uptimeMs = uptimeMs;
  display->_runtimeAccessoryCount = accessoryCount;
  display->_runtimeSensorCount = sensorCount;
  display->_runtimeBlockCount = blockCount;

  if (display->_initialized && waveshareLvglLock(0)) {
    display->refreshUi();
    waveshareLvglUnlock();
  }
}

void WaveshareS3Lcd7Display::setRuntimeSnapshot(
    const RuntimeSensor* sensors,
    size_t sensorCount,
    const RuntimeBlock* blocks,
    size_t blockCount) {
  WaveshareS3Lcd7Display* display = g_activeWaveshareDisplay;
  if (!display) {
    return;
  }

  const RuntimeSensor* safeSensors =
      sensors ? sensors : nullptr;
  const RuntimeBlock* safeBlocks =
      blocks ? blocks : nullptr;

  if (!safeSensors) {
    sensorCount = 0;
  }
  if (!safeBlocks) {
    blockCount = 0;
  }

  display->copyRuntimeSnapshot(
      safeSensors,
      sensorCount,
      safeBlocks,
      blockCount);

  if (display->_initialized && waveshareLvglLock(0)) {
    display->refreshSensorsPage();
    display->refreshBlocksPage();
    waveshareLvglUnlock();
  }
}

void WaveshareS3Lcd7Display::pushRuntimeEvent(
    const String& text,
    uint32_t timestampMs) {
  WaveshareS3Lcd7Display* display = g_activeWaveshareDisplay;
  if (!display) {
    return;
  }

  display->addRuntimeEvent(
      text,
      timestampMs == 0 ? millis() : timestampMs);

  if (display->_initialized && waveshareLvglLock(0)) {
    display->refreshEventsPage();
    waveshareLvglUnlock();
  }
}

void WaveshareS3Lcd7Display::queueTouchButton(TouchButton button) {
  _pendingTouchButton = static_cast<uint8_t>(button);
}

void WaveshareS3Lcd7Display::navEvent(lv_event_t* event) {
  auto* self = static_cast<WaveshareS3Lcd7Display*>(
      lv_event_get_user_data(event));
  if (!self) {
    return;
  }

  lv_obj_t* target = lv_event_get_target(event);
  for (int i = 0; i < 4; ++i) {
    if (target == self->_navButtons[i]) {
      self->showPage(static_cast<Page>(i));
      return;
    }
  }
}

void WaveshareS3Lcd7Display::actionEvent(lv_event_t* event) {
  auto* self = static_cast<WaveshareS3Lcd7Display*>(
      lv_event_get_user_data(event));
  if (!self) {
    return;
  }

  lv_obj_t* target = lv_event_get_target(event);

  if (target == self->_topPowerButton) {
    self->queueTouchButton(TouchButton::Power);
    return;
  }

  if (target == self->_topEmergencyButton) {
    self->queueTouchButton(TouchButton::Emergency);
    return;
  }

  if (target == self->_sensorPrevButton) {
    if (self->_sensorPage > 0) {
      --self->_sensorPage;
      self->refreshSensorsPage();
    }
    return;
  }

  if (target == self->_sensorNextButton) {
    const size_t pages = std::max<size_t>(
        1U,
        (self->_sensorItemCount + SENSOR_PAGE_SIZE - 1U) /
            SENSOR_PAGE_SIZE);
    if (self->_sensorPage + 1U < pages) {
      ++self->_sensorPage;
      self->refreshSensorsPage();
    }
    return;
  }

  if (target == self->_blockPrevButton) {
    if (self->_blockPage > 0) {
      --self->_blockPage;
      self->refreshBlocksPage();
    }
    return;
  }

  if (target == self->_blockNextButton) {
    const size_t pages = std::max<size_t>(
        1U,
        (self->_blockItemCount + BLOCK_PAGE_SIZE - 1U) /
            BLOCK_PAGE_SIZE);
    if (self->_blockPage + 1U < pages) {
      ++self->_blockPage;
      self->refreshBlocksPage();
    }
    return;
  }

  if (target == self->_eventClearButton) {
    self->_eventCount = 0;
    self->refreshEventsPage();
  }
}

void WaveshareS3Lcd7Display::processLegacyLine(const String& rawLine) {
  String line = rawLine;
  line.trim();

  if (line.length() == 0 || line == "DCCExpressHub") {
    return;
  }

  if (line == "WiFi...") {
    _wifiConnecting = true;
    _wifiConnected = false;
    _expectWifiSsid = true;
    refreshUi();
    return;
  }

  if (_expectWifiSsid) {
    _wifiSsid = line;
    _expectWifiSsid = false;
    refreshUi();
    return;
  }

  if (line.startsWith("WEB:")) {
    String value = line.substring(4);
    value.trim();

    _wifiConnecting = false;
    _wifiConnected =
        value.length() > 0 &&
        value != "NOK" &&
        value != "NOT CONNECTED";
    _wifiIp = _wifiConnected ? value : String("-");
    refreshUi();
    return;
  }

  if (line.startsWith("CC:")) {
    String value = line.substring(3);
    value.trim();
    _ccConnected = value == "OK";
    _expectCcEndpoint = true;
    refreshUi();
    return;
  }

  if (_expectCcEndpoint) {
    _ccEndpoint = line.length() ? line : String("-");
    _expectCcEndpoint = false;
    refreshUi();
    return;
  }

  if (line.startsWith("S88:")) {
    String value = line.substring(4);
    value.trim();

    if (value == "-" || value.length() == 0) {
      _s88Known = false;
      _s88Connected = false;
      _s88Address = "-";
    } else {
      const int space = value.indexOf(' ');
      if (space >= 0) {
        _s88Address = value.substring(0, space);
        String state = value.substring(space + 1);
        state.trim();
        _s88Connected = state == "OK";
      } else {
        _s88Address = value;
        _s88Connected = false;
      }
      _s88Known = true;
    }

    refreshUi();
  }
}

void WaveshareS3Lcd7Display::appendLegacyText(
    const String& text,
    bool newline) {
  _legacyLine += text;

  if (!newline) {
    return;
  }

  const String completed = _legacyLine;
  _legacyLine = "";
  processLegacyLine(completed);
}

void WaveshareS3Lcd7Display::clear(uint16_t) {
  _legacyLine = "";
  _expectWifiSsid = false;
  _expectCcEndpoint = false;
}

void WaveshareS3Lcd7Display::setCursor(int16_t, int16_t) {}
void WaveshareS3Lcd7Display::setTextSize(uint8_t) {}
void WaveshareS3Lcd7Display::setTextColor(uint16_t, uint16_t) {}

void WaveshareS3Lcd7Display::print(const String& text) {
  if (!_initialized || !waveshareLvglLock(50)) {
    return;
  }
  appendLegacyText(text, false);
  waveshareLvglUnlock();
}

void WaveshareS3Lcd7Display::print(const char* text) {
  print(String(text ? text : ""));
}

void WaveshareS3Lcd7Display::print(uint32_t value) {
  print(String(value));
}

void WaveshareS3Lcd7Display::println() {
  if (!_initialized || !waveshareLvglLock(50)) {
    return;
  }
  appendLegacyText("", true);
  waveshareLvglUnlock();
}

void WaveshareS3Lcd7Display::println(const String& text) {
  if (!_initialized || !waveshareLvglLock(50)) {
    return;
  }
  appendLegacyText(text, true);
  waveshareLvglUnlock();
}

void WaveshareS3Lcd7Display::println(const char* text) {
  println(String(text ? text : ""));
}

void WaveshareS3Lcd7Display::println(uint32_t value) {
  println(String(value));
}

void WaveshareS3Lcd7Display::drawPowerButton(
    const char*,
    uint16_t fillColor,
    uint16_t) {
  _powerActive = fillColor == LIME;

  if (_initialized && waveshareLvglLock(50)) {
    refreshActionButtons();
    waveshareLvglUnlock();
  }
}

void WaveshareS3Lcd7Display::drawEmergencyButton(
    const char* label,
    uint16_t fillColor) {
  _emergencyActive =
      fillColor == RED ||
      (label && String(label) == "RESUME");

  if (_initialized && waveshareLvglLock(50)) {
    refreshActionButtons();
    waveshareLvglUnlock();
  }
}

void WaveshareS3Lcd7Display::drawInfoButton(
    const char*,
    uint16_t,
    uint16_t) {
  // INFO is intentionally not exposed on the operational HMI pages.
}

WaveshareS3Lcd7Display::TouchButton
WaveshareS3Lcd7Display::takeButtonPress() {
  static uint32_t nextLvglServiceAt = 0;
  const uint32_t now = millis();

  if (
      _initialized &&
      static_cast<int32_t>(now - nextLvglServiceAt) >= 0
  ) {
    nextLvglServiceAt = now + 10U;

    if (waveshareLvglLock(0)) {
      lv_timer_handler();
      waveshareLvglUnlock();
    }
  }

  const uint8_t value = _pendingTouchButton;
  _pendingTouchButton = static_cast<uint8_t>(TouchButton::None);
  return static_cast<TouchButton>(value);
}

#endif
