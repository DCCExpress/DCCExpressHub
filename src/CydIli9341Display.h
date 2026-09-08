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
  static constexpr uint16_t RED = ILI9341_RED;

  // Dark neutral idle state for the emergency button.
  static constexpr uint16_t DARK_GREY = 0x4208;

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

  // Draws the large touch emergency button at the bottom of the CYD screen.
  void drawEmergencyButton(
      const char* label,
      uint16_t fillColor);

  // Edge-triggered: returns true only once per physical touch/release cycle
  // and only when the touch is inside the emergency button.
  bool takeEmergencyButtonPress();

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

  // XPT2046 touch controller is on its own SPI bus on the classic CYD.
  static constexpr int TOUCH_SCLK = 25;
  static constexpr int TOUCH_MISO = 39;
  static constexpr int TOUCH_MOSI = 32;
  static constexpr int TOUCH_CS = 33;
  static constexpr int TOUCH_IRQ = 36;

  static constexpr uint32_t TOUCH_SPI_HZ = 2000000;

  // Broad calibration values commonly used by the original 2.8" CYD.
  // The emergency button is deliberately large, so small panel-to-panel
  // calibration differences do not matter.
  static constexpr int TOUCH_X_MIN = 200;
  static constexpr int TOUCH_X_MAX = 3700;
  static constexpr int TOUCH_Y_MIN = 240;
  static constexpr int TOUCH_Y_MAX = 3800;

  static constexpr int SCREEN_WIDTH = 320;
  static constexpr int SCREEN_HEIGHT = 240;

  static constexpr int EMERGENCY_X = 8;
  static constexpr int EMERGENCY_Y = 184;
  static constexpr int EMERGENCY_W = 304;
  static constexpr int EMERGENCY_H = 48;

  static constexpr int TOUCH_PRESSURE_THRESHOLD = 80;
  static constexpr unsigned long TOUCH_SAMPLE_INTERVAL_MS = 15;

  SPIClass _spi{HSPI};
  SPIClass _touchSpi{VSPI};

  Adafruit_ILI9341 _tft{
      &_spi,
      TFT_DC,
      TFT_CS,
      TFT_RST};

  bool _touchWasDown = false;
  unsigned long _lastTouchSampleAt = 0;

  static int16_t bestTwoAverage(
      int16_t a,
      int16_t b,
      int16_t c);

  bool readTouchRaw(
      uint16_t& rawX,
      uint16_t& rawY,
      uint16_t& pressure);

  bool mapTouchToScreen(
      uint16_t rawX,
      uint16_t rawY,
      int16_t& x,
      int16_t& y) const;
};

#endif
