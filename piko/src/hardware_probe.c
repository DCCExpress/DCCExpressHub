/*
 * PIKO SmartControl WLAN – OEM-style numeric keypad driver (candidate).
 * Original OTA_1 1.3.0.0: serializer 0x400E3664, row task 0x400E3704,
 * GPIO event worker 0x400E2DA0, digit dispatch 0x400E3004.
 *
 * No extra GPIO guesses, no HOT/COLD scan, no row-by-row polling.
 * Physical verification is necessary: earlier experimental firmware could
 * not electrically isolate rows. Do NOT use keypad input for track power.
 */
#include "hardware_probe.h"
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_attr.h"
#include "esp_log.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#define PIN_DATA    GPIO_NUM_26
#define PIN_CLOCK   GPIO_NUM_27
#define PIN_LATCH   GPIO_NUM_14
#define ROW_COUNT   6
#define ROW_FREEZE   (1u << 0)
#define OEM_BIT6     0x40u
#define LOG_CAPACITY 48
#define LOG_LEN      92
#define RELEASE_DEBOUNCE_MS 25
#define WORKER_WAIT_TICKS  pdMS_TO_TICKS(10)
#define EVENT_QUEUE_DEPTH 8

static const char *TAG = "piko_keypad";
static const gpio_num_t column_pins[3] = { GPIO_NUM_32, GPIO_NUM_33, GPIO_NUM_34 };
/* From the original ReadKeysTask, NOT inferred from GPIO scan experiments. */
static const int8_t keycodes[6][3] = {
    {-1,-1,-1}, {-1,-1,-1}, {-1,-1,0},
    {1,2,3}, {4,5,6}, {7,8,9}
};
typedef struct {
    gpio_num_t gpio;
    uint8_t row_on_irq;
    uint8_t serial_mask_on_irq;
    bool during_shift;
} column_event_t;

static QueueHandle_t event_queue;
static EventGroupHandle_t row_group;
static portMUX_TYPE state_lock = portMUX_INITIALIZER_UNLOCKED;
static portMUX_TYPE scan_lock = portMUX_INITIALIZER_UNLOCKED;
static volatile uint32_t pending_key_events;
static volatile uint8_t current_row = 0;
static volatile bool shifting;
static volatile uint32_t ignored_while_shifting;
static volatile uint32_t irq_queue_overflows;
static uint8_t shadow_mask = OEM_BIT6 | 0x01u;
static char events[LOG_CAPACITY][LOG_LEN];
static unsigned event_count;
static uint32_t event_serial;
static int last_digit = -1;
static uint8_t last_code;
static uint8_t last_row;
static uint8_t last_gpio;
static uint8_t last_worker_row;
static uint8_t last_irq_mask;
static volatile uint32_t row_races;
static uint32_t digit_counts[10];
static volatile bool ready;

static void log_text(const char *message)
{
    taskENTER_CRITICAL(&state_lock);
    unsigned slot = event_serial++ % LOG_CAPACITY;
    snprintf(events[slot], sizeof(events[slot]), "%lu %s",
             (unsigned long)esp_log_timestamp(), message);
    if (event_count < LOG_CAPACITY) ++event_count;
    taskEXIT_CRITICAL(&state_lock);
    ESP_LOGI(TAG, "%s", message);
}

/* Seven bits MSB first, matching the original call sequence exactly:
 * GPIO14=0, [GPIO27=0, GPIO26=bit, GPIO27=1] x 7, GPIO14=1.
 * The bit6 function is not fully reverse engineered; OEM initial mask 0x41.
 */
static void write_serial(uint8_t mask)
{
    gpio_set_level(PIN_LATCH, 0);
    for (int bit=6; bit>=0; --bit) {
        gpio_set_level(PIN_CLOCK, 0);
        gpio_set_level(PIN_DATA, (mask >> bit) & 1);
        gpio_set_level(PIN_CLOCK, 1);
    }
    gpio_set_level(PIN_LATCH, 1);
}

/* ISR does not infer a digit or do GPIO writes. Capture the selected row
 * at the edge, because a queued event may be processed after the timer tick.
 * No floating GPIO12 measurements, no inappropriate STOP mapping.
 */
