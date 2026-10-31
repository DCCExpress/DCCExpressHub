#pragma once
#include "esp_err.h"
/* Experimental ST7789-compatible trial: 1=VSPI mode0, 2=VSPI mode3, 3=MOSI19 mode0. */
esp_err_t piko_display_start(void);
esp_err_t piko_display_trial(int profile);
