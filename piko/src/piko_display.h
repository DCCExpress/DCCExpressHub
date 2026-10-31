#pragma once
#include "esp_err.h"
/* ST7789 display: disabled until physical SPI/DC/RST/CS GPIO mapping is known. */
esp_err_t piko_display_start(void);
