#include "WaveshareS3Lcd7Display.h"

#if HUB_DISPLAY_WAVESHARE_S3_LCD7

#include <Adafruit_GFX.h>
#include <Wire.h>
#include <algorithm>
#include <esp_heap_caps.h>

using esp_panel::drivers::BusI2C;
using esp_panel::drivers::TouchPoint;

class WaveshareS3Lcd7FramebufferGfx final : public Adafruit_GFX {
public:
  WaveshareS3Lcd7FramebufferGfx(
      int16_t width,
      int16_t height,
      uint16_t* buffer)
      : Adafruit_GFX(
            width,
            height),
        _buffer(buffer) {}

  void drawPixel(
      int16_t x,
      int16_t y,
      uint16_t color) override {
    if (
        !_buffer ||
        x < 0 ||
        y < 0 ||
        x >= width() ||
        y >= height()
    ) {
      return;
    }

    _buffer[
        static_cast<size_t>(y) *
            static_cast<size_t>(width()) +
        static_cast<size_t>(x)] =
        color;
  }

  void drawFastHLine(
      int16_t x,
      int16_t y,
      int16_t w,
      uint16_t color) override {
    if (
        !_buffer ||
        y < 0 ||
        y >= height() ||
        w <= 0
    ) {
      return;
    }

    if (x < 0) {
      w += x;
      x = 0;
    }

    if (
        x >= width() ||
        w <= 0
    ) {
      return;
    }

    if (
        x + w > width()
    ) {
      w =
          width() -
          x;
    }

    uint16_t* row =
        _buffer +
        static_cast<size_t>(y) *
            static_cast<size_t>(width()) +
        static_cast<size_t>(x);

    std::fill_n(
        row,
        static_cast<size_t>(w),
        color);
  }

  void drawFastVLine(
      int16_t x,
      int16_t y,
      int16_t h,
      uint16_t color) override {
    if (
        !_buffer ||
        x < 0 ||
        x >= width() ||
        h <= 0
    ) {
      return;
    }

    if (y < 0) {
      h += y;
      y = 0;
    }

    if (
        y >= height() ||
        h <= 0
    ) {
      return;
    }

    if (
        y + h > height()
    ) {
      h =
          height() -
          y;
    }

    uint16_t* pixel =
        _buffer +
        static_cast<size_t>(y) *
            static_cast<size_t>(width()) +
        static_cast<size_t>(x);

    for (
        int16_t row = 0;
        row < h;
        ++row
    ) {
      *pixel =
          color;

      pixel +=
          width();
    }
  }

  void fillRect(
      int16_t x,
      int16_t y,
      int16_t w,
      int16_t h,
      uint16_t color) override {
    if (
        !_buffer ||
        w <= 0 ||
        h <= 0
    ) {
      return;
    }

    if (x < 0) {
      w += x;
      x = 0;
    }

    if (y < 0) {
      h += y;
      y = 0;
    }

    if (
        x >= width() ||
        y >= height() ||
        w <= 0 ||
        h <= 0
    ) {
      return;
    }

    if (
        x + w > width()
    ) {
      w =
          width() -
          x;
    }

    if (
        y + h > height()
    ) {
      h =
          height() -
          y;
    }

    for (
        int16_t row = 0;
        row < h;
        ++row
    ) {
      drawFastHLine(
          x,
          static_cast<int16_t>(
              y +
              row),
          w,
          color);
    }
  }

  void fillScreen(
      uint16_t color) override {
    if (!_buffer) {
      return;
    }

    std::fill_n(
        _buffer,
        static_cast<size_t>(
            width()) *
            static_cast<size_t>(
                height()),
        color);
  }

private:
  uint16_t* _buffer = nullptr;
};

