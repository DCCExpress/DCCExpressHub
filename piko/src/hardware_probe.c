#include "hardware_probe.h"
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "piko_hw";
static const gpio_num_t rows[3] = { GPIO_NUM_26, GPIO_NUM_14, GPIO_NUM_27 };
static const gpio_num_t cols[3] = { GPIO_NUM_32, GPIO_NUM_33, GPIO_NUM_34 };
static const gpio_num_t special[4] = { GPIO_NUM_2, GPIO_NUM_15, GPIO_NUM_12, GPIO_NUM_13 };
static portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;
static uint16_t matrix;
static int32_t rotary_position;
static char records[48][100];
static uint32_t event_serial;
static int record_count;

static void add_event(const char *description)
{
    taskENTER_CRITICAL(&lock);
    unsigned index = event_serial++ % 48;
    snprintf(records[index], sizeof(records[index]), "%lu: %s", (unsigned long)esp_log_timestamp(), description);
    if (record_count < 48) record_count++;
    taskEXIT_CRITICAL(&lock);
    ESP_LOGI(TAG, "%s", description);
}

uint16_t hardware_probe_matrix(void)
{
    taskENTER_CRITICAL(&lock);
    uint16_t result = matrix;
    taskEXIT_CRITICAL(&lock);
    return result;
}

void hardware_probe_json(char *out, size_t size)
{
    uint16_t m = hardware_probe_matrix();
    int32_t rotary;
    taskENTER_CRITICAL(&lock);
    rotary = rotary_position;
    taskEXIT_CRITICAL(&lock);
    snprintf(out, size, "{\"matrix\":%u,\"rotary\":%ld,\"gpio2\":%d,\"gpio15\":%d,\"gpio12\":%d,\"gpio13\":%d,\"uptime\":%lu}",
             (unsigned)m, (long)rotary, gpio_get_level(GPIO_NUM_2), gpio_get_level(GPIO_NUM_15),
             gpio_get_level(GPIO_NUM_12), gpio_get_level(GPIO_NUM_13), (unsigned long)esp_log_timestamp());
}

void hardware_probe_events_json(char *out, size_t size)
{
    size_t used = 0;
    taskENTER_CRITICAL(&lock);
    used += snprintf(out, size, "[");
    uint32_t first = event_serial - (uint32_t)record_count;
    for (int i = 0; i < record_count && used + 110 < size; ++i) {
        const char *entry = records[(first + (uint32_t)i) % 48];
        used += snprintf(out + used, size - used, "%s\"%s\"", i ? "," : "", entry);
    }
    if (used + 2 <= size) snprintf(out + used, size - used, "]");
    taskEXIT_CRITICAL(&lock);
}

/* Pins inferred from factory firmware; one open-drain row at a time, never drive high.
   GPIO34 has no internal pull-up: the original board must provide input bias.
   No input pull resistors or boot-strap pin output modes are changed. */
static uint16_t sample_matrix(void)
{
    /* Measure the idle column levels first. A floating or stuck-low input
       must not make all three rows appear pressed. */
    for (int r = 0; r < 3; ++r) gpio_set_level(rows[r], 1);
    esp_rom_delay_us(150);
    uint8_t idle[3];
    for (int c = 0; c < 3; ++c) idle[c] = gpio_get_level(cols[c]);

    uint16_t result = 0;
    for (int r = 0; r < 3; ++r) {
        gpio_set_level(rows[r], 0);
        esp_rom_delay_us(150);
        for (int c = 0; c < 3; ++c) {
            if (idle[c] == 1 && gpio_get_level(cols[c]) == 0)
                result |= (uint16_t)(1u << (r * 3 + c));
        }
        gpio_set_level(rows[r], 1);
    }
    return result;
}

static const int8_t quadrature[16] = {0,-1,1,0, 1,0,0,-1, -1,0,0,1, 0,1,-1,0};
static void input_task(void *arg)
{
    (void)arg;
    uint8_t ab = (gpio_get_level(GPIO_NUM_2) << 1) | gpio_get_level(GPIO_NUM_15);
    int accumulator = 0;
    int previous_switch = gpio_get_level(GPIO_NUM_12);
    int previous_stop = gpio_get_level(GPIO_NUM_13);
    uint16_t candidate = sample_matrix(), stable = candidate;
    unsigned debounce = 0;
    add_event("Keypad baseline filtering enabled: stuck-low columns ignored; R1=26 R2=14 R3=27 C1=32 C2=33 C3=34");
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(10));
        uint16_t now = sample_matrix();
        if (now == candidate) { if (debounce < 3) debounce++; }
        else { candidate = now; debounce = 0; }
        if (debounce == 3 && stable != candidate) {
            uint16_t changed = stable ^ candidate;
            stable = candidate;
            taskENTER_CRITICAL(&lock);
            matrix = stable;
            taskEXIT_CRITICAL(&lock);
            for (int i = 0; i < 9; ++i) if (changed & (1u << i)) {
                char msg[88];
                snprintf(msg, sizeof(msg), "Matrix R%d C%d %s (GPIO%d -> GPIO%d)",
                         i/3+1, i%3+1, (stable & (1u<<i)) ? "PRESSED" : "RELEASED",
                         (int)rows[i/3], (int)cols[i%3]);
                add_event(msg);
            }
        }
        uint8_t next_ab = (gpio_get_level(GPIO_NUM_2) << 1) | gpio_get_level(GPIO_NUM_15);
        if (next_ab != ab) {
            accumulator += quadrature[(ab << 2) | next_ab];
            ab = next_ab;
            if (accumulator >= 4 || accumulator <= -4) {
                int step = accumulator > 0 ? 1 : -1;
                accumulator = 0;
                taskENTER_CRITICAL(&lock);
                rotary_position += step;
                taskEXIT_CRITICAL(&lock);
                add_event(step > 0 ? "Rotary +1 (direction uncalibrated)" : "Rotary -1 (direction uncalibrated)");
            }
        }
        int sw = gpio_get_level(GPIO_NUM_12);
        int stop = gpio_get_level(GPIO_NUM_13);
        if (sw != previous_switch) {
            previous_switch = sw;
            add_event(sw ? "Rotary switch GPIO12 HIGH" : "Rotary switch GPIO12 LOW");
        }
        if (stop != previous_stop) {
            previous_stop = stop;
            add_event(stop ? "STOP GPIO13 HIGH" : "STOP GPIO13 LOW");
        }
    }
}

void hardware_probe_start(void)
{
    for (int c = 0; c < 3; ++c) {
        gpio_set_direction(cols[c], GPIO_MODE_INPUT);
    }
    for (int i = 0; i < 4; ++i) {
        gpio_set_direction(special[i], GPIO_MODE_INPUT);
    }
    for (int r = 0; r < 3; ++r) {
        gpio_set_level(rows[r], 1);
        gpio_set_direction(rows[r], GPIO_MODE_INPUT_OUTPUT_OD);
        gpio_set_level(rows[r], 1);
    }
    if (xTaskCreate(input_task, "piko_inputs", 4096, NULL, 3, NULL) != pdPASS)
        ESP_LOGE(TAG, "Input task creation failed");
}
