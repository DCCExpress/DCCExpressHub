#pragma once
#include <stdbool.h>

/* Read-only GPIO observation; never drives unknown peripheral lines. */
void hardware_probe_start(void);
