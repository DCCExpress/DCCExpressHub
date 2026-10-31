#pragma once
#include "esp_err.h"
/* Start the local-network firmware update server (requires working Wi-Fi). */
esp_err_t piko_ota_web_start(void);
