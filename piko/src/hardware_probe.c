#include "hardware_probe.h"
#include <stdbool.h>
#include <stdint.h>
#include "driver/gpio.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "piko_hw";

/*
 * Diagnostic candidates; deliberately OMIT UART0 1/3, SPI flash 6..11,
 * ESP32 boot/strapping pins 0/2/4/5/12/15, and all output driving.
 * Input enable is not a fully passive hardware operation: do not assume
 * any candidate is a button until the physical schematic is known.
 */
static const gpio_num_t pins[] = {
    GPIO_NUM_13, GPIO_NUM_14, GPIO_NUM_16, GPIO_NUM_17,
    GPIO_NUM_18, GPIO_NUM_19, GPIO_NUM_21, GPIO_NUM_22,
    GPIO_NUM_23, GPIO_NUM_25, GPIO_NUM_26, GPIO_NUM_27,
    GPIO_NUM_32, GPIO_NUM_33, GPIO_NUM_34, GPIO_NUM_35,
    GPIO_NUM_36, GPIO_NUM_39
};
#define PIN_COUNT (sizeof(pins) / sizeof(pins[0]))

static void scan(void *ignored)
{
    uint32_t last = 0;
    uint32_t report_ms = 0;
    bool first = true;
    ESP_LOGW(TAG, "Watching %u candidate GPIO inputs (no output, no internal pull resistors)",
             (unsigned)PIN_COUNT);
    for (;;) {
        uint32_t levels = 0;
        for (unsigned i = 0; i < PIN_COUNT; ++i)
            if (gpio_get_level(pins[i])) levels |= (1UL << i);
        if (first) {
            ESP_LOGI(TAG, "Initial input bitmap = 0x%05lx", (unsigned long)levels);
            last = levels;
            first = false;
        } else if (levels != last) {
            for (unsigned i = 0; i < PIN_COUNT; ++i) {
                if ((levels ^ last) & (1UL << i))
                    ESP_LOGI(TAG, "GPIO %u: %u -> %u", (unsigned)pins[i],
                             (unsigned)((last >> i) & 1U),
                             (unsigned)((levels >> i) & 1U));
            }
            last = levels;
        }
        if (++report_ms == 100) {
            report_ms = 0;
            ESP_LOGD(TAG, "Input bitmap 0x%05lx", (unsigned long)levels);
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

void hardware_probe_start(void)
{
    for (unsigned i = 0; i < PIN_COUNT; ++i) {
        esp_err_t err = gpio_input_enable(pins[i]);
        if (err != ESP_OK)
            ESP_LOGW(TAG, "GPIO %u input-enable error: %d", (unsigned)pins[i], (int)err);
    }
    if (xTaskCreate(scan, "hw_probe", 4096, NULL, 3, NULL) != pdPASS)
        ESP_LOGE(TAG, "GPIO probe task creation failed");
}
