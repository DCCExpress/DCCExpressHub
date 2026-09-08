#include "CydIli9341Display.h"

#if HUB_DISPLAY_CYD_2432S028

#include "Logger.h"

void CydIli9341Display::begin() {
  pinMode(
      TFT_BL,
      OUTPUT);

  // Keep the backlight dark while the controller is being initialized.
  digitalWrite(
      TFT_BL,
      LOW);

  _spi.begin(
      TFT_SCLK,
      TFT_MISO,
      TFT_MOSI,
      TFT_CS);

  _tft.begin(
      SPI_HZ);

  // Landscape: 320 x 240.
  _tft.setRotation(
      1);

  _tft.setTextWrap(
      false);

  // XPT2046 touch controller uses the separate CYD touch SPI pins.
  pinMode(
      TOUCH_CS,
      OUTPUT);

  digitalWrite(
      TOUCH_CS,
      HIGH);

  pinMode(
      TOUCH_IRQ,
      INPUT);

  _touchSpi.begin(
      TOUCH_SCLK,
      TOUCH_MISO,
      TOUCH_MOSI,
      TOUCH_CS);

  clear();

  _tft.setCursor(
      0,
      0);

  _tft.setTextSize(
      1);

  _tft.setTextColor(
      WHITE,
      BLACK);

  digitalWrite(
      TFT_BL,
      HIGH);

  Logger::info(
      "CYD touch initialized: XPT2046 GPIO25/39/32 CS33 IRQ36");
}

void CydIli9341Display::clear(
    uint16_t color) {
  _tft.fillScreen(
      color);
}

void CydIli9341Display::setCursor(
    int16_t x,
    int16_t y) {
  _tft.setCursor(
      x,
      y);
}

void CydIli9341Display::setTextSize(
    uint8_t size) {
  _tft.setTextSize(
      size);
}

void CydIli9341Display::setTextColor(
    uint16_t foreground,
    uint16_t background) {
  _tft.setTextColor(
      foreground,
      background);
}

void CydIli9341Display::print(
    const String& text) {
  _tft.print(
      text);
}

void CydIli9341Display::print(
    const char* text) {
  _tft.print(
      text ? text : "");
}

void CydIli9341Display::print(
    uint32_t value) {
  _tft.print(
      value);
}

void CydIli9341Display::println() {
  _tft.println();
}

void CydIli9341Display::println(
    const String& text) {
  _tft.println(
      text);
}

void CydIli9341Display::println(
    const char* text) {
  _tft.println(
      text ? text : "");
}

void CydIli9341Display::println(
    uint32_t value) {
  _tft.println(
      value);
}

void CydIli9341Display::drawButton(
    int16_t x,
    int16_t y,
    int16_t width,
    int16_t height,
    const char* label,
    uint16_t fillColor,
    uint16_t textColor) {
  const char* text =
      label
          ? label
          : "";

  _tft.fillRoundRect(
      x,
      y,
      width,
      height,
      6,
      fillColor);

  _tft.drawRoundRect(
      x,
      y,
      width,
      height,
      6,
      WHITE);

  _tft.setTextSize(
      2);

  _tft.setTextColor(
      textColor,
      fillColor);

  int16_t x1 = 0;
  int16_t y1 = 0;
  uint16_t textWidth = 0;
  uint16_t textHeight = 0;

  _tft.getTextBounds(
      text,
      0,
      0,
      &x1,
      &y1,
      &textWidth,
      &textHeight);

  const int16_t textX =
      x +
      (
          width -
          static_cast<int16_t>(
              textWidth)
      ) /
          2;

  const int16_t textY =
      y +
      (
          height -
          static_cast<int16_t>(
              textHeight)
      ) /
          2;

  _tft.setCursor(
      textX,
      textY);

  _tft.print(
      text);
}

void CydIli9341Display::drawPowerButton(
    const char* label,
    uint16_t fillColor,
    uint16_t textColor) {
  drawButton(
      POWER_X,
      BUTTON_Y,
      POWER_W,
      BUTTON_H,
      label
          ? label
          : "PWR",
      fillColor,
      textColor);
}

