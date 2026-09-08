#pragma once

#include <Arduino.h>

#ifndef HUB_DISPLAY_CYD_2432S028
#define HUB_DISPLAY_CYD_2432S028 0
#endif

#if HUB_DISPLAY_CYD_2432S028

#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <SPI.h>

class CydIli9341Display {
public:
  static constexpr uint16_t BLACK = ILI9341_BLACK;
  static constexpr uint16_t WHITE = ILI9341_WHITE;

  void begin();

  void clear(
      uint16_t color = BLACK);

  void setCursor(
      int16_t x,
      int16_t y);

  void setTextSize(
      uint8_t size);

  void setTextColor(
      uint16_t foreground,
      uint16_t background = BLACK);

  void print(
      const String& text);

  void print(
      const char* text);

  void print(
      uint32_t value);

  void println();

  void println(
      const String& text);

  void println(
      const char* text);

  void println(
      uint32_t value);

private:
  // ESP32-2432S028 / ESP32-2432S028R (CYD) ILI9341 wiring.
  static constexpr int TFT_SCLK = 14;
  static constexpr int TFT_MISO = 12;
  static constexpr int TFT_MOSI = 13;
  static constexpr int TFT_CS = 15;
  static constexpr int TFT_DC = 2;

  // TFT reset is tied to the ESP32 board reset on the common CYD revision.
  static constexpr int TFT_RST = -1;
  static constexpr int TFT_BL = 21;

  static constexpr uint32_t SPI_HZ = 40000000;

  SPIClass _spi{HSPI};
  Adafruit_ILI9341 _tft{&_spi, TFT_DC, TFT_CS, TFT_RST};
};

#endif
