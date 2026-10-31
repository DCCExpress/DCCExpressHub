#include "hardware_probe.h"
#include <stdint.h>
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/*
 * Offline firmware evidence (PIKO handheld 1.3.0.0):
 * keypad outputs: GPIO 26/14/27; inputs: 32/33/34.
 * rotary quadrature: GPIO 2/15; probable rotary switch: GPIO 12;
 * dedicated STOP: GPIO 13.
 *
 * This diagnostic does NOT drive keypad rows or change pull resistors.
 * GPIO 2/12/15 are ESP32 boot straps; read only after startup.
 * Rotary polarity, stop polarity and key identity require hardware tests.
 */
static const char *TAG = "piko_hw";
static const gpio_num_t watched[] = {
    GPIO_NUM_2, GPIO_NUM_15, GPIO_NUM_12, GPIO_NUM_13,
    GPIO_NUM_32, GPIO_NUM_33, GPIO_NUM_34
};
#define COUNT (sizeof(watched) / sizeof(watched[0]))

/* Gray-code quadrature transition table; invalid jumps count as zero. */
static const int8_t quadrature[16] = {
     0, -1,  1, 0,
     1,  0,  0,-1,
    -1,  0,  0, 1,
     0,  1, -1, 0
};

static void input_task(void *arg)
{
    (void)arg;
    uint8_t previous[COUNT];
    uint8_t stable[COUNT];
    uint8_t candidate[COUNT];
    uint8_t counts[COUNT] = {0};
    for (size_t i = 0; i < COUNT; ++i)
        previous[i] = stable[i] = candidate[i] = gpio_get_level(watched[i]);

    uint8_t last_ab = (stable[0] << 1) | stable[1];
    int rotary_accumulator = 0;
    int32_t rotary_position = 0;
    int64_t last_report_us = esp_timer_get_time();
    ESP_LOGW(TAG, "Input diagnostics: rotary GPIO2/15, switch GPIO12, STOP GPIO13, keypad input GPIO32/33/34");
    ESP_LOGW(TAG, "Keypad rows GPIO26/14/27 are NOT driven; no complete key detection yet");
    for (;;) {
        /* 2 ms sampling; no electrical pulls or outputs configured. */
        vTaskDelay(pdMS_TO_TICKS(2) ? pdMS_TO_TICKS(2) : 1);
        uint8_t ab = (gpio_get_level(GPIO_NUM_2) << 1) | gpio_get_level(GPIO_NUM_15);
        if (ab != last_ab) {
            rotary_accumulator += quadrature[(last_ab << 2) | ab];
            last_ab = ab;
            if (rotary_accumulator >= 4 || rotary_accumulator <= -4) {
                int direction = rotary_accumulator > 0 ? 1 : -1;
                rotary_position += direction;
                ESP_LOGI(TAG, "ROTARY step=%+d position=%ld (direction is uncalibrated)",
                         direction, (long)rotary_position);
                rotary_accumulator = 0;
            }
        }

        for (size_t i = 2; i < COUNT; ++i) {
            uint8_t level = gpio_get_level(watched[i]);
            if (level != candidate[i]) {
                candidate[i] = level;
                counts[i] = 0;
            } else if (counts[i] < 10) {
                ++counts[i];
            }
            if (counts[i] == 10 && stable[i] != candidate[i]) {
                stable[i] = candidate[i];
                const char *name = i == 2 ? "ROTARY_SWITCH_CANDIDATE" :
                                   i == 3 ? "STOP" : "KEYPAD_COLUMN";
                ESP_LOGI(TAG, "%s GPIO%d level=%u (active polarity unverified)",
                         name, (int)watched[i], (unsigned)stable[i]);
            }
        }
        if (esp_timer_get_time() - last_report_us >= 10000000) {
            ESP_LOGI(TAG, "Input monitor running; rotary position=%ld", (long)rotary_position);
            last_report_us = esp_timer_get_time();
        }
    }
}

void hardware_probe_start(void)
{
    /* GPIO outputs used by original firmware are deliberately untouched. */
    for (size_t i = 0; i < COUNT; ++i) {
        esp_err_t err = gpio_set_direction(watched[i], GPIO_MODE_INPUT);
        if (err != ESP_OK)
            ESP_LOGE(TAG, "GPIO%d setup failed: %s", (int)watched[i], esp_err_to_name(err));
    }
    if (xTaskCreate(input_task, "piko_inputs", 4096, NULL, 3, NULL) != pdPASS)
        ESP_LOGE(TAG, "Input task creation failed");
}
