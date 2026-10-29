#include "hardware_probe.h"
#include <stdint.h>
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

static const char *TAG = "piko_hw";
/* No boot straps, flash bus or UART0. Never drive an unknown pin. */
static const gpio_num_t pins[] = {
    GPIO_NUM_13, GPIO_NUM_14, GPIO_NUM_16, GPIO_NUM_17,
    GPIO_NUM_18, GPIO_NUM_19, GPIO_NUM_21, GPIO_NUM_22,
    GPIO_NUM_23, GPIO_NUM_25, GPIO_NUM_26, GPIO_NUM_27,
    GPIO_NUM_32, GPIO_NUM_33, GPIO_NUM_34, GPIO_NUM_35,
    GPIO_NUM_36, GPIO_NUM_39
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
    ESP_LOGW(TAG, "GPIO edge interrupts enabled on %u candidate inputs; no pulls or outputs",
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
        gpio_set_pull_mode(pins[i], GPIO_FLOATING);
        gpio_set_intr_type(pins[i], GPIO_INTR_ANYEDGE);
        err = gpio_isr_handler_add(pins[i], edge_isr, (void *)(uintptr_t)i);
        if (err != ESP_OK)
            ESP_LOGW(TAG, "GPIO %u interrupt setup failed: %s",
                     (unsigned)pins[i], esp_err_to_name(err));
    }
    if (xTaskCreate(log_task, "hw_probe", 4096, NULL, 3, NULL) != pdPASS)
        ESP_LOGE(TAG, "Could not start GPIO log task");
}
