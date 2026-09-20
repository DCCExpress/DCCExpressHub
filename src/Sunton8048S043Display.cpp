#include <Arduino.h>

#if defined(HUB_DISPLAY_SUNTON_8048S043) && HUB_DISPLAY_SUNTON_8048S043

#include "Sunton8048S043Display.h"

Sunton8048S043Display::Sunton8048S043Display() = default;

Sunton8048S043Display::~Sunton8048S043Display() {
  delete _gfx;
  _gfx = nullptr;

  delete _bus;
  _bus = nullptr;
}

void Sunton8048S043Display::begin() {
  Serial.println();
  Serial.println("=== SUNTON RGB CONFIG ===");
  Serial.printf("Arduino core: %s\n", ESP_ARDUINO_VERSION_STR);
  Serial.printf("PSRAM: %u MB\n", static_cast<unsigned>(ESP.getPsramSize() / (1024U * 1024U)));
#ifdef CONFIG_ESP32S3_DATA_CACHE_LINE_SIZE
  Serial.printf("D-cache line: %d bytes\n", CONFIG_ESP32S3_DATA_CACHE_LINE_SIZE);
#endif
#ifdef CONFIG_COMPILER_OPTIMIZATION_PERF
  Serial.println("Compiler optimization: PERFORMANCE");
#endif
#ifdef CONFIG_SPIRAM_XIP_FROM_PSRAM
  Serial.println("PSRAM XIP: enabled");
#elif defined(CONFIG_SPIRAM_FETCH_INSTRUCTIONS)
  Serial.println("PSRAM instruction fetch: enabled");
#endif
  Serial.println("RGB bounce buffer: 800 x 10 pixels");
  Serial.println("=========================");
  // ESP32-8048S043 / ST7262 settings from the manufacturer package.
  //
  // IMPORTANT:
  // DCCExpressHub keeps Wi-Fi active. On ESP32-S3 the RGB LCD DMA and CPU/Wi-Fi
  // can contend for PSRAM bandwidth, causing the well-known "screen drift"
  // symptom. Arduino_GFX 1.5.6 exposes the ESP-IDF RGB bounce buffer setting,
  // so use 10 complete scan lines (800 * 10 pixels) in internal SRAM.
  //
  // This keeps the full framebuffer in PSRAM, but the LCD DMA reads from fast
  // internal bounce buffers instead of directly depending on uninterrupted
  // PSRAM bandwidth.
  static constexpr uint32_t RGB_BOUNCE_BUFFER_PIXELS =
      WIDTH * 10;

  _bus =
      new Arduino_ESP32RGBPanel(
          40,  // DE
          41,  // VSYNC
          39,  // HSYNC
          42,  // PCLK

          45, 48, 47, 21, 14,  // R0..R4
          5, 6, 7, 15, 16, 4,  // G0..G5
          8, 3, 46, 9, 1,      // B0..B4

          0, 8, 4, 8,          // H: polarity/front/pulse/back
          0, 8, 4, 8,          // V: polarity/front/pulse/back

          1,                   // pclk_active_neg
          16000000,            // manufacturer HelloWorld/Clock value
          false,               // useBigEndian
          0,                   // de_idle_high
          0,                   // pclk_idle_high
          RGB_BOUNCE_BUFFER_PIXELS);

  _gfx =
      new Arduino_RGB_Display(
          WIDTH,
          HEIGHT,
          _bus,
          0,                   // rotation
          true);               // auto_flush

  pinMode(
      BACKLIGHT_PIN,
      OUTPUT);

  digitalWrite(
      BACKLIGHT_PIN,
      LOW);

  if (_gfx) {
    _gfx->begin();
    _gfx->fillScreen(BLACK);
    _gfx->setTextSize(2);
    _gfx->setTextColor(WHITE, BLACK);
  }

  digitalWrite(
      BACKLIGHT_PIN,
      HIGH);

  beginTouch();
}

void Sunton8048S043Display::clear(
    uint16_t color) {
  if (!_gfx) {
    return;
  }

  _gfx->fillScreen(
      color);

  _gfx->setCursor(
      0,
      0);
}

void Sunton8048S043Display::setCursor(
    int16_t x,
    int16_t y) {
  if (_gfx) {
    _gfx->setCursor(
        x,
        y);
  }
}

