#include "WaveshareLvglAdapter.h"

#if HUB_DISPLAY_WAVESHARE_S3_LCD7

#include <limits.h>
#include <Wire.h>
#include <esp_heap_caps.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

using esp_panel::drivers::LCD;
using esp_panel::drivers::Touch;
using esp_panel::drivers::TouchPoint;

namespace {

struct AdapterContext {
  bool initialized = false;
  bool started = false;
  bool rgbFullRefresh = false;
  WaveshareLvglAdapterConfig config;
  SemaphoreHandle_t mutex = nullptr;
  SemaphoreHandle_t i2cMutex = nullptr;
  esp_timer_handle_t tickTimer = nullptr;
  LCD* lcd = nullptr;
  Touch* touch = nullptr;
  uint8_t gt911Address = 0;
  bool gt911Detected = false;
  uint8_t gt911Failures = 0;
  uint32_t nextGt911ProbeMs = 0;
  lv_disp_t* display = nullptr;
  lv_disp_draw_buf_t drawBuffer;
  lv_disp_drv_t displayDriver;
  lv_indev_t* input = nullptr;
  lv_indev_drv_t inputDriver;
  void* buffer1 = nullptr;
  void* buffer2 = nullptr;
  bool ownsBuffers = false;
  uint32_t lastTouchLogMs = 0;
  uint32_t touchRetryAfterMs = 0;
};

AdapterContext g;

void tickCallback(void*) {
  lv_tick_inc(g.config.tickPeriodMs);
}



void flushCallback(
    lv_disp_drv_t* driver,
    const lv_area_t* area,
    lv_color_t* colorMap) {
  LCD* lcd = static_cast<LCD*>(driver->user_data);

  if (!lcd || !area || !colorMap) {
    lv_disp_flush_ready(driver);
    return;
  }

  // Stability-first RGB path: LVGL renders into small PSRAM line buffers and
  // the panel driver copies only the dirty rectangle into its own framebuffer.
  // Do NOT switch RGB framebuffers and do NOT wait for VSYNC task
  // notifications here. This keeps the LVGL worker independent from Wi-Fi /
  // AsyncWebServer load and removes the ISR/task-notification abort path.
  lcd->drawBitmap(
      area->x1,
      area->y1,
      area->x2 - area->x1 + 1,
      area->y2 - area->y1 + 1,
      reinterpret_cast<const uint8_t*>(colorMap));

  lv_disp_flush_ready(driver);
}

constexpr uint8_t GT911_ADDRESS_PRIMARY = 0x5D;
constexpr uint8_t GT911_ADDRESS_BACKUP = 0x14;
constexpr uint16_t GT911_REG_PRODUCT_ID = 0x8140;
constexpr uint16_t GT911_REG_STATUS = 0x814E;
constexpr uint16_t GT911_REG_FIRST_POINT = 0x814F;
constexpr int GT911_IRQ_PIN = 4;

bool wireReadRegister(
    uint8_t address,
    uint16_t reg,
    uint8_t* data,
    size_t length) {
  if (!data || length == 0) {
    return false;
  }

  Wire.beginTransmission(address);
  Wire.write(static_cast<uint8_t>(reg >> 8));
  Wire.write(static_cast<uint8_t>(reg & 0xFF));

  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  const size_t received = Wire.requestFrom(
      static_cast<uint8_t>(address),
      length,
      true);

  if (received != length) {
    while (Wire.available()) {
      Wire.read();
    }
    return false;
  }

  for (size_t i = 0; i < length; ++i) {
    if (!Wire.available()) {
      return false;
    }
    data[i] = static_cast<uint8_t>(Wire.read());
  }

  return true;
}

bool wireWriteRegister8(
    uint8_t address,
    uint16_t reg,
    uint8_t value) {
  Wire.beginTransmission(address);
  Wire.write(static_cast<uint8_t>(reg >> 8));
  Wire.write(static_cast<uint8_t>(reg & 0xFF));
  Wire.write(value);
  return Wire.endTransmission(true) == 0;
}

bool probeGt911Address(uint8_t address) {
  uint8_t productId[4] = {};
  return wireReadRegister(
      address,
      GT911_REG_PRODUCT_ID,
      productId,
      sizeof(productId));
}

bool probeGt911() {
  uint8_t address = 0;

  if (probeGt911Address(GT911_ADDRESS_PRIMARY)) {
    address = GT911_ADDRESS_PRIMARY;
  } else if (probeGt911Address(GT911_ADDRESS_BACKUP)) {
    address = GT911_ADDRESS_BACKUP;
  }

  if (address == 0) {
    g.gt911Detected = false;
    g.gt911Address = 0;
    return false;
  }

  const bool changed =
      !g.gt911Detected ||
      g.gt911Address != address;

  g.gt911Detected = true;
  g.gt911Address = address;
  g.gt911Failures = 0;

  if (changed) {
    Serial.printf(
        "Waveshare touch: GT911 detected via Wire at 0x%02X\n",
        static_cast<unsigned>(address));
  }

  return true;
}

void markGt911Failure(uint32_t now) {
  if (g.gt911Failures < 255) {
    ++g.gt911Failures;
  }

  g.touchRetryAfterMs = now + 500U;

  if (g.gt911Failures >= 3) {
    g.gt911Detected = false;
    g.gt911Address = 0;
    g.nextGt911ProbeMs = now + 2000U;
    g.gt911Failures = 0;
    Serial.println(
        "Waveshare touch: GT911 temporarily offline; retrying in 2s");
  }
}

void touchCallback(
    lv_indev_drv_t*,
    lv_indev_data_t* data) {
  const uint32_t now = millis();
  data->state = LV_INDEV_STATE_RELEASED;

  if (!g.gt911Detected) {
    if (static_cast<int32_t>(now - g.nextGt911ProbeMs) < 0) {
      return;
    }

    g.nextGt911ProbeMs = now + 2000U;

    if (!waveshareSharedI2CLock(10)) {
      return;
    }

    const bool found = probeGt911();
    waveshareSharedI2CUnlock();

    if (!found) {
      return;
    }
  }

  if (g.touchRetryAfterMs != 0 &&
      static_cast<int32_t>(now - g.touchRetryAfterMs) < 0) {
    return;
  }

  // GPIO4 is the GT911 active-low IRQ on this Waveshare board. With no touch
  // pending we do zero I2C traffic, so a bad/missing touch can never starve
  // the Hub/Wi-Fi loop.
  if (digitalRead(GT911_IRQ_PIN) != LOW) {
    return;
  }

  if (!waveshareSharedI2CLock(10)) {
    return;
  }

  uint8_t status = 0;
  if (!wireReadRegister(
          g.gt911Address,
          GT911_REG_STATUS,
          &status,
          1)) {
    waveshareSharedI2CUnlock();
    markGt911Failure(now);
    return;
  }

  const uint8_t count = status & 0x0F;
  const bool dataReady = (status & 0x80U) != 0;

  if (!dataReady || count == 0 || count > 5) {
    if (dataReady) {
      wireWriteRegister8(
          g.gt911Address,
          GT911_REG_STATUS,
          0);
    }
    waveshareSharedI2CUnlock();
    return;
  }

  uint8_t point[8] = {};
  const bool pointRead = wireReadRegister(
      g.gt911Address,
      GT911_REG_FIRST_POINT,
      point,
      sizeof(point));

  wireWriteRegister8(
      g.gt911Address,
      GT911_REG_STATUS,
      0);

  waveshareSharedI2CUnlock();

  if (!pointRead) {
    markGt911Failure(now);
    return;
  }

  g.gt911Failures = 0;
  g.touchRetryAfterMs = 0;

  uint16_t x =
      static_cast<uint16_t>(point[1]) |
      (static_cast<uint16_t>(point[2]) << 8U);
  uint16_t y =
      static_cast<uint16_t>(point[3]) |
      (static_cast<uint16_t>(point[4]) << 8U);

  if (x > 799U) {
    x = 799U;
  }
  if (y > 479U) {
    y = 479U;
  }

  data->point.x = x;
  data->point.y = y;
  data->state = LV_INDEV_STATE_PRESSED;

  if (now - g.lastTouchLogMs >= 250U) {
    g.lastTouchLogMs = now;
    Serial.printf(
        "Waveshare LVGL touch: x=%u y=%u addr=0x%02X\n",
        static_cast<unsigned>(x),
        static_cast<unsigned>(y),
        static_cast<unsigned>(g.gt911Address));
  }
}

}  // namespace