static void IRAM_ATTR on_column(void *argument)
{
    const gpio_num_t gpio=(gpio_num_t)(uintptr_t)argument;
    if(!event_queue) return;

    column_event_t event={.gpio=gpio};
    bool accepted=false;
    /* Synchronously inhibit row stepping BEFORE the worker dequeues the
     * event. The event group alone was too late: the timer could advance.
     * Never call xEventGroupSetBits() from the ISR. */
    portENTER_CRITICAL_ISR(&scan_lock);
    /* The OEM row change itself may raise the column GPIO: do NOT drop
     * IRQs just because the seven serial bits are being latched. The row
     * task assigns next row before shifting, so it is the target selector. */
    event.during_shift=shifting;
    if(shifting) ++ignored_while_shifting; /* legacy name: now COUNTED, not dropped */
    event.row_on_irq=current_row;
    event.serial_mask_on_irq=shadow_mask;
    ++pending_key_events;
    accepted=true;
    portEXIT_CRITICAL_ISR(&scan_lock);
    if(!accepted) return;

    BaseType_t higher=pdFALSE;
    if(xQueueSendFromISR(event_queue,&event,&higher)!=pdTRUE) {
        portENTER_CRITICAL_ISR(&scan_lock);
        if(pending_key_events) --pending_key_events;
        ++irq_queue_overflows;
        portEXIT_CRITICAL_ISR(&scan_lock);
    }
    if(higher) portYIELD_FROM_ISR();
}

static void row_task(void *arg)
{
    (void)arg;
    for(;;) {
        if((xEventGroupGetBits(row_group)&ROW_FREEZE)==0) {
            bool do_step=false;
            uint8_t pattern=0;
            taskENTER_CRITICAL(&scan_lock);
            /* pending_key_events is set already by ISR, before its queue
             * message can be received. Keep the selected output untouched. */
            if(pending_key_events==0) {
                const uint8_t previous=current_row;
                const uint8_t next=(uint8_t)((previous+1)%ROW_COUNT);
                pattern=(uint8_t)((shadow_mask & ~(1u<<previous)) | (1u<<next));
                current_row=next;
                shadow_mask=pattern;
                shifting=true;
                do_step=true;
            }
            taskEXIT_CRITICAL(&scan_lock);
            if(do_step) {
                write_serial(pattern);
                taskENTER_CRITICAL(&scan_lock);
                shifting=false;
                taskEXIT_CRITICAL(&scan_lock);
            }
        }
        vTaskDelay(1);
    }
}

static int digit_of(uint8_t row, gpio_num_t gpio)
{
    int column = (gpio == GPIO_NUM_32) ? 0 :
                 (gpio == GPIO_NUM_33) ? 1 :
                 (gpio == GPIO_NUM_34) ? 2 : -1;
    if (row >= ROW_COUNT || column < 0) return -1;
    return keycodes[row][column];
}

