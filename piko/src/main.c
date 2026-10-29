#include <string.h>
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "z21_client.h"
#include "hardware_probe.h"

static const char *TAG = "piko";
static EventGroupHandle_t wifi_events;

static void heartbeat_task(void *arg)
{
    unsigned long count = 0;
    while (true) {
        ESP_LOGI(TAG, "HEARTBEAT #%lu uptime=%lu ms", ++count,
                 (unsigned long)esp_log_timestamp());
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

#define WIFI_READY BIT0

static void wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(wifi_events, WIFI_READY);
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        xEventGroupSetBits(wifi_events, WIFI_READY);
    }
}

static esp_err_t wifi_start(void)
{
    wifi_events = xEventGroupCreate();
    if (!wifi_events) return ESP_ERR_NO_MEM;
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event, NULL));
    wifi_config_t config = { 0 };
    strlcpy((char *)config.sta.ssid, CONFIG_PIKO_WIFI_SSID, sizeof(config.sta.ssid));
    strlcpy((char *)config.sta.password, CONFIG_PIKO_WIFI_PASSWORD, sizeof(config.sta.password));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &config));
    return esp_wifi_start();
}

void app_main(void)
{
    ESP_LOGW(TAG, "Experimental DCCExpress Z21 handheld; GPIO, display and battery are NOT mapped.");
    if (xTaskCreate(heartbeat_task, "heartbeat", 2048, NULL, 1, NULL) != pdPASS)
        ESP_LOGE(TAG, "Failed to create heartbeat task");
#if CONFIG_PIKO_HW_INPUT_PROBE
    hardware_probe_start();
#endif
    esp_err_t nvs = nvs_flash_init();
    if (nvs == ESP_ERR_NVS_NO_FREE_PAGES || nvs == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGE(TAG, "NVS unavailable; refusing automatic erase of calibration/settings");
        return;
    }
    ESP_ERROR_CHECK(nvs);
    if (strlen(CONFIG_PIKO_WIFI_SSID) == 0) {
        ESP_LOGW(TAG, "Set Wi-Fi and Hub settings via 'pio run -d piko -t menuconfig'.");
        return;
    }
    if (wifi_start() != ESP_OK) return;
    while (true) {
        xEventGroupWaitBits(wifi_events, WIFI_READY, pdFALSE, pdTRUE, portMAX_DELAY);
        if (!z21_is_connected()) {
            if (z21_start(CONFIG_PIKO_HUB_IP, CONFIG_PIKO_Z21_PORT) == ESP_OK) {
                z21_request_serial();
                z21_request_loco(CONFIG_PIKO_LOCO_ADDRESS);
            }
        }
        // Input/UI integration will call z21_set_drive and z21_set_function.
        // Never command a moving locomotive automatically at startup.
        vTaskDelay(pdMS_TO_TICKS(5000));
    }
}