void Sunton8048S043Display::setTextSize(
    uint8_t size) {
  if (_gfx) {
    _gfx->setTextSize(
        size);
  }
}

void Sunton8048S043Display::setTextColor(
    uint16_t foreground,
    uint16_t background) {
  if (_gfx) {
    _gfx->setTextColor(
        foreground,
        background);
  }
}

void Sunton8048S043Display::print(
    const String& text) {
  if (_gfx) {
    _gfx->print(
        text);
  }
}

void Sunton8048S043Display::print(
    const char* text) {
  if (_gfx) {
    _gfx->print(
        text ? text : "");
  }
}

void Sunton8048S043Display::print(
    uint32_t value) {
  if (_gfx) {
    _gfx->print(
        value);
  }
}

void Sunton8048S043Display::println() {
  if (_gfx) {
    _gfx->println();
  }
}

void Sunton8048S043Display::println(
    const String& text) {
  if (_gfx) {
    _gfx->println(
        text);
  }
}

void Sunton8048S043Display::println(
    const char* text) {
  if (_gfx) {
    _gfx->println(
        text ? text : "");
  }
}

void Sunton8048S043Display::println(
    uint32_t value) {
  if (_gfx) {
    _gfx->println(
        value);
  }
}

void Sunton8048S043Display::drawStatusBox(
    int16_t x,
    int16_t width,
    const char* label,
    uint16_t fillColor,
    uint16_t textColor) {
  if (!_gfx) {
    return;
  }

  _gfx->fillRoundRect(
      x,
      STATUS_Y,
      width,
      STATUS_H,
      10,
      fillColor);

  _gfx->drawRoundRect(
      x,
      STATUS_Y,
      width,
      STATUS_H,
      10,
      WHITE);

  _gfx->setTextSize(
      2);

  _gfx->setTextColor(
      textColor,
      fillColor);

  const char* text =
      label ? label : "";

  int16_t boundsX = 0;
  int16_t boundsY = 0;
  uint16_t boundsW = 0;
  uint16_t boundsH = 0;

  _gfx->getTextBounds(
      text,
      0,
      0,
      &boundsX,
      &boundsY,
      &boundsW,
      &boundsH);

  const int16_t textX =
      x +
      (width -
       static_cast<int16_t>(boundsW)) /
          2;

  const int16_t textY =
      STATUS_Y +
      (STATUS_H -
       static_cast<int16_t>(boundsH)) /
          2;

  _gfx->setCursor(
      textX,
      textY);

  _gfx->print(
      text);
}

void Sunton8048S043Display::drawEmergencyButton(
    const char* label,
    uint16_t fillColor) {
  drawStatusBox(
      EMERGENCY_X,
      EMERGENCY_W,
      label,
      fillColor,
      WHITE);
}

void Sunton8048S043Display::drawPowerButton(
    const char* label,
    uint16_t fillColor,
    uint16_t textColor) {
  drawStatusBox(
      POWER_X,
      POWER_W,
      label,
      fillColor,
      textColor);
}

void Sunton8048S043Display::drawInfoButton(
    const char* label,
    uint16_t fillColor,
    uint16_t textColor) {
  drawStatusBox(
      INFO_X,
      INFO_W,
      label,
      fillColor,
      textColor);
}

bool Sunton8048S043Display::inside(
    int16_t x,
    int16_t y,
    int16_t boxX,
    int16_t boxW) const {
  return
      y >= STATUS_Y &&
      y < STATUS_Y + STATUS_H &&
      x >= boxX &&
      x < boxX + boxW;
}

void Sunton8048S043Display::beginTouch() {
  // Manufacturer schematic:
  // SDA = GPIO19, SCL = GPIO20, RST = GPIO38.
  // GT911 INT is not connected to the ESP32, therefore polling is used.
  pinMode(
      TOUCH_RST_PIN,
      OUTPUT);

  digitalWrite(
      TOUCH_RST_PIN,
      LOW);

  delay(
      12);

  digitalWrite(
      TOUCH_RST_PIN,
      HIGH);

  delay(
      100);

  Wire.begin(
      TOUCH_SDA_PIN,
      TOUCH_SCL_PIN);

  Wire.setClock(
      400000);

  if (
      probeTouchAddress(
          GT911_ADDR_PRIMARY)
  ) {
    _touchAddress =
        GT911_ADDR_PRIMARY;
  } else if (
      probeTouchAddress(
          GT911_ADDR_ALT)
  ) {
    _touchAddress =
        GT911_ADDR_ALT;
  } else {
    _touchAddress =
        0;
  }

  _touchReady =
      _touchAddress != 0;
}

