#pragma once

#include <Arduino.h>
#include <SPI.h>

class MiniIli9342Display {
public:
  static constexpr uint16_t BLACK = 0x0000;
  static constexpr uint16_t WHITE = 0xFFFF;

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
  static constexpr int TFT_SCLK = 18;
  static constexpr int TFT_MISO = 19;
  static constexpr int TFT_MOSI = 23;
  static constexpr int TFT_CS = 14;
  static constexpr int TFT_DC = 27;
  static constexpr int TFT_RST = 33;
  static constexpr int TFT_BL = 32;

  static constexpr uint16_t WIDTH = 320;
  static constexpr uint16_t HEIGHT = 240;

  static constexpr uint32_t SPI_HZ =
      40000000;

  SPIClass* _spi = &SPI;

  int16_t _cursorX = 0;
  int16_t _cursorY = 0;

  uint8_t _textSize = 1;

  uint16_t _foreground = WHITE;
  uint16_t _background = BLACK;

  void writeCommand(
      uint8_t command);

  void writeData(
      uint8_t value);

  void writeData(
      const uint8_t* data,
      size_t length);

  void writeCommandData(
      uint8_t command,
      const uint8_t* data,
      size_t length);

  void setAddressWindow(
      uint16_t x,
      uint16_t y,
      uint16_t w,
      uint16_t h);

  void pushColor(
      uint16_t color,
      uint32_t count);

  void drawChar(
      char c);

  void newline();

  void resetPanel();
};