void WaveshareS3Lcd7Display::begin() {
  if (_initialized) {
    return;
  }

  Serial.println(
      "Waveshare LCD7: initializing shared I2C bus on GPIO8/GPIO9");

  if (
      !Wire.begin(
          I2C_SDA,
          I2C_SCL,
          I2C_HZ)
  ) {
    Serial.println(
        "Waveshare LCD7: I2C initialization failed");
    return;
  }

  _board =
      new esp_panel::board::Board();

  if (
      !_board ||
      !_board->init()
  ) {
    Serial.println(
        "Waveshare LCD7: ESP32_Display_Panel board init failed");
    return;
  }

  // The Hub owns I2C host 0 through Arduino Wire because S88 uses the same
  // physical GPIO8/GPIO9 bus. Let the panel drivers reuse the already-running
  // host instead of initializing it a second time.
  _touch =
      _board->getTouch();

  if (_touch) {
    auto* touchBus =
        static_cast<BusI2C*>(
            _touch->getBus());

    if (
        !touchBus->configI2C_HostSkipInit()
    ) {
      Serial.println(
          "Waveshare LCD7: unable to configure touch I2C host sharing");
      return;
    }
  }

  auto* expander =
      _board->getIO_Expander();

  if (
      expander &&
      !expander->skipInitHost()
  ) {
    Serial.println(
        "Waveshare LCD7: unable to configure CH422G I2C host sharing");
    return;
  }

  if (
      !_board->begin()
  ) {
    Serial.println(
        "Waveshare LCD7: panel begin failed");
    return;
  }

  _lcd =
      _board->getLCD();

  _touch =
      _board->getTouch();

  if (!_lcd) {
    Serial.println(
        "Waveshare LCD7: LCD driver missing");
    return;
  }

  if (
      !psramFound()
  ) {
    Serial.println(
        "Waveshare LCD7: PSRAM not detected");
    return;
  }

  const size_t framebufferBytes =
      static_cast<size_t>(
          SCREEN_WIDTH) *
      static_cast<size_t>(
          SCREEN_HEIGHT) *
      sizeof(uint16_t);

  _framebuffer =
      static_cast<uint16_t*>(
          heap_caps_malloc(
              framebufferBytes,
              MALLOC_CAP_SPIRAM |
                  MALLOC_CAP_8BIT));

  if (!_framebuffer) {
    Serial.println(
        "Waveshare LCD7: PSRAM framebuffer allocation failed");
    return;
  }

  _gfx =
      new WaveshareS3Lcd7FramebufferGfx(
          SCREEN_WIDTH,
          SCREEN_HEIGHT,
          _framebuffer);

  if (!_gfx) {
    Serial.println(
        "Waveshare LCD7: GFX allocation failed");
    return;
  }

  _gfx->setTextWrap(
      false);

  _initialized =
      true;

  clear(
      BLACK);

  flush();

  _fullRedrawPending =
      false;

  Serial.println(
      "Waveshare LCD7: ready (800x480, GT911 touch, S88 shared I2C)");
}

void WaveshareS3Lcd7Display::flush() {
  if (
      !_initialized ||
      !_lcd ||
      !_framebuffer
  ) {
    return;
  }

  if (
      !_lcd->drawBitmap(
          0,
          0,
          SCREEN_WIDTH,
          SCREEN_HEIGHT,
          reinterpret_cast<const uint8_t*>(
              _framebuffer))
  ) {
    Serial.println(
        "Waveshare LCD7: framebuffer flush failed");
  }
}

void WaveshareS3Lcd7Display::clear(
    uint16_t color) {
  if (!_gfx) {
    return;
  }

  _gfx->fillScreen(
      color);

  _fullRedrawPending =
      true;
}

void WaveshareS3Lcd7Display::setCursor(
    int16_t x,
    int16_t y) {
  if (_gfx) {
    _gfx->setCursor(
        x,
        y);
  }
}

void WaveshareS3Lcd7Display::setTextSize(
    uint8_t size) {
  _textSize =
      size;

  if (_gfx) {
    // HubDisplay was designed around 320x240. Double its logical text scale
    // on the 800x480 panel while keeping the public display API unchanged.
    const uint8_t physicalSize =
        static_cast<uint8_t>(
            std::max<uint8_t>(
                1,
                static_cast<uint8_t>(
                    size *
                    2U)));

    _gfx->setTextSize(
        physicalSize);
  }
}

void WaveshareS3Lcd7Display::setTextColor(
    uint16_t foreground,
    uint16_t background) {
  _textForeground =
      foreground;

  _textBackground =
      background;

  if (_gfx) {
    _gfx->setTextColor(
        foreground,
        background);
  }
}

void WaveshareS3Lcd7Display::print(
    const String& text) {
  if (_gfx) {
    _gfx->print(
        text);
  }
}

void WaveshareS3Lcd7Display::print(
    const char* text) {
  if (_gfx) {
    _gfx->print(
        text);
  }
}

void WaveshareS3Lcd7Display::print(
    uint32_t value) {
  if (_gfx) {
    _gfx->print(
        value);
  }
}

void WaveshareS3Lcd7Display::println() {
  if (_gfx) {
    _gfx->println();
  }
}

void WaveshareS3Lcd7Display::println(
    const String& text) {
  if (_gfx) {
    _gfx->println(
        text);
  }
}

void WaveshareS3Lcd7Display::println(
    const char* text) {
  if (_gfx) {
    _gfx->println(
        text);
  }
}