void CydIli9341Display::drawEmergencyButton(
    const char* label,
    uint16_t fillColor) {
  drawButton(
      EMERGENCY_X,
      BUTTON_Y,
      EMERGENCY_W,
      BUTTON_H,
      label
          ? label
          : "E-STOP",
      fillColor,
      WHITE);
}

void CydIli9341Display::drawInfoButton(
    const char* label,
    uint16_t fillColor,
    uint16_t textColor) {
  drawButton(
      INFO_X,
      BUTTON_Y,
      INFO_W,
      BUTTON_H,
      label
          ? label
          : "INFO",
      fillColor,
      textColor);
}

int16_t CydIli9341Display::bestTwoAverage(
    int16_t a,
    int16_t b,
    int16_t c) {
  const int16_t ab =
      abs(
          a -
          b);

  const int16_t ac =
      abs(
          a -
          c);

  const int16_t bc =
      abs(
          b -
          c);

  if (
      ab <= ac &&
      ab <= bc
  ) {
    return
        (
            a +
            b
        ) >>
        1;
  }

  if (
      ac <= ab &&
      ac <= bc
  ) {
    return
        (
            a +
            c
        ) >>
        1;
  }

  return
      (
          b +
          c
      ) >>
      1;
}

bool CydIli9341Display::readTouchRaw(
    uint16_t& rawX,
    uint16_t& rawY,
    uint16_t& pressure) {
  if (
      digitalRead(
          TOUCH_IRQ) !=
      LOW
  ) {
    return false;
  }

  int16_t data[6] = {};

  _touchSpi.beginTransaction(
      SPISettings(
          TOUCH_SPI_HZ,
          MSBFIRST,
          SPI_MODE0));

  digitalWrite(
      TOUCH_CS,
      LOW);

  // Sequence follows the XPT2046 conversion pipeline:
  // Z1/Z2 pressure first, then three X/Y samples.
  _touchSpi.transfer(
      0xB1);

  const int16_t z1 =
      _touchSpi.transfer16(
          0xC1) >>
      3;

  int32_t z =
      z1 +
      4095;

  const int16_t z2 =
      _touchSpi.transfer16(
          0x91) >>
      3;

  z -=
      z2;

  if (
      z >=
      TOUCH_PRESSURE_THRESHOLD
  ) {
    // First position conversion is intentionally discarded because it is
    // commonly noisier on the XPT2046.
    _touchSpi.transfer16(
        0x91);

    data[0] =
        _touchSpi.transfer16(
            0xD1) >>
        3;

    data[1] =
        _touchSpi.transfer16(
            0x91) >>
        3;

    data[2] =
        _touchSpi.transfer16(
            0xD1) >>
        3;

    data[3] =
        _touchSpi.transfer16(
            0x91) >>
        3;
  }

  data[4] =
      _touchSpi.transfer16(
          0xD0) >>
      3;

  data[5] =
      _touchSpi.transfer16(
          0) >>
      3;

  digitalWrite(
      TOUCH_CS,
      HIGH);

  _touchSpi.endTransaction();

  if (
      z <
      TOUCH_PRESSURE_THRESHOLD
  ) {
    return false;
  }

  // This is the XPT2046 library's rotation=1 orientation, matching the
  // ILI9341 landscape rotation used above.
  const int16_t x =
      bestTwoAverage(
          data[0],
          data[2],
          data[4]);

  const int16_t y =
      bestTwoAverage(
          data[1],
          data[3],
          data[5]);

  if (
      x <= 0 ||
      x >= 4095 ||
      y <= 0 ||
      y >= 4095
  ) {
    return false;
  }

  rawX =
      static_cast<uint16_t>(
          x);

  rawY =
      static_cast<uint16_t>(
          y);

  pressure =
      static_cast<uint16_t>(
          constrain(
              z,
              0,
              65535));

  return true;
}