static void event_worker(void *arg)
{
    (void)arg;
    column_event_t evt;
    for (;;) {
        if (xQueueReceive(event_queue, &evt, portMAX_DELAY) != pdTRUE)
            continue;
        xEventGroupSetBits(row_group, ROW_FREEZE);
        gpio_intr_disable(evt.gpio);
        const uint8_t row = evt.row_on_irq;
        const uint8_t worker_row=current_row;
        if(worker_row!=row) ++row_races;
        const uint8_t code = (uint8_t)(((row+1u)<<4) |
                            (evt.gpio == GPIO_NUM_32 ? 1u :
                             evt.gpio == GPIO_NUM_33 ? 2u : 3u));
        const int digit = digit_of(row, evt.gpio);
        /* Reject very short spikes. A real held key should stay HIGH while
         * the OEM row is frozen, then become LOW when released. */
        bool stable_high = gpio_get_level(evt.gpio) != 0;
        if (stable_high) {
            vTaskDelay(pdMS_TO_TICKS(15) ? pdMS_TO_TICKS(15) : 1);
            stable_high = gpio_get_level(evt.gpio) != 0;
        }
        if (stable_high) {
            char message[LOG_LEN];
            taskENTER_CRITICAL(&state_lock);
            last_digit = digit;
            last_code = code;
            last_row = row;
            last_gpio = (uint8_t)evt.gpio;
            last_worker_row = worker_row;
            last_irq_mask = evt.serial_mask_on_irq;
            if (digit >= 0) digit_counts[digit]++;
            taskEXIT_CRITICAL(&state_lock);
            if (digit >= 0) snprintf(message, sizeof(message),
                "DIGIT %d? 0x%02X irq=%u work=%u GPIO%d shift=%u",
                digit, code, (unsigned)row, (unsigned)worker_row, (int)evt.gpio, (unsigned)evt.during_shift);
            else {
                const bool oem_function =
                    code==0x12 || code==0x21 || code==0x22 ||
                    code==0x23 || code==0x31 || code==0x32;
                snprintf(message, sizeof(message),
                    "%s 0x%02X irq=%u work=%u GPIO%d shift=%u",
                    oem_function?"OTHER OEM KEY":"UNKNOWN CODE",
                    code, (unsigned)row, (unsigned)worker_row, (int)evt.gpio, (unsigned)evt.during_shift);
            }
            log_text(message);
            /* Freeze while held; no repeats; 3s max to avoid a permanent
             * firmware hang on a stuck HIGH input. */
            uint32_t held_ms = 0;
            uint32_t released_ms = 0;
            while (held_ms < 3000 && released_ms < RELEASE_DEBOUNCE_MS) {
                vTaskDelay(WORKER_WAIT_TICKS ? WORKER_WAIT_TICKS : 1);
                held_ms += 10;
                if (gpio_get_level(evt.gpio)) released_ms = 0;
                else released_ms += 10;
            }
        }
        /* A still HIGH input can retrigger immediately after rearming.
         * We do not fabricate new numeric presses: rearm only after the
         * input is LOW, with finite timeout and explicit warning. */
        if (gpio_get_level(evt.gpio)) {
            /* A permanently HIGH input must not freeze the row driver forever. */
            /* Release the early ISR freeze, too, so the scanner can run. */
            taskENTER_CRITICAL(&scan_lock);
            if(pending_key_events) --pending_key_events;
            taskEXIT_CRITICAL(&scan_lock);
            xEventGroupClearBits(row_group, ROW_FREEZE);
            char message[LOG_LEN];
            snprintf(message, sizeof(message),
                "GPIO%d stayed HIGH; ignoring until next LOW (stuck key)",
                (int)evt.gpio);
            log_text(message);
            while (gpio_get_level(evt.gpio)) vTaskDelay(pdMS_TO_TICKS(20) ? pdMS_TO_TICKS(20) : 1);
            gpio_intr_enable(evt.gpio);
            continue; /* pending count was already released above */
        }
        gpio_intr_enable(evt.gpio);
        taskENTER_CRITICAL(&scan_lock);
        if(pending_key_events) --pending_key_events;
        taskEXIT_CRITICAL(&scan_lock);
        xEventGroupClearBits(row_group, ROW_FREEZE);
    }
}

uint32_t hardware_probe_matrix(void)
{
    return 0; /* old experimental 6x3 matrix is not a valid key reading */
}

void hardware_probe_json(char *out, size_t size)
{
    int digit;
    unsigned code, row, gpio, process_row, irq_mask;
    uint32_t counts[10];
    taskENTER_CRITICAL(&state_lock);
    digit=last_digit;
    code=last_code;
    row=last_row;
    gpio=last_gpio;
    process_row=last_worker_row;
    irq_mask=last_irq_mask;
    memcpy(counts,digit_counts,sizeof(counts));
    taskEXIT_CRITICAL(&state_lock);
    size_t used=(size_t)snprintf(out,size,
        "{\"mode\":\"oem-numeric\",\"ready\":%s,\"lastDigit\":%d,"
        "\"lastCode\":%u,\"lastRow\":%u,\"lastGpio\":%u,"
        "\"selectedRow\":%u,\"workerRow\":%u,\"irqMask\":%u,"
        "\"queued\":%u,\"pending\":%lu,\"rowRaces\":%lu,\"irqOverflows\":%lu,"
        "\"switchIgnored\":%lu,\"counts\":[",
        ready?"true":"false",digit,code,row,gpio,
        (unsigned)current_row,process_row,irq_mask,
        event_queue?(unsigned)uxQueueMessagesWaiting(event_queue):0u,
        (unsigned long)pending_key_events,(unsigned long)row_races,
        (unsigned long)irq_queue_overflows,(unsigned long)ignored_while_shifting);
    for (int i=0;i<10 && used<size;i++)
        used+=(size_t)snprintf(out+used,size-used,"%s%lu",i?",":"",
                               (unsigned long)counts[i]);
    if (used<size) snprintf(out+used,size-used,"]}");
}

