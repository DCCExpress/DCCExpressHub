#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "hardware_probe.h"
#include "piko_wifi.h"
#include "piko_display.h"

static const char *TAG = "piko";

void app_main(void)
{
    ESP_LOGW(TAG, "PIKO HARDWARE DISCOVERY MODE: Z21 drive commands disabled.");
    ESP_LOGW(TAG, "Experimental LCD RGB trial (candidate GPIOs; not verified PIKO wiring).");
    ESP_LOGW(TAG, "GPIO observations are not yet identified buttons/rotary signals.");
    hardware_probe_start();
    piko_display_start();
    esp_err_t wifi = piko_wifi_start();
    if (wifi != ESP_OK)
        ESP_LOGW(TAG, "OTA Wi-Fi disabled: %s", esp_err_to_name(wifi));
    uint32_t seconds = 0;
    while (true) {
        ESP_LOGI(TAG, "HEARTBEAT #%lu uptime=%lu ms",
                 (unsigned long)++seconds, (unsigned long)esp_log_timestamp());
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
