#pragma once

#if defined(HUB_DISPLAY_WAVESHARE_S3_LCD7) && HUB_DISPLAY_WAVESHARE_S3_LCD7

#define LGFX_USE_V1
#include <LovyanGFX.hpp>
#include <lgfx/v1/platforms/esp32s3/Panel_RGB.hpp>
#include <lgfx/v1/platforms/esp32s3/Bus_RGB.hpp>
#include <lgfx/v1/platforms/esp32/Light_CH422G.hpp>

class WaveshareS3Lcd7Panel : public lgfx::LGFX_Device {
public:
  WaveshareS3Lcd7Panel();

protected:
  bool init_impl(bool useReset, bool useClear) override;

private:
  static constexpr uint8_t CH422G_TP_RST = 1;
  static constexpr uint8_t CH422G_LCD_BL = 2;
  static constexpr uint8_t CH422G_LCD_RST = 3;
  static constexpr uint8_t CH422G_SD_CS = 4;
  static constexpr uint8_t CH422G_USB_SEL = 5;
  static constexpr uint8_t CH422G_LCD_VDD_EN = 6;

  lgfx::Bus_RGB _bus;
  lgfx::Panel_RGB _panel;
  lgfx::Light_CH422G _light;
  lgfx::Touch_GT911 _touch;
};

class WaveshareS3Lcd7Display {
public:
  static constexpr uint16_t BLACK = 0x0000;
  static constexpr uint16_t WHITE = 0xFFFF;
  static constexpr uint16_t RED = 0xF800;
  static constexpr uint16_t LIME = 0x07E0;
  static constexpr uint16_t DARK_GREY = 0x4208;

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
  void drawEmergencyButton(const char* label, uint16_t fillColor);
  void drawPowerButton(const char* label, uint16_t fillColor, uint16_t textColor = WHITE);
  void drawInfoButton(const char* label, uint16_t fillColor, uint16_t textColor = WHITE);

private:
  static constexpr int16_t STATUS_Y = 390;
  static constexpr int16_t STATUS_H = 72;
  static constexpr int16_t POWER_X = 16;
  static constexpr int16_t POWER_W = 230;
  static constexpr int16_t EMERGENCY_X = 285;
  static constexpr int16_t EMERGENCY_W = 230;
  static constexpr int16_t INFO_X = 554;
  static constexpr int16_t INFO_W = 230;

  WaveshareS3Lcd7Panel _lcd;

  void drawStatusBox(
      int16_t x,
      int16_t width,
      const char* label,
      uint16_t fillColor,
      uint16_t textColor);
};

#endif
