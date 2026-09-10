#pragma once

#include <Arduino.h>

#ifndef HUB_DISPLAY_WAVESHARE_S3_LCD7
#define HUB_DISPLAY_WAVESHARE_S3_LCD7 0
#endif

#if HUB_DISPLAY_WAVESHARE_S3_LCD7

#include <esp_display_panel.hpp>

class WaveshareS3Lcd7FramebufferGfx;

class WaveshareS3Lcd7Display {
public:
  enum class TouchButton : uint8_t {
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

  // Returns exactly one logical event per touch/release cycle.
  TouchButton takeButtonPress();

private:
  static constexpr int SCREEN_WIDTH = 800;
  static constexpr int SCREEN_HEIGHT = 480;

  // Waveshare ESP32-S3-Touch-LCD-7 onboard I2C bus.
  static constexpr int I2C_SDA = 8;
  static constexpr int I2C_SCL = 9;
  static constexpr uint32_t I2C_HZ = 100000UL;

  // Bottom touch buttons: PWR | E-STOP | INFO.
  static constexpr int BUTTON_Y = 370;
  static constexpr int BUTTON_H = 94;

  static constexpr int POWER_X = 12;
  static constexpr int POWER_W = 244;

  static constexpr int EMERGENCY_X = 278;
  static constexpr int EMERGENCY_W = 244;

  static constexpr int INFO_X = 544;
  static constexpr int INFO_W = 244;

  esp_panel::board::Board* _board = nullptr;
  esp_panel::drivers::LCD* _lcd = nullptr;
  esp_panel::drivers::Touch* _touch = nullptr;

  uint16_t* _framebuffer = nullptr;
  WaveshareS3Lcd7FramebufferGfx* _gfx = nullptr;

  bool _initialized = false;
  bool _fullRedrawPending = false;
  bool _touchWasDown = false;

  uint8_t _textSize = 2;
  uint16_t _textForeground = WHITE;
  uint16_t _textBackground = BLACK;

  void flush();

  void drawButton(
      int16_t x,
      int16_t width,
      const char* label,
      uint16_t fillColor,
      uint16_t textColor,
      bool finishFullRedraw);

  TouchButton hitTest(
      int16_t x,
      int16_t y) const;
};

#endif
