#include "CydIli9341Display.h"

#if HUB_DISPLAY_CYD_2432S028

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

  // Landscape: 320 x 240. If a specific hardware revision is mirrored,
  // only this rotation needs changing during bring-up testing.
  _tft.setRotation(
      1);

  _tft.setTextWrap(
      false);

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

#endif