bool waveshareLvglInit(const WaveshareLvglAdapterConfig& config) {
  if (g.initialized) {
    return true;
  }

  g.config = config;
  g.mutex = xSemaphoreCreateRecursiveMutex();
  if (!g.mutex) {
    return false;
  }

  g.i2cMutex = xSemaphoreCreateMutex();
  if (!g.i2cMutex) {
    return false;
  }

  lv_init();

  esp_timer_create_args_t timerArgs = {};
  timerArgs.callback = tickCallback;
  timerArgs.name = "hub_lvgl_tick";

  if (esp_timer_create(&timerArgs, &g.tickTimer) != ESP_OK) {
    return false;
  }

  if (
      esp_timer_start_periodic(
          g.tickTimer,
          static_cast<uint64_t>(g.config.tickPeriodMs) * 1000ULL) !=
      ESP_OK
  ) {
    return false;
  }

  g.initialized = true;
  return true;
}

bool waveshareLvglRegister(
    LCD* lcd,
    Touch* touch,
    lv_disp_t** outDisplay,
    lv_indev_t** outTouch) {
  if (!g.initialized || !lcd || g.display) {
    return false;
  }

  g.lcd = lcd;
  g.touch = touch;

  const uint32_t width = lcd->getFrameWidth();
  const uint32_t height = lcd->getFrameHeight();

  // Cooperative LVGL mode: keep the tiny dirty-area buffer in PSRAM.
  // The display is mostly static, so PSRAM bandwidth is cheap here, while the
  // recovered internal SRAM is far more valuable to lwIP/AsyncTCP during the
  // Layout editor's lazy-chunk + WebSocket snapshot burst.
  constexpr size_t lineCount = 8;
  const size_t pixels = width * lineCount;
  const size_t bytes = pixels * sizeof(lv_color_t);

  g.buffer1 = heap_caps_malloc(
      bytes,
      MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  g.buffer2 = nullptr;

  if (!g.buffer1) {
    Serial.printf(
        "Waveshare LVGL: PSRAM partial buffer allocation failed (%u bytes)\n",
        static_cast<unsigned>(bytes));
    return false;
  }

  g.rgbFullRefresh = false;
  g.ownsBuffers = true;

  Serial.printf(
      "Waveshare LVGL: PSRAM render buffer ready (%u bytes, %u lines), freeHeap=%u, freePSRAM=%u\n",
      static_cast<unsigned>(bytes),
      static_cast<unsigned>(lineCount),
      static_cast<unsigned>(ESP.getFreeHeap()),
      static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_SPIRAM)));

  const uint32_t bufferPixels = width * lineCount;

  lv_disp_draw_buf_init(
      &g.drawBuffer,
      g.buffer1,
      nullptr,
      bufferPixels);

  lv_disp_drv_init(&g.displayDriver);
  g.displayDriver.hor_res = width;
  g.displayDriver.ver_res = height;
  g.displayDriver.flush_cb = flushCallback;
  g.displayDriver.draw_buf = &g.drawBuffer;
  g.displayDriver.user_data = lcd;
  g.displayDriver.full_refresh = false;

  g.display = lv_disp_drv_register(&g.displayDriver);
  if (!g.display) {
    return false;
  }

  // Do not use ESP32_Display_Panel's runtime GT911 read path here. Both touch
  // and S88 now use Arduino Wire at runtime on the same physical GPIO8/GPIO9
  // bus, with one shared mutex. This removes the repeated esp_lcd I2C failures.
  (void)touch;
  pinMode(GT911_IRQ_PIN, INPUT_PULLUP);

  if (waveshareSharedI2CLock(20)) {
    if (!probeGt911()) {
      Serial.println(
          "Waveshare touch: GT911 not detected yet; background re-probe enabled");
      g.nextGt911ProbeMs = millis() + 1000U;
    }
    waveshareSharedI2CUnlock();
  }

  lv_indev_drv_init(&g.inputDriver);
  g.inputDriver.type = LV_INDEV_TYPE_POINTER;
  g.inputDriver.read_cb = touchCallback;
  g.inputDriver.user_data = nullptr;

  g.input = lv_indev_drv_register(&g.inputDriver);
  if (!g.input) {
    return false;
  }

  if (outDisplay) {
    *outDisplay = g.display;
  }
  if (outTouch) {
    *outTouch = g.input;
  }

  return true;
}

