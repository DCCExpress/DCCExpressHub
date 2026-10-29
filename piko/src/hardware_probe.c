#include "hardware_probe.h"
#include <stdint.h>
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

static const char *TAG = "piko_hw";
/*
 * PIKO 1.3.0.0 factory firmware verified these INPUTS:
 *   32/33/34 keypad inputs, 2/15 rotary A/B, 12 rotary switch candidate,
 *   13 dedicated STOP input candidate.
 *
 * GPIO26/14/27 are OUTPUTS in the factory keypad driver and MUST NOT be
 * reconfigured as generic inputs. The old all-input probe broke scanning.
 *
 * GPIO2/12/15 are ESP32 boot strapping pins. Read only after startup.
 * Do not change their pulls or drive them.
 */
static const gpio_num_t pins[] = {
    GPIO_NUM_2, GPIO_NUM_12, GPIO_NUM_13, GPIO_NUM_15,
    GPIO_NUM_32, GPIO_NUM_33, GPIO_NUM_34
};
#define COUNT (sizeof(pins) / sizeof(pins[0]))

typedef struct { uint8_t index; uint8_t level; uint32_t ms; } edge_t;
static QueueHandle_t edges;

static void IRAM_ATTR edge_isr(void *arg)
{
    unsigned i = (unsigned)(uintptr_t)arg;
    edge_t e = { (uint8_t)i, (uint8_t)gpio_get_level(pins[i]),
                 (uint32_t)(esp_timer_get_time() / 1000) };
    BaseType_t woken = pdFALSE;
    if (edges) xQueueSendFromISR(edges, &e, &woken);
    if (woken) portYIELD_FROM_ISR();
}

static void log_task(void *arg)
{
    uint32_t changes[COUNT] = {0};
    uint32_t shown[COUNT] = {0};
    uint32_t start = (uint32_t)(esp_timer_get_time() / 1000);
    ESP_LOGW(TAG, "Watching %u firmware-derived GPIO inputs (rotary 2/15, switch 12, STOP 13, keypad 32/33/34)",
             (unsigned)COUNT);
    for (;;) {
        edge_t e;
        if (xQueueReceive(edges, &e, pdMS_TO_TICKS(100)) == pdTRUE && e.index < COUNT) {
            changes[e.index]++;
            /* Show first few edges each second; summarize rapid signals instead. */
            if (shown[e.index]++ < 6)
                ESP_LOGI(TAG, "GPIO %u: edge level=%u at %lu ms",
                         (unsigned)pins[e.index], (unsigned)e.level, (unsigned long)e.ms);
        }
        uint32_t now = (uint32_t)(esp_timer_get_time() / 1000);
        if (now - start >= 1000) {
            for (unsigned i = 0; i < COUNT; ++i) {
                if (changes[i] > 6)
                    ESP_LOGI(TAG, "GPIO %u: %lu edges / second (last level %d)",
                             (unsigned)pins[i], (unsigned long)changes[i],
                             gpio_get_level(pins[i]));
                changes[i] = shown[i] = 0;
            }
            start = now;
        }
    }
}

void hardware_probe_start(void)
{
    edges = xQueueCreate(256, sizeof(edge_t));
    if (!edges) { ESP_LOGE(TAG, "GPIO event queue allocation failed"); return; }
    esp_err_t err = gpio_install_isr_service(0);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "GPIO ISR service failed: %s", esp_err_to_name(err));
        return;
    }
    for (unsigned i = 0; i < COUNT; ++i) {
        gpio_set_direction(pins[i], GPIO_MODE_INPUT);
        /* Do not alter the electrical pull state of the strapping pins. */
        gpio_set_intr_type(pins[i], GPIO_INTR_ANYEDGE);
        err = gpio_isr_handler_add(pins[i], edge_isr, (void *)(uintptr_t)i);
        if (err != ESP_OK)
            ESP_LOGW(TAG, "GPIO %u interrupt setup failed: %s",
                     (unsigned)pins[i], esp_err_to_name(err));
    }
    if (xTaskCreate(log_task, "hw_probe", 4096, NULL, 3, NULL) != pdPASS)
        ESP_LOGE(TAG, "Could not start GPIO log task");
}
