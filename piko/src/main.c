#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "hardware_probe.h"
#include "piko_wifi.h"
#include "piko_display.h"

static const char *TAG = "piko";

void app_main(void)
{
    ESP_LOGW(TAG, "PIKO OEM-style numeric keypad firmware. Z21 drive commands disabled.");
    ESP_LOGW(TAG, "Keypad codes recovered from original firmware; verify physical behavior.");
    ESP_LOGW(TAG, "STOP and other special buttons are not mapped.");
    hardware_probe_start();
    esp_err_t wifi = piko_wifi_start();
    if (wifi != ESP_OK)
        ESP_LOGW(TAG, "OTA Wi-Fi disabled: %s", esp_err_to_name(wifi));
    /* No guessed LCD pins are driven on boot. /lcd remains manual diagnostic only. */
    ESP_LOGI(TAG, "LCD trial disabled at boot; no confirmed PIKO LCD pinout");
    uint32_t seconds = 0;
    while (true) {
        ESP_LOGI(TAG, "HEARTBEAT #%lu uptime=%lu ms",
                 (unsigned long)++seconds, (unsigned long)esp_log_timestamp());
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
