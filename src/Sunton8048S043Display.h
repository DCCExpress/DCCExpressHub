#pragma once

#if defined(HUB_DISPLAY_SUNTON_8048S043) && HUB_DISPLAY_SUNTON_8048S043

#include <Arduino.h>
#include <Arduino_GFX_Library.h>

// Arduino_GFX exposes common RGB565 colors as preprocessor macros
// (BLACK, WHITE, RED, ...). The Hub display abstraction intentionally uses
// class-scoped constants with the same names, so remove only the conflicting
// macros after the library headers have been parsed.
#ifdef BLACK
#undef BLACK
#endif

#ifdef WHITE
#undef WHITE
#endif

#ifdef RED
#undef RED
#endif

#include <Wire.h>

class Sunton8048S043Display {
public:
  enum class PhysicalButton :
      uint8_t {
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

  Sunton8048S043Display();
  ~Sunton8048S043Display();

  void begin();
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

  void drawEmergencyButton(
      const char* label,
      uint16_t fillColor);

  void drawPowerButton(
      const char* label,
      uint16_t fillColor,
      uint16_t textColor = WHITE);

  void drawInfoButton(
      const char* label,
      uint16_t fillColor,
      uint16_t textColor = WHITE);

  PhysicalButton takeButtonPress();

private:
  static constexpr int16_t WIDTH = 800;
  static constexpr int16_t HEIGHT = 480;

  static constexpr int16_t STATUS_Y = 390;
  static constexpr int16_t STATUS_H = 72;

  static constexpr int16_t POWER_X = 16;
  static constexpr int16_t POWER_W = 230;

  static constexpr int16_t EMERGENCY_X = 285;
  static constexpr int16_t EMERGENCY_W = 230;

  static constexpr int16_t INFO_X = 554;
  static constexpr int16_t INFO_W = 230;

  static constexpr uint8_t BACKLIGHT_PIN = 2;

  static constexpr uint8_t TOUCH_SDA_PIN = 19;
  static constexpr uint8_t TOUCH_SCL_PIN = 20;
  static constexpr uint8_t TOUCH_RST_PIN = 38;

  static constexpr uint16_t GT911_STATUS_REG = 0x814E;
  static constexpr uint16_t GT911_POINT1_REG = 0x814F;
  static constexpr uint8_t GT911_ADDR_PRIMARY = 0x5D;
  static constexpr uint8_t GT911_ADDR_ALT = 0x14;

  Arduino_ESP32RGBPanel* _bus = nullptr;
  Arduino_RGB_Display* _gfx = nullptr;

  uint8_t _touchAddress = 0;
  bool _touchDown = false;
  bool _touchReady = false;

  void drawStatusBox(
      int16_t x,
      int16_t width,
      const char* label,
      uint16_t fillColor,
      uint16_t textColor);

  bool inside(
      int16_t x,
      int16_t y,
      int16_t boxX,
      int16_t boxW) const;

  void beginTouch();
  bool probeTouchAddress(uint8_t address);
  bool readTouch(int16_t& x, int16_t& y);
  bool readTouchRegister(uint16_t reg, uint8_t* data, size_t length);
  bool writeTouchRegister(uint16_t reg, uint8_t value);
};

#endif
