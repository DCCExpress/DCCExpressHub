#include "piko_display.h"
#include <stdint.h>
#include <string.h>
#include "sdkconfig.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "piko_display";

#if CONFIG_PIKO_LCD_TEST
static spi_device_handle_t lcd;
static void pin(int gpio, int level)
{
    if (gpio >= 0) gpio_set_level(gpio, level);
}
static esp_err_t send_bytes(bool data, const void *bytes, size_t size)
{
    pin(CONFIG_PIKO_LCD_DC, data ? 1 : 0);
    spi_transaction_t t = {.length = size * 8, .tx_buffer = bytes};
    return spi_device_polling_transmit(lcd, &t);
}
static esp_err_t cmd(uint8_t value) { return send_bytes(false, &value, 1); }
static esp_err_t data(const void *ptr, size_t size) { return send_bytes(true, ptr, size); }
static esp_err_t address_window(uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1)
{
    const uint8_t x[] = {x0 >> 8, x0 & 255, x1 >> 8, x1 & 255};
    const uint8_t y[] = {y0 >> 8, y0 & 255, y1 >> 8, y1 & 255};
    esp_err_t e = cmd(0x2A);
    if (e == ESP_OK) e = data(x, sizeof(x));
    if (e == ESP_OK) e = cmd(0x2B);
    if (e == ESP_OK) e = data(y, sizeof(y));
    if (e == ESP_OK) e = cmd(0x2C);
    return e;
}
static esp_err_t fill_rect(uint16_t y0, uint16_t y1, uint16_t color)
{
    esp_err_t e = address_window(0, y0, 239, y1);
    if (e != ESP_OK) return e;
    uint8_t pixels[240 * 2];
    for (size_t i = 0; i < sizeof(pixels); i += 2) {
        pixels[i] = color >> 8;
        pixels[i + 1] = color & 255;
    }
    for (uint16_t y = y0; y <= y1; ++y) {
        e = data(pixels, sizeof(pixels));
        if (e != ESP_OK) return e;
    }
    return ESP_OK;
}
#endif

esp_err_t piko_display_start(void)
{
#if !CONFIG_PIKO_LCD_TEST
    ESP_LOGW(TAG, "LCD test disabled until FP-200H05B SPI pinout is verified");
    return ESP_ERR_NOT_SUPPORTED;
#else
    const int outputs[] = {CONFIG_PIKO_LCD_MOSI, CONFIG_PIKO_LCD_CLK,
                           CONFIG_PIKO_LCD_DC, CONFIG_PIKO_LCD_CS,
                           CONFIG_PIKO_LCD_RESET};
    for (size_t i = 0; i < sizeof(outputs) / sizeof(outputs[0]); ++i) {
        if (outputs[i] < 0 || outputs[i] > 33 ||
            outputs[i] == 2 || outputs[i] == 12 || outputs[i] == 15 ||
            outputs[i] == 1 || outputs[i] == 3 ||
            outputs[i] == 6 || outputs[i] == 7 || outputs[i] == 8 ||
            outputs[i] == 9 || outputs[i] == 10 || outputs[i] == 11 ||
            outputs[i] == 14 || outputs[i] == 26 || outputs[i] == 27 ||
            outputs[i] == 13 || outputs[i] == 32 || outputs[i] == 33) {
            ESP_LOGE(TAG, "Unsafe or unconfigured LCD GPIO %d", outputs[i]);
            return ESP_ERR_INVALID_ARG;
        }
        for (size_t j = 0; j < i; ++j) if (outputs[i] == outputs[j]) return ESP_ERR_INVALID_ARG;
    }
    /* Only a tentative 240x320 ST7789-like controller. Enable only after
       verifying each GPIO electrically and the display's voltage/interface. */
    spi_bus_config_t bus = {.mosi_io_num = CONFIG_PIKO_LCD_MOSI,
                            .miso_io_num = -1, .sclk_io_num = CONFIG_PIKO_LCD_CLK,
                            .quadwp_io_num = -1, .quadhd_io_num = -1,
                            .max_transfer_sz = 1024};
    esp_err_t err = spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_DISABLED);
    if (err != ESP_OK) return err;
    spi_device_interface_config_t device = {.clock_speed_hz = 1000000,
                                              .mode = 0, .spics_io_num = CONFIG_PIKO_LCD_CS,
                                              .queue_size = 1};
    err = spi_bus_add_device(SPI2_HOST, &device, &lcd);
    if (err != ESP_OK) return err;
    gpio_set_direction((gpio_num_t)CONFIG_PIKO_LCD_DC, GPIO_MODE_OUTPUT);
    gpio_set_level((gpio_num_t)CONFIG_PIKO_LCD_DC, 1);
    gpio_set_direction((gpio_num_t)CONFIG_PIKO_LCD_RESET, GPIO_MODE_OUTPUT);
    pin(CONFIG_PIKO_LCD_RESET, 0);
    vTaskDelay(pdMS_TO_TICKS(30));
    pin(CONFIG_PIKO_LCD_RESET, 1);
    vTaskDelay(pdMS_TO_TICKS(150));
    if ((err = cmd(0x01)) != ESP_OK) return err; /* software reset */
    vTaskDelay(pdMS_TO_TICKS(150));
    if ((err = cmd(0x11)) != ESP_OK) return err; /* sleep out */
    vTaskDelay(pdMS_TO_TICKS(120));
    const uint8_t pixel_mode = 0x55; /* RGB565 */
    if ((err = cmd(0x3A)) != ESP_OK || (err = data(&pixel_mode, 1)) != ESP_OK) return err;
    const uint8_t madctl = 0x00;
    if ((err = cmd(0x36)) != ESP_OK || (err = data(&madctl, 1)) != ESP_OK) return err;
    if ((err = cmd(0x29)) != ESP_OK) return err;
    /* Three large stripes are easily identifiable without assuming a font library. */
    if ((err = fill_rect(0, 105, 0xF800)) != ESP_OK) return err;
    if ((err = fill_rect(106, 212, 0x07E0)) != ESP_OK) return err;
    if ((err = fill_rect(213, 319, 0x001F)) != ESP_OK) return err;
    ESP_LOGI(TAG, "ST7789 candidate: RGB test pattern transmitted");
    return ESP_OK;
#endif
}
