idf_component_register(SRCS "main.c" "z21_client.c" "hardware_probe.c" INCLUDE_DIRS "." REQUIRES driver esp_wifi esp_event esp_netif nvs_flash lwip)
