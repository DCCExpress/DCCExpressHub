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
/* Verified from original 1.3.0.0: GPIO26 serial DATA, GPIO27 CLOCK, GPIO14 LATCH.
   The stock 0x400E3664 routine shifts seven bits MSB first, then raises latch.
   Shift-register output bit 0..6 selects one of seven keypad rows. */
#define KEYPAD_ROWS 7
#define KEYPAD_KEYS (KEYPAD_ROWS * 3)
#define SR_DATA GPIO_NUM_26
#define SR_CLOCK GPIO_NUM_27
#define SR_LATCH GPIO_NUM_14
static const gpio_num_t cols[3] = { GPIO_NUM_32, GPIO_NUM_33, GPIO_NUM_34 };
static const gpio_num_t special[4] = { GPIO_NUM_2, GPIO_NUM_15, GPIO_NUM_12, GPIO_NUM_13 };
static portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;
static uint32_t matrix;
static uint32_t matrix_raw;
static uint8_t columns_idle;
static uint8_t columns_per_row[KEYPAD_ROWS];
static int32_t rotary_position;
static char records[48][100];
static uint32_t event_serial;
static int record_count;

static bool capture_on;
static uint32_t capture_base_raw, capture_base_matrix;
static uint32_t capture_seen_raw, capture_seen_matrix;
static uint8_t capture_base_idle, capture_seen_idle;
static uint8_t capture_base_rows[KEYPAD_ROWS], capture_seen_rows[KEYPAD_ROWS];
static uint8_t capture_base_pins, capture_seen_pins;
static int32_t capture_base_rotary;
static uint32_t capture_samples;
static uint16_t capture_raw_transitions[KEYPAD_KEYS];
static uint16_t capture_pin_transitions[4];
static uint32_t capture_last_raw;
static uint8_t capture_last_pins;
static uint8_t probe_special_bits(void)
{
    return (gpio_get_level(GPIO_NUM_2) ? 1 : 0) |
           (gpio_get_level(GPIO_NUM_15) ? 2 : 0) |
           (gpio_get_level(GPIO_NUM_12) ? 4 : 0) |
           (gpio_get_level(GPIO_NUM_13) ? 8 : 0);
}
void hardware_probe_capture_begin(void)
{
    taskENTER_CRITICAL(&lock);
    capture_base_raw=matrix_raw; capture_base_matrix=matrix;
    capture_base_idle=columns_idle;
    for(int i=0;i<KEYPAD_ROWS;i++) capture_base_rows[i]=columns_per_row[i];
    capture_base_pins=probe_special_bits();
    capture_base_rotary=rotary_position;
    capture_seen_raw=0; capture_seen_matrix=0; capture_seen_idle=0;
    for(int i=0;i<KEYPAD_ROWS;i++) capture_seen_rows[i]=0;
    capture_seen_pins=0; capture_samples=0;
    memset(capture_raw_transitions,0,sizeof(capture_raw_transitions));
    memset(capture_pin_transitions,0,sizeof(capture_pin_transitions));
    capture_last_raw=matrix_raw; capture_last_pins=capture_base_pins;
    capture_on=true;
    taskEXIT_CRITICAL(&lock);
}
void hardware_probe_capture_end(void)
{
    taskENTER_CRITICAL(&lock);
    capture_on=false;
    taskEXIT_CRITICAL(&lock);
}
static size_t put_array(char *out, size_t size, size_t used, const uint16_t *values, unsigned count)
{
    if (used >= size) return used;
    int n = snprintf(out + used, size - used, "[");
    if (n < 0) return used;
    used += (size_t)n;
    for (unsigned i=0; i<count && used<size; ++i) {
        n = snprintf(out + used, size - used, "%s%u", i?",":"", (unsigned)values[i]);
        if (n < 0) return used;
        used += (size_t)n;
    }
    if (used < size) {
        n = snprintf(out + used, size - used, "]");
        if (n > 0) used += (size_t)n;
    }
    return used;
}
void hardware_probe_capture_json(char *out, size_t size)
{
    taskENTER_CRITICAL(&lock);
    size_t pos = (size_t)snprintf(out,size,
      "{\"active\":%s,\"samples\":%lu,\"rawChanged\":%lu,\"matrixChanged\":%lu,"
      "\"idleChanged\":%u,\"pinsChanged\":%u,\"rotaryDelta\":%ld,"
      "\"baseRaw\":%lu,\"currentRaw\":%lu,\"baseIdle\":%u,\"currentIdle\":%u,"
      "\"basePins\":%u,\"currentPins\":%u,\"baseRows\":",
      capture_on?"true":"false",(unsigned long)capture_samples,
      (unsigned long)capture_seen_raw,(unsigned long)capture_seen_matrix,
      (unsigned)capture_seen_idle,(unsigned)capture_seen_pins,
      (long)(rotary_position-capture_base_rotary),
      (unsigned long)capture_base_raw,(unsigned long)matrix_raw,
      (unsigned)capture_base_idle,(unsigned)columns_idle,
      (unsigned)capture_base_pins,(unsigned)probe_special_bits());
    uint16_t array[KEYPAD_KEYS];
    for(int i=0;i<KEYPAD_ROWS;i++) array[i]=capture_base_rows[i];
    pos=put_array(out,size,pos,array,KEYPAD_ROWS);
    if(pos<size) pos+=(size_t)snprintf(out+pos,size-pos,",\"currentRows\":");
    for(int i=0;i<KEYPAD_ROWS;i++) array[i]=columns_per_row[i];
    pos=put_array(out,size,pos,array,KEYPAD_ROWS);
    if(pos<size) pos+=(size_t)snprintf(out+pos,size-pos,",\"rawTransitions\":");
    pos=put_array(out,size,pos,capture_raw_transitions,KEYPAD_KEYS);
    if(pos<size) pos+=(size_t)snprintf(out+pos,size-pos,",\"pinTransitions\":");
    pos=put_array(out,size,pos,capture_pin_transitions,4);
    if(pos<size) snprintf(out+pos,size-pos,"}");
    taskEXIT_CRITICAL(&lock);
}