void hardware_probe_events_json(char *out, size_t size)
{
    taskENTER_CRITICAL(&state_lock);
    size_t used=0;
    if(size) used=(size_t)snprintf(out,size,"[");
    unsigned first = event_serial - event_count;
    for(unsigned i=0;i<event_count && used+LOG_LEN+4<size;i++) {
        const char *record=events[(first+i)%LOG_CAPACITY];
        /* Numeric events consist only of fixed ASCII templates. */
        used+=(size_t)snprintf(out+used,size-used,"%s\"%s\"",i?",":"",record);
    }
    if(used<size) snprintf(out+used,size-used,"]");
    taskEXIT_CRITICAL(&state_lock);
}

/* Retired endpoints retained as harmless API compatibility functions.
 * They do NOT switch pins into the failed experimental HOT/COLD modes. */
void hardware_probe_capture_begin(void) { }
void hardware_probe_capture_end(void) { }
void hardware_probe_capture_json(char *out, size_t size)
{
    snprintf(out,size,"{\"supported\":false,\"reason\":\"OEM numeric keypad active; experimental row scan retired\"}");
}

void hardware_probe_start(void)
{
    ready=false;
    row_group=xEventGroupCreate();
    event_queue=xQueueCreate(EVENT_QUEUE_DEPTH,sizeof(column_event_t));
    if(!row_group||!event_queue) {
        ESP_LOGE(TAG,"Keypad queue/event-group allocation failed");
        return;
    }
    /* PIKO OEM pin initializer sets these three pins push-pull output, with
     * latch/clock/data initially LOW; GPIO32,33,34 are inputs. */
    gpio_set_level(PIN_DATA, 0);
    gpio_set_level(PIN_CLOCK, 0);
    gpio_set_level(PIN_LATCH, 0);
    gpio_set_direction(PIN_DATA,GPIO_MODE_OUTPUT);
    gpio_set_direction(PIN_CLOCK,GPIO_MODE_OUTPUT);
    gpio_set_direction(PIN_LATCH,GPIO_MODE_OUTPUT);
    for(int c=0;c<3;c++) gpio_set_direction(column_pins[c],GPIO_MODE_INPUT);
    /* OEM config uses GPIO columns as inputs with rising-edge IRQ.
     * GPIO34 is input-only, with NO internal pulls. */
    gpio_set_pull_mode(GPIO_NUM_32,GPIO_PULLDOWN_ONLY);
    gpio_set_pull_mode(GPIO_NUM_33,GPIO_PULLDOWN_ONLY);
    current_row=0;
    shadow_mask=OEM_BIT6|1u;
    write_serial(shadow_mask);
    esp_err_t err=gpio_install_isr_service(0);
    if(err!=ESP_OK && err!=ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG,"GPIO ISR service unavailable: %s",esp_err_to_name(err));
        return;
    }
    for(int c=0;c<3;c++) {
        err=gpio_set_intr_type(column_pins[c],GPIO_INTR_POSEDGE);
        if(err==ESP_OK) err=gpio_isr_handler_add(column_pins[c],on_column,
                                               (void*)(uintptr_t)column_pins[c]);
        if(err!=ESP_OK) {
            ESP_LOGE(TAG,"Keypad GPIO%d handler failed: %s",
                     (int)column_pins[c],esp_err_to_name(err));
            return;
        }
    }
    if(xTaskCreate(event_worker,"piko_key_worker",4096,NULL,6,NULL)!=pdPASS ||
       xTaskCreate(row_task,"piko_key_rows",3072,NULL,5,NULL)!=pdPASS) {
        ESP_LOGE(TAG,"Unable to start keypad worker/row task");
        return;
    }
    ready=true;
    log_text("OEM numeric decoder started. Digits 0..9 are candidates until physical validation; STOP unmapped.");
}
