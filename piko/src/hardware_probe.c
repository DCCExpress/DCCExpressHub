#include "hardware_probe.h"
#include <stdint.h>
#include "driver/gpio.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "piko_hw";

/*
 * Conservative first-pass monitor: input-only ESP32 pins plus 32/33.
 * Deliberately excludes UART0 (1,3), boot straps, flash pins (6-11),
 * and other output-capable pins with unknown display or power functions.
 * GPIO reads are diagnostic observations, not a hardware pin map.
 */
static const gpio_num_t candidates[] = {
    GPIO_NUM_32, GPIO_NUM_33, GPIO_NUM_34,
    GPIO_NUM_35, GPIO_NUM_36, GPIO_NUM_39
};

static void probe_task(void *unused)
{
    uint32_t previous = 0;
    bool initialized = false;
    ESP_LOGW(TAG, "GPIO monitor is READ-ONLY; six candidate inputs, no pulls or output drives.");
    for (;;) {
        uint32_t levels = 0;
        for (unsigned i = 0; i < sizeof(candidates)/sizeof(candidates[0]); i++)
            if (gpio_get_level(candidates[i])) levels |= (1u << i);
        if (!initialized || levels != previous) {
            for (unsigned i = 0; i < sizeof(candidates)/sizeof(candidates[0]); i++)
                if (!initialized || ((levels ^ previous) & (1u << i)))
                    ESP_LOGI(TAG, "GPIO %u = %u", (unsigned)candidates[i],
                             (unsigned)((levels >> i) & 1u));
            previous = levels;
            initialized = true;
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

void hardware_probe_start(void)
{
    for (unsigned i = 0; i < sizeof(candidates)/sizeof(candidates[0]); i++) {
        /* Input-enable only. No pull-up, pull-down, output mode or pin reset. */
        esp_err_t err = gpio_input_enable(candidates[i]);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "GPIO %u enable failed: %d", (unsigned)candidates[i], err);
            return;
        }
    }
    if (xTaskCreate(probe_task, "hw_probe", 3072, NULL, 2, NULL) != pdPASS)
        ESP_LOGE(TAG, "Could not start probe task");
}
