#include "MiniIli9342Display.h"

#include <string.h>

void MiniIli9342Display::configureForHub() {
  // The original driver currently leaves the panel at MADCTL 0xA8:
  //   MY | MV | BGR -> inverse landscape.
  //
  // M5Stack's own TFT_eSPI rotation table uses this for setRotation(1):
  //   BGR only = 0x08.
  const uint8_t madctl[] = {
      0x08};

  writeCommandData(
      0x36,
      madctl,
      sizeof(madctl));

  // ILI9342C panels used by M5Stack require Display Inversion ON for the
  // expected black background / normal colour rendering. Without this the
  // same framebuffer can appear white/inverted.
  writeCommand(
      0x21);

  delay(10);

  // Re-establish the Hub's logical defaults after changing panel mode.
  _cursorX = 0;
  _cursorY = 0;
  _textSize = 1;
  _foreground = WHITE;
  _background = BLACK;

  pinMode(
      BUTTON_A_PIN,
      INPUT);

  pinMode(
      BUTTON_B_PIN,
      INPUT);

  pinMode(
      BUTTON_C_PIN,
      INPUT);

  const unsigned long now =
      millis();

  _buttonA.rawDown =
      digitalRead(BUTTON_A_PIN) == LOW;
  _buttonA.stableDown =
      _buttonA.rawDown;
  _buttonA.rawChangedAt =
      now;

  _buttonB.rawDown =
      digitalRead(BUTTON_B_PIN) == LOW;
  _buttonB.stableDown =
      _buttonB.rawDown;
  _buttonB.rawChangedAt =
      now;

  _buttonC.rawDown =
      digitalRead(BUTTON_C_PIN) == LOW;
  _buttonC.stableDown =
      _buttonC.rawDown;
  _buttonC.rawChangedAt =
      now;
}

void MiniIli9342Display::drawCondensedChar(
    char c) {
  if (c == '\r') {
    return;
  }

  if (c == '\n') {
    _cursorX =
        0;

    _cursorY +=
        18;

    return;
  }

  const uint8_t previousSize =
      _textSize;

  const int16_t startX =
      _cursorX;

  // Reuse the existing 2x font renderer, but compress horizontal advance.
  _textSize =
      2;

  drawChar(
      c);

  _textSize =
      previousSize;

  // If drawChar() did not auto-wrap, replace its normal 16 px advance
  // with a 13 px advance. The next opaque glyph overlaps 3 px, producing
  // a compact but still very readable 2x-height font.
  if (
      _cursorX >
      startX
  ) {
    _cursorX =
        startX +
        13;
  }
}

void MiniIli9342Display::printCondensed(
    const String& text) {
  for (
      size_t index = 0;
      index < text.length();
      ++index
  ) {
    drawCondensedChar(
        text.charAt(index));
  }
}

void MiniIli9342Display::printCondensed(
    const char* text) {
  if (!text) {
    return;
  }

  while (*text) {
    drawCondensedChar(
        *text++);
  }
}

void MiniIli9342Display::printCondensed(
    uint32_t value) {
  printCondensed(
      String(value));
}

void MiniIli9342Display::printlnCondensed() {
  _cursorX =
      0;

  _cursorY +=
      18;
}

void MiniIli9342Display::printlnCondensed(
    const String& text) {
  printCondensed(
      text);

  printlnCondensed();
}

void MiniIli9342Display::printlnCondensed(
    const char* text) {
  printCondensed(
      text);

  printlnCondensed();
}

void MiniIli9342Display::printlnCondensed(
    uint32_t value) {
  printCondensed(
      value);

  printlnCondensed();
}

void MiniIli9342Display::fillRect(
    int16_t x,
    int16_t y,
    int16_t width,
    int16_t height,
    uint16_t color) {
  if (
      width <= 0 ||
      height <= 0 ||
      x >= static_cast<int16_t>(WIDTH) ||
      y >= static_cast<int16_t>(HEIGHT)
  ) {
    return;
  }

  if (x < 0) {
    width += x;
    x = 0;
  }

  if (y < 0) {
    height += y;
    y = 0;
  }

  if (
      x + width >
      static_cast<int16_t>(WIDTH)
  ) {
    width =
        static_cast<int16_t>(WIDTH) -
        x;
  }

  if (
      y + height >
      static_cast<int16_t>(HEIGHT)
  ) {
    height =
        static_cast<int16_t>(HEIGHT) -
        y;
  }

  if (
      width <= 0 ||
      height <= 0
  ) {
    return;
  }

  setAddressWindow(
      static_cast<uint16_t>(x),
      static_cast<uint16_t>(y),
      static_cast<uint16_t>(width),
      static_cast<uint16_t>(height));

  pushColor(
      color,
      static_cast<uint32_t>(width) *
          static_cast<uint32_t>(height));
}

void MiniIli9342Display::drawButton(
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

  // 1 px white border.
  fillRect(
      x,
      y,
      width,
      height,
      WHITE);

  fillRect(
      x + 1,
      y + 1,
      width - 2,
      height - 2,
      fillColor);

  // Three 98 px buttons fit much better with the native 8x8 font.
  // Keep the main status screen at text size 2; only button labels use 1x.
  setTextSize(
      1);

  setTextColor(
      textColor,
      fillColor);

  const int16_t textWidth =
      static_cast<int16_t>(
          strlen(text) *
          8);

  const int16_t textHeight =
      8;

  setCursor(
      x +
          (
              width -
              textWidth
          ) /
              2,
      y +
          (
              height -
              textHeight
          ) /
              2);

  print(
      text);
}

void MiniIli9342Display::drawPowerButton(
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

void MiniIli9342Display::drawEmergencyButton(
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

void MiniIli9342Display::drawInfoButton(
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

bool MiniIli9342Display::takeDebouncedPress(
    int pin,
    ButtonState& state,
    unsigned long now) {
  const bool rawDown =
      digitalRead(pin) == LOW;

  if (
      rawDown !=
      state.rawDown
  ) {
    state.rawDown =
        rawDown;

    state.rawChangedAt =
        now;

    return false;
  }

  if (
      rawDown ==
      state.stableDown
  ) {
    return false;
  }

  if (
      now -
          state.rawChangedAt <
      BUTTON_DEBOUNCE_MS
  ) {
    return false;
  }

  state.stableDown =
      rawDown;

  return rawDown;
}

MiniIli9342Display::PhysicalButton
MiniIli9342Display::takeButtonPress() {
  const unsigned long now =
      millis();

  if (
      takeDebouncedPress(
          BUTTON_A_PIN,
          _buttonA,
          now)
  ) {
    return PhysicalButton::Power;
  }

  if (
      takeDebouncedPress(
          BUTTON_B_PIN,
          _buttonB,
          now)
  ) {
    return PhysicalButton::Emergency;
  }

  if (
      takeDebouncedPress(
          BUTTON_C_PIN,
          _buttonC,
          now)
  ) {
    return PhysicalButton::Info;
  }

  return PhysicalButton::None;
}