bool CydIli9341Display::mapTouchToScreen(
    uint16_t rawX,
    uint16_t rawY,
    int16_t& x,
    int16_t& y) const {
  long mappedX =
      map(
          rawX,
          TOUCH_X_MIN,
          TOUCH_X_MAX,
          0,
          SCREEN_WIDTH -
              1);

  long mappedY =
      map(
          rawY,
          TOUCH_Y_MIN,
          TOUCH_Y_MAX,
          0,
          SCREEN_HEIGHT -
              1);

  mappedX =
      constrain(
          mappedX,
          0L,
          static_cast<long>(
              SCREEN_WIDTH -
              1));

  mappedY =
      constrain(
          mappedY,
          0L,
          static_cast<long>(
              SCREEN_HEIGHT -
              1));

  x =
      static_cast<int16_t>(
          mappedX);

  y =
      static_cast<int16_t>(
          mappedY);

  return true;
}

CydIli9341Display::TouchButton
CydIli9341Display::takeButtonPress() {
  const unsigned long now =
      millis();

  const bool irqDown =
      digitalRead(
          TOUCH_IRQ) ==
      LOW;

  if (!irqDown) {
    _touchPressCandidateAt =
        0;

    if (!_touchWasDown) {
      _touchReleaseCandidateAt =
          0;

      return TouchButton::None;
    }

    if (
        _touchReleaseCandidateAt ==
        0
    ) {
      _touchReleaseCandidateAt =
          now;

      return TouchButton::None;
    }

    if (
        now -
            _touchReleaseCandidateAt <
        TOUCH_RELEASE_DEBOUNCE_MS
    ) {
      return TouchButton::None;
    }

    _touchWasDown =
        false;

    _touchReleaseCandidateAt =
        0;

    return TouchButton::None;
  }

  // Any brief HIGH pulse before this point was touch chatter, not a release.
  _touchReleaseCandidateAt =
      0;

  if (_touchWasDown) {
    return TouchButton::None;
  }

  if (
      _touchPressCandidateAt ==
      0
  ) {
    _touchPressCandidateAt =
        now;

    return TouchButton::None;
  }

  if (
      now -
          _touchPressCandidateAt <
      TOUCH_PRESS_DEBOUNCE_MS
  ) {
    return TouchButton::None;
  }

  if (
      now -
          _lastTouchSampleAt <
      TOUCH_SAMPLE_INTERVAL_MS
  ) {
    return TouchButton::None;
  }

  _lastTouchSampleAt =
      now;

  uint16_t rawX = 0;
  uint16_t rawY = 0;
  uint16_t pressure = 0;

  if (
      !readTouchRaw(
          rawX,
          rawY,
          pressure)
  ) {
    return TouchButton::None;
  }

  // Consume this physical touch once. It will not re-arm until the stable
  // 120 ms release period completes.
  _touchWasDown =
      true;

  _touchPressCandidateAt =
      0;

  int16_t x = 0;
  int16_t y = 0;

  mapTouchToScreen(
      rawX,
      rawY,
      x,
      y);

  const bool inButtonRow =
      y >=
          BUTTON_Y &&
      y <
          BUTTON_Y +
              BUTTON_H;

  if (!inButtonRow) {
    return TouchButton::None;
  }

  if (
      x >=
          POWER_X &&
      x <
          POWER_X +
              POWER_W
  ) {
    Logger::info(
        "CYD PWR touch x=" +
        String(x) +
        " y=" +
        String(y));

    return TouchButton::Power;
  }

  if (
      x >=
          EMERGENCY_X &&
      x <
          EMERGENCY_X +
              EMERGENCY_W
  ) {
    Logger::warn(
        "CYD E-STOP touch x=" +
        String(x) +
        " y=" +
        String(y));

    return TouchButton::Emergency;
  }

  if (
      x >=
          INFO_X &&
      x <
          INFO_X +
              INFO_W
  ) {
    Logger::info(
        "CYD INFO touch x=" +
        String(x) +
        " y=" +
        String(y));

    return TouchButton::Info;
  }

  return TouchButton::None;
}

#endif
