#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "hardware_probe.h"

static const char *TAG = "piko";

void app_main(void)
{
    ESP_LOGW(TAG, "PIKO HARDWARE DISCOVERY MODE: Wi-Fi and Z21 disabled.");
    ESP_LOGW(TAG, "Display is not initialized: LCD controller and pins unknown.");
    ESP_LOGW(TAG, "GPIO observations are not yet identified buttons/rotary signals.");
    hardware_probe_start();
    uint32_t seconds = 0;
    while (true) {
        ESP_LOGI(TAG, "HEARTBEAT #%lu uptime=%lu ms",
                 (unsigned long)++seconds, (unsigned long)esp_log_timestamp());
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
