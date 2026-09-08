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

  setTextSize(
      2);

  setTextColor(
      textColor,
      fillColor);

  const int16_t textWidth =
      static_cast<int16_t>(
          strlen(text) *
          16);

  const int16_t textHeight =
      16;

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
          : "POWER",
      fillColor,
      textColor);
}
