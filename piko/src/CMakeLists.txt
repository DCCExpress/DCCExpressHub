idf_component_register(
    SRCS "main.c" "z21_client.c" "hardware_probe.c" "piko_wifi.c" "ota_web.c" "piko_display.c"
    INCLUDE_DIRS "."
    REQUIRES driver esp_wifi esp_event esp_netif nvs_flash lwip esp_http_server app_update mdns
)
