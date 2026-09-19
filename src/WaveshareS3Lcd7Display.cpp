#include <Arduino.h>

#if defined(HUB_DISPLAY_WAVESHARE_S3_LCD7) && HUB_DISPLAY_WAVESHARE_S3_LCD7

#include "WaveshareS3Lcd7Display.h"

WaveshareS3Lcd7Panel::WaveshareS3Lcd7Panel() {
  {
    auto cfg = _panel.config();
    cfg.memory_width = 800;
    cfg.memory_height = 480;
    cfg.panel_width = 800;
    cfg.panel_height = 480;
    cfg.offset_x = 0;
    cfg.offset_y = 0;
    _panel.config(cfg);
  }

  {
    auto cfg = _panel.config_detail();
    cfg.use_psram = 1;
    _panel.config_detail(cfg);
  }

  {
    auto cfg = _bus.config();
    cfg.panel = &_panel;

    cfg.pin_d0 = GPIO_NUM_14;
    cfg.pin_d1 = GPIO_NUM_38;
    cfg.pin_d2 = GPIO_NUM_18;
    cfg.pin_d3 = GPIO_NUM_17;
    cfg.pin_d4 = GPIO_NUM_10;
    cfg.pin_d5 = GPIO_NUM_39;
    cfg.pin_d6 = GPIO_NUM_0;
    cfg.pin_d7 = GPIO_NUM_45;
    cfg.pin_d8 = GPIO_NUM_48;
    cfg.pin_d9 = GPIO_NUM_47;
    cfg.pin_d10 = GPIO_NUM_21;
    cfg.pin_d11 = GPIO_NUM_1;
    cfg.pin_d12 = GPIO_NUM_2;
    cfg.pin_d13 = GPIO_NUM_42;
    cfg.pin_d14 = GPIO_NUM_41;
    cfg.pin_d15 = GPIO_NUM_40;

    cfg.pin_henable = GPIO_NUM_5;
    cfg.pin_vsync = GPIO_NUM_3;
    cfg.pin_hsync = GPIO_NUM_46;
    cfg.pin_pclk = GPIO_NUM_7;
    //cfg.freq_write = 16000000;
    cfg.freq_write = 13000000;

    cfg.hsync_polarity = 0;
    cfg.hsync_front_porch = 8;
    cfg.hsync_pulse_width = 4;
    cfg.hsync_back_porch = 8;
    cfg.vsync_polarity = 0;
    cfg.vsync_front_porch = 8;
    cfg.vsync_pulse_width = 4;
    cfg.vsync_back_porch = 8;
    cfg.pclk_idle_high = 1;

    _bus.config(cfg);
  }

  _panel.setBus(&_bus);

  {
    auto cfg = _light.config();
    cfg.pin_sda = GPIO_NUM_8;
    cfg.pin_scl = GPIO_NUM_9;
    cfg.i2c_port = 0;
    cfg.freq = 400000;
    cfg.pin_bl = CH422G_LCD_BL;
    cfg.shadow_init =
        (1 << CH422G_LCD_VDD_EN) |
        (1 << CH422G_LCD_BL) |
        (1 << CH422G_TP_RST) |
        (1 << CH422G_LCD_RST) |
        (1 << CH422G_SD_CS);
    _light.config(cfg);
    _panel.light(&_light);
  }

  {
    auto cfg = _touch.config();
    cfg.x_min = 0;
    cfg.y_min = 0;
    cfg.x_max = 800;
    cfg.y_max = 480;
    cfg.bus_shared = false;
    cfg.offset_rotation = 0;
    cfg.i2c_port = 0;
    cfg.i2c_addr = 0x5D;
    cfg.pin_sda = GPIO_NUM_8;
    cfg.pin_scl = GPIO_NUM_9;
    cfg.pin_int = GPIO_NUM_4;
    cfg.pin_rst = -1;
    cfg.freq = 400000;
    _touch.config(cfg);
    _panel.setTouch(&_touch);
  }

  setPanel(&_panel);
}

bool WaveshareS3Lcd7Panel::init_impl(
    bool useReset,
    bool useClear) {
  _light.init(255);

  lgfx::pinMode(GPIO_NUM_4, lgfx::pin_mode_t::output);
  lgfx::gpio_lo(GPIO_NUM_4);
  lgfx::delay(10);

  _light.write_pin(CH422G_TP_RST, false);
  lgfx::delay(100);
  _light.write_pin(CH422G_TP_RST, true);
  lgfx::delay(10);

  lgfx::pinMode(GPIO_NUM_4, lgfx::pin_mode_t::input);

  return lgfx::LGFX_Device::init_impl(useReset, useClear);
}

void WaveshareS3Lcd7Display::begin() {
  _lcd.init();
  _lcd.setRotation(0);
  _lcd.fillScreen(BLACK);
  _lcd.setTextDatum(top_left);
  _lcd.setTextSize(2);
  _lcd.setTextColor(WHITE, BLACK);
}

void WaveshareS3Lcd7Display::clear(uint16_t color) {
  _lcd.fillScreen(color);
  _lcd.setCursor(0, 0);
}

void WaveshareS3Lcd7Display::setCursor(int16_t x, int16_t y) {
  _lcd.setCursor(x, y);
}

void WaveshareS3Lcd7Display::setTextSize(uint8_t size) {
  _lcd.setTextSize(size);
}

void WaveshareS3Lcd7Display::setTextColor(uint16_t foreground, uint16_t background) {
  _lcd.setTextColor(foreground, background);
}

void WaveshareS3Lcd7Display::print(const String& text) { _lcd.print(text); }
void WaveshareS3Lcd7Display::print(const char* text) { _lcd.print(text ? text : ""); }
void WaveshareS3Lcd7Display::print(uint32_t value) { _lcd.print(value); }
void WaveshareS3Lcd7Display::println() { _lcd.println(); }
void WaveshareS3Lcd7Display::println(const String& text) { _lcd.println(text); }
void WaveshareS3Lcd7Display::println(const char* text) { _lcd.println(text ? text : ""); }
void WaveshareS3Lcd7Display::println(uint32_t value) { _lcd.println(value); }

void WaveshareS3Lcd7Display::drawStatusBox(
    int16_t x,
    int16_t width,
    const char* label,
    uint16_t fillColor,
    uint16_t textColor) {
  _lcd.fillRoundRect(x, STATUS_Y, width, STATUS_H, 10, fillColor);
  _lcd.drawRoundRect(x, STATUS_Y, width, STATUS_H, 10, WHITE);
  _lcd.setTextDatum(middle_center);
  _lcd.setTextSize(2);
  _lcd.setTextColor(textColor, fillColor);
  _lcd.drawString(label ? label : "", x + width / 2, STATUS_Y + STATUS_H / 2);
  _lcd.setTextDatum(top_left);
}

void WaveshareS3Lcd7Display::drawEmergencyButton(
    const char* label,
    uint16_t fillColor) {
  drawStatusBox(EMERGENCY_X, EMERGENCY_W, label, fillColor, WHITE);
}

void WaveshareS3Lcd7Display::drawPowerButton(
    const char* label,
    uint16_t fillColor,
    uint16_t textColor) {
  drawStatusBox(POWER_X, POWER_W, label, fillColor, textColor);
}

void WaveshareS3Lcd7Display::drawInfoButton(
    const char* label,
    uint16_t fillColor,
    uint16_t textColor) {
  drawStatusBox(INFO_X, INFO_W, label, fillColor, textColor);
}

#endif
