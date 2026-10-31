#include "piko_display.h"
#include "sdkconfig.h"
#include "esp_log.h"

static const char *TAG = "piko_display";

esp_err_t piko_display_start(void)
{
    /* FP-200H05B JY is a flex marking, not verified pinout or controller ID.
       Never guess peripheral GPIOs on a powered handheld. */
    ESP_LOGW(TAG, "LCD not initialized: FP-200H05B JY detected, controller and SPI GPIO map unverified");
    return ESP_ERR_NOT_SUPPORTED;
}