static void add_event(const char *description)
{
    taskENTER_CRITICAL(&lock);
    unsigned index = event_serial++ % 48;
    snprintf(records[index], sizeof(records[index]), "%lu: %s", (unsigned long)esp_log_timestamp(), description);
    if (record_count < 48) record_count++;
    taskEXIT_CRITICAL(&lock);
    ESP_LOGI(TAG, "%s", description);
}

uint32_t hardware_probe_matrix(void)
{
    taskENTER_CRITICAL(&lock);
    uint32_t result = matrix;
    taskEXIT_CRITICAL(&lock);
    return result;
}

void hardware_probe_json(char *out, size_t size)
{
    uint32_t m;
    uint32_t raw;
    uint8_t idle;
    int32_t rotary;
    taskENTER_CRITICAL(&lock);
    rotary = rotary_position;
    m = matrix;
    raw = matrix_raw;
    idle = columns_idle;

    taskEXIT_CRITICAL(&lock);
    snprintf(out, size, "{\"matrix\":%lu,\"rawMatrix\":%lu,\"idleColumns\":%u,\"rotary\":%ld,\"gpio2\":%d,\"gpio15\":%d,\"gpio12\":%d,\"gpio13\":%d,\"uptime\":%lu}",
             (unsigned long)m, (unsigned long)raw, (unsigned)idle, (long)rotary, gpio_get_level(GPIO_NUM_2), gpio_get_level(GPIO_NUM_15),
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

/* The stock firmware implements serial row selection, not three directly driven
   keypad rows. It drives GPIO14 low, clocks seven data bits on GPIO26/27,
   then drives GPIO14 high (original 0x400E3664). */
static void shift_rows(uint8_t pattern)
{
    gpio_set_level(SR_LATCH, 0);
    for (int bit=6; bit>=0; --bit) {
        gpio_set_level(SR_CLOCK, 0);
        gpio_set_level(SR_DATA, (pattern >> bit) & 1);
        esp_rom_delay_us(3);
        gpio_set_level(SR_CLOCK, 1);
        esp_rom_delay_us(3);
    }
    gpio_set_level(SR_LATCH, 1);
    esp_rom_delay_us(40);
}
static uint8_t read_columns(void)
{
    uint8_t result=0;
    for (int col=0;col<3;col++)
        if (gpio_get_level(cols[col])) result |= (uint8_t)(1u<<col);
    return result;
}
/* One shifted register output low at a time, the rest high.
   Compare with all-high reference: detects either input polarity, and avoids
   falsely interpreting all seven rows as one key. */
static uint32_t sample_matrix(void)
{
    shift_rows(0x7f);
    const uint8_t neutral=read_columns();
    uint32_t key_bits=0;
    uint8_t row_levels[KEYPAD_ROWS];
    for (int r=0;r<KEYPAD_ROWS;r++) {
        shift_rows((uint8_t)(0x7f & ~(1u<<r)));
        const uint8_t level=read_columns();
        row_levels[r]=level;
        key_bits |= ((uint32_t)(level ^ neutral)) << (3*r);
    }
    shift_rows(0x7f);
    taskENTER_CRITICAL(&lock);
    matrix_raw=key_bits;
    columns_idle=neutral;
    for(int i=0;i<KEYPAD_ROWS;i++) columns_per_row[i]=row_levels[i];
    taskEXIT_CRITICAL(&lock);
    return key_bits;
}

static const int8_t quadrature[16] = {0,-1,1,0, 1,0,0,-1, -1,0,0,1, 0,1,-1,0};
static void input_task(void *arg)
{
    (void)arg;
    uint8_t ab = (gpio_get_level(GPIO_NUM_2) << 1) | gpio_get_level(GPIO_NUM_15);
    int accumulator = 0;
    int previous_switch = gpio_get_level(GPIO_NUM_12);
    int previous_stop = gpio_get_level(GPIO_NUM_13);
    uint32_t candidate = sample_matrix(), stable = candidate;
    unsigned debounce = 0;
    add_event("PIKO shift-register keyscan: DATA=26 CLOCK=27 LATCH=14; 7 shifted rows x GPIO32/33/34");
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(10));
        uint32_t now = sample_matrix();
        if (now == candidate) { if (debounce < 3) debounce++; }
        else { candidate = now; debounce = 0; }
        if (debounce == 3 && stable != candidate) {
            uint32_t changed = stable ^ candidate;
            stable = candidate;
            taskENTER_CRITICAL(&lock);
            matrix = stable;
            taskEXIT_CRITICAL(&lock);
            for (int i = 0; i < KEYPAD_KEYS; ++i) if (changed & (1u << i)) {
                char msg[88];
                snprintf(msg, sizeof(msg), "Shift-row %d column GPIO%d %s",
                         i/3, (int)cols[i%3], (stable & (1u<<i)) ? "PRESSED" : "RELEASED");
                add_event(msg);
            }
        }
        taskENTER_CRITICAL(&lock);
        if(capture_on) {
            capture_samples++;
            capture_seen_raw |= matrix_raw ^ capture_base_raw;
            capture_seen_matrix |= matrix ^ capture_base_matrix;
            capture_seen_idle |= columns_idle ^ capture_base_idle;
            for(int i=0;i<KEYPAD_ROWS;i++) capture_seen_rows[i] |= columns_per_row[i] ^ capture_base_rows[i];
            const uint8_t pins=probe_special_bits();
            const uint32_t raw_edges=matrix_raw ^ capture_last_raw;
            const uint8_t pin_edges=pins ^ capture_last_pins;
            for(int i=0;i<KEYPAD_KEYS;i++) if((raw_edges & (1u<<i)) && capture_raw_transitions[i]<65535) capture_raw_transitions[i]++;
            for(int i=0;i<4;i++) if((pin_edges & (1u<<i)) && capture_pin_transitions[i]<65535) capture_pin_transitions[i]++;
            capture_last_raw=matrix_raw; capture_last_pins=pins;
            capture_seen_pins |= pins ^ capture_base_pins;
        }
        taskEXIT_CRITICAL(&lock);
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
    /* Match stock push-pull pin configuration; do not turn these into
       open-drain pseudo-keypad rows. */
    gpio_set_level(SR_LATCH,0);
    gpio_set_level(SR_CLOCK,0);
    gpio_set_level(SR_DATA,0);
    gpio_set_direction(SR_LATCH,GPIO_MODE_OUTPUT);
    gpio_set_direction(SR_CLOCK,GPIO_MODE_OUTPUT);
    gpio_set_direction(SR_DATA,GPIO_MODE_OUTPUT);
    shift_rows(0x7f);
    if (xTaskCreate(input_task, "piko_inputs", 4096, NULL, 3, NULL) != pdPASS)
        ESP_LOGE(TAG, "Input task creation failed");
}
