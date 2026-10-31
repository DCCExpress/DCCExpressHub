#include "piko_wifi.h"
#include <string.h>
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "mdns.h"
#include "nvs_flash.h"
#include "ota_web.h"

static const char *TAG = "piko_wifi";

static void wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGW(TAG, "Wi-Fi disconnected; reconnecting (AP remains available)");
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)data;
        ESP_LOGI(TAG, "Station: http://" IPSTR ":%d/ (or http://piko.local:%d/)",
                 IP2STR(&event->ip_info.ip), CONFIG_PIKO_OTA_PORT, CONFIG_PIKO_OTA_PORT);
    }
}

esp_err_t piko_wifi_start(void)
{
    bool station = CONFIG_PIKO_WIFI_SSID[0] != '\0';
    size_t ap_len = strlen(CONFIG_PIKO_AP_PASSWORD);
    if (ap_len < 8 || ap_len > 63) {
        ESP_LOGE(TAG, "Access point password must contain 8-63 characters; Wi-Fi disabled");
        return ESP_ERR_INVALID_ARG;
    }
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGE(TAG, "NVS requires repair; refusing to erase existing configuration");
        return err;
    }
    if (err != ESP_OK) return err;
    if ((err = esp_netif_init()) != ESP_OK) return err;
    if ((err = esp_event_loop_create_default()) != ESP_OK) return err;

    esp_netif_t *ap = esp_netif_create_default_wifi_ap();
    if (!ap) return ESP_ERR_NO_MEM;
    if (station && !esp_netif_create_default_wifi_sta()) return ESP_ERR_NO_MEM;

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    if ((err = esp_wifi_init(&cfg)) != ESP_OK) return err;
    if (station) {
        if ((err = esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event, NULL)) != ESP_OK) return err;
        if ((err = esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event, NULL)) != ESP_OK) return err;
    }
    if ((err = esp_wifi_set_storage(WIFI_STORAGE_RAM)) != ESP_OK) return err;
    if ((err = esp_wifi_set_mode(station ? WIFI_MODE_APSTA : WIFI_MODE_AP)) != ESP_OK) return err;

    wifi_config_t ap_config = {0};
    strlcpy((char *)ap_config.ap.ssid, CONFIG_PIKO_AP_SSID, sizeof(ap_config.ap.ssid));
    strlcpy((char *)ap_config.ap.password, CONFIG_PIKO_AP_PASSWORD, sizeof(ap_config.ap.password));
    ap_config.ap.ssid_len = strlen((char *)ap_config.ap.ssid);
    ap_config.ap.channel = 1;
    ap_config.ap.max_connection = 2;
    ap_config.ap.authmode = WIFI_AUTH_WPA2_PSK;
    if ((err = esp_wifi_set_config(WIFI_IF_AP, &ap_config)) != ESP_OK) return err;

    if (station) {
        wifi_config_t sta_config = {0};
        strlcpy((char *)sta_config.sta.ssid, CONFIG_PIKO_WIFI_SSID, sizeof(sta_config.sta.ssid));
        strlcpy((char *)sta_config.sta.password, CONFIG_PIKO_WIFI_PASSWORD, sizeof(sta_config.sta.password));
        if ((err = esp_wifi_set_config(WIFI_IF_STA, &sta_config)) != ESP_OK) return err;
    }

    if ((err = mdns_init()) != ESP_OK) {
        ESP_LOGE(TAG, "mDNS initialization failed: %s", esp_err_to_name(err));
        return err;
    }
    if ((err = mdns_hostname_set("piko")) != ESP_OK) return err;
    if ((err = mdns_instance_name_set("PIKO Firmware Update")) != ESP_OK) return err;
    if ((err = mdns_service_add("PIKO Firmware Update", "_http", "_tcp", CONFIG_PIKO_OTA_PORT, NULL, 0)) != ESP_OK) return err;

    if ((err = piko_ota_web_start()) != ESP_OK) return err;
    if ((err = esp_wifi_start()) != ESP_OK) return err;
    ESP_LOGI(TAG, "Own Wi-Fi network: %s", CONFIG_PIKO_AP_SSID);
    ESP_LOGI(TAG, "Open http://192.168.4.1:%d/ (or http://piko.local:%d/ if mDNS resolves)",
             CONFIG_PIKO_OTA_PORT, CONFIG_PIKO_OTA_PORT);
    if (!station) ESP_LOGI(TAG, "Station SSID empty; standalone access point mode");
    return ESP_OK;
}