void WaveshareS3Lcd7Display::println(
    uint32_t value) {
  if (_gfx) {
    _gfx->println(
        value);
  }
}

void WaveshareS3Lcd7Display::drawButton(
    int16_t x,
    int16_t width,
    const char* label,
    uint16_t fillColor,
    uint16_t textColor,
    bool finishFullRedraw) {
  if (!_gfx) {
    return;
  }

  _gfx->fillRect(
      x,
      BUTTON_Y,
      width,
      BUTTON_H,
      fillColor);

  _gfx->drawRect(
      x,
      BUTTON_Y,
      width,
      BUTTON_H,
      WHITE);

  _gfx->drawRect(
      static_cast<int16_t>(
          x +
          1),
      static_cast<int16_t>(
          BUTTON_Y +
          1),
      static_cast<int16_t>(
          width -
          2),
      static_cast<int16_t>(
          BUTTON_H -
          2),
      WHITE);

  const uint8_t oldPhysicalSize =
      static_cast<uint8_t>(
          std::max<uint8_t>(
              1,
              static_cast<uint8_t>(
                  _textSize *
                  2U)));

  _gfx->setTextSize(
      4);

  _gfx->setTextColor(
      textColor,
      fillColor);

  int16_t textX = 0;
  int16_t textY = 0;
  uint16_t textW = 0;
  uint16_t textH = 0;

  _gfx->getTextBounds(
      label,
      0,
      0,
      &textX,
      &textY,
      &textW,
      &textH);

  const int16_t cursorX =
      static_cast<int16_t>(
          x +
          (
              width -
              static_cast<int16_t>(
                  textW)
          ) /
              2);

  const int16_t cursorY =
      static_cast<int16_t>(
          BUTTON_Y +
          (
              BUTTON_H -
              static_cast<int16_t>(
                  textH)
          ) /
              2 -
          textY);

  _gfx->setCursor(
      cursorX,
      cursorY);

  _gfx->print(
      label);

  _gfx->setTextSize(
      oldPhysicalSize);

  _gfx->setTextColor(
      _textForeground,
      _textBackground);

  if (
      _fullRedrawPending
  ) {
    if (finishFullRedraw) {
      flush();

      _fullRedrawPending =
          false;
    }
  } else {
    flush();
  }
}

void WaveshareS3Lcd7Display::drawEmergencyButton(
    const char* label,
    uint16_t fillColor) {
  drawButton(
      EMERGENCY_X,
      EMERGENCY_W,
      label,
      fillColor,
      WHITE,
      false);
}

void WaveshareS3Lcd7Display::drawPowerButton(
    const char* label,
    uint16_t fillColor,
    uint16_t textColor) {
  drawButton(
      POWER_X,
      POWER_W,
      label,
      fillColor,
      textColor,
      false);
}

void WaveshareS3Lcd7Display::drawInfoButton(
    const char* label,
    uint16_t fillColor,
    uint16_t textColor) {
  drawButton(
      INFO_X,
      INFO_W,
      label,
      fillColor,
      textColor,
      true);
}

WaveshareS3Lcd7Display::TouchButton
WaveshareS3Lcd7Display::hitTest(
    int16_t x,
    int16_t y) const {
  if (
      y < BUTTON_Y ||
      y >=
          BUTTON_Y +
              BUTTON_H
  ) {
    return TouchButton::None;
  }

  if (
      x >= POWER_X &&
      x <
          POWER_X +
              POWER_W
  ) {
    return TouchButton::Power;
  }

  if (
      x >= EMERGENCY_X &&
      x <
          EMERGENCY_X +
              EMERGENCY_W
  ) {
    return TouchButton::Emergency;
  }

  if (
      x >= INFO_X &&
      x <
          INFO_X +
              INFO_W
  ) {
    return TouchButton::Info;
  }

  return TouchButton::None;
}

WaveshareS3Lcd7Display::TouchButton
WaveshareS3Lcd7Display::takeButtonPress() {
  if (
      !_initialized ||
      !_touch
  ) {
    return TouchButton::None;
  }

  TouchPoint point;

  const int pointCount =
      _touch->readPoints(
          &point,
          1,
          0);

  // Negative means no new touch data / timeout. Keep the previous debounced
  // state and wait for the GT911 release report.
  if (pointCount < 0) {
    return TouchButton::None;
  }

  if (pointCount == 0) {
    _touchWasDown =
        false;

    return TouchButton::None;
  }

  if (_touchWasDown) {
    return TouchButton::None;
  }

  _touchWasDown =
      true;

  return hitTest(
      static_cast<int16_t>(
          point.x),
      static_cast<int16_t>(
          point.y));
}

#endif
