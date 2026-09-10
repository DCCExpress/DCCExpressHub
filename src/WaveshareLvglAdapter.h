#pragma once

#include <Arduino.h>

#ifndef HUB_DISPLAY_WAVESHARE_S3_LCD7
#define HUB_DISPLAY_WAVESHARE_S3_LCD7 0
#endif

#if HUB_DISPLAY_WAVESHARE_S3_LCD7

#include <esp_display_panel.hpp>
#include <esp_err.h>
#include <lvgl.h>

struct WaveshareLvglAdapterConfig {
  uint32_t taskStackSize = 12 * 1024;
  uint32_t taskPriority = 2;
  int taskCore = ARDUINO_RUNNING_CORE;
  uint32_t tickPeriodMs = 2;
  uint32_t minDelayMs = 2;
  uint32_t maxDelayMs = 50;
};

bool waveshareLvglInit(const WaveshareLvglAdapterConfig& config);
bool waveshareLvglRegister(
    esp_panel::drivers::LCD* lcd,
    esp_panel::drivers::Touch* touch,
    lv_disp_t** outDisplay,
    lv_indev_t** outTouch);
bool waveshareLvglStart();

// Shared GPIO8/GPIO9 I2C guard used by raw GT911 + optional S88 on Waveshare.
bool waveshareSharedI2CLock(uint32_t timeoutMs = 50);
void waveshareSharedI2CUnlock();
bool waveshareLvglLock(uint32_t timeoutMs = UINT32_MAX);
void waveshareLvglUnlock();

#endif