bool waveshareLvglStart() {
  if (!g.initialized || !g.display) {
    return false;
  }

  if (g.started) {
    return true;
  }

  // IMPORTANT: no dedicated LVGL task on Waveshare. LVGL is serviced
  // cooperatively from WaveshareS3Lcd7Display::takeButtonPress(), which the
  // existing HubDisplay loop already calls continuously. This keeps all LVGL
  // object access + flushing on the Arduino/Hub thread and leaves Wi-Fi /
  // AsyncTCP tasks completely independent.
  g.started = true;
  Serial.println(
      "Waveshare LVGL: cooperative mode (no dedicated FreeRTOS task)");
  return true;
}

bool waveshareSharedI2CLock(uint32_t timeoutMs) {
  if (!g.i2cMutex) {
    return false;
  }

  const TickType_t timeoutTicks =
      timeoutMs == UINT32_MAX
          ? portMAX_DELAY
          : pdMS_TO_TICKS(timeoutMs);

  return xSemaphoreTake(g.i2cMutex, timeoutTicks) == pdTRUE;
}

void waveshareSharedI2CUnlock() {
  if (g.i2cMutex) {
    xSemaphoreGive(g.i2cMutex);
  }
}

bool waveshareLvglLock(uint32_t timeoutMs) {
  if (!g.mutex) {
    return false;
  }

  const TickType_t timeoutTicks =
      timeoutMs == UINT32_MAX
          ? portMAX_DELAY
          : pdMS_TO_TICKS(timeoutMs);

  return
      xSemaphoreTakeRecursive(
          g.mutex,
          timeoutTicks) ==
      pdTRUE;
}

void waveshareLvglUnlock() {
  if (g.mutex) {
    xSemaphoreGiveRecursive(g.mutex);
  }
}

#endif