bool Sunton8048S043Display::probeTouchAddress(
    uint8_t address) {
  Wire.beginTransmission(
      address);

  return
      Wire.endTransmission() ==
      0;
}

bool Sunton8048S043Display::readTouchRegister(
    uint16_t reg,
    uint8_t* data,
    size_t length) {
  if (
      !_touchReady ||
      !data ||
      length == 0
  ) {
    return false;
  }

  Wire.beginTransmission(
      _touchAddress);

  Wire.write(
      static_cast<uint8_t>(
          reg >> 8));

  Wire.write(
      static_cast<uint8_t>(
          reg & 0xFF));

  if (
      Wire.endTransmission() !=
      0
  ) {
    return false;
  }

  const size_t received =
      Wire.requestFrom(
          static_cast<int>(
              _touchAddress),
          static_cast<int>(
              length));

  if (
      received !=
      length
  ) {
    while (Wire.available()) {
      Wire.read();
    }

    return false;
  }

  for (
      size_t index = 0;
      index < length;
      ++index
  ) {
    if (!Wire.available()) {
      return false;
    }

    data[index] =
        static_cast<uint8_t>(
            Wire.read());
  }

  return true;
}

bool Sunton8048S043Display::writeTouchRegister(
    uint16_t reg,
    uint8_t value) {
  if (!_touchReady) {
    return false;
  }

  Wire.beginTransmission(
      _touchAddress);

  Wire.write(
      static_cast<uint8_t>(
          reg >> 8));

  Wire.write(
      static_cast<uint8_t>(
          reg & 0xFF));

  Wire.write(
      value);

  return
      Wire.endTransmission() ==
      0;
}

bool Sunton8048S043Display::readTouch(
    int16_t& x,
    int16_t& y) {
  if (!_touchReady) {
    return false;
  }

  uint8_t status = 0;

  if (
      !readTouchRegister(
          GT911_STATUS_REG,
          &status,
          1)
  ) {
    return false;
  }

  if (
      (status & 0x80) ==
      0
  ) {
    return
        _touchDown;
  }

  const uint8_t count =
      status &
      0x0F;

  if (count == 0) {
    writeTouchRegister(
        GT911_STATUS_REG,
        0);

    return false;
  }

  uint8_t point[8] = {};

  const bool ok =
      readTouchRegister(
          GT911_POINT1_REG,
          point,
          sizeof(point));

  writeTouchRegister(
      GT911_STATUS_REG,
      0);

  if (!ok) {
    return false;
  }

  const uint16_t rawX =
      static_cast<uint16_t>(
          point[1]) |
      (
          static_cast<uint16_t>(
              point[2]) <<
          8);

  const uint16_t rawY =
      static_cast<uint16_t>(
          point[3]) |
      (
          static_cast<uint16_t>(
              point[4]) <<
          8);

  if (
      rawX >= WIDTH ||
      rawY >= HEIGHT
  ) {
    return false;
  }

  x =
      static_cast<int16_t>(
          rawX);

  y =
      static_cast<int16_t>(
          rawY);

  return true;
}

Sunton8048S043Display::PhysicalButton
Sunton8048S043Display::takeButtonPress() {
  int16_t x = 0;
  int16_t y = 0;

  const bool touched =
      readTouch(
          x,
          y);

  if (!touched) {
    _touchDown =
        false;

    return
        PhysicalButton::None;
  }

  if (_touchDown) {
    return
        PhysicalButton::None;
  }

  _touchDown =
      true;

  if (
      inside(
          x,
          y,
          POWER_X,
          POWER_W)
  ) {
    return
        PhysicalButton::Power;
  }

  if (
      inside(
          x,
          y,
          EMERGENCY_X,
          EMERGENCY_W)
  ) {
    return
        PhysicalButton::Emergency;
  }

  if (
      inside(
          x,
          y,
          INFO_X,
          INFO_W)
  ) {
    return
        PhysicalButton::Info;
  }

  return
      PhysicalButton::None;
}

#endif
