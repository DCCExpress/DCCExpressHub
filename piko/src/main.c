#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "DCCExpress-Piko";

void app_main(void)
{
    ESP_LOGW(TAG, "Experimental PIKO handheld firmware skeleton.");
    ESP_LOGW(TAG, "No display, keys, battery or Z21 support enabled yet.");
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
