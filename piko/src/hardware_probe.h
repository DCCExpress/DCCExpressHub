#pragma once
#include <stddef.h>
#include <stdint.h>
void hardware_probe_start(void);
/* 3x3 raw active-low matrix samples (R1..3 GPIO26/14/27, C1..3 GPIO32/33/34). */
uint16_t hardware_probe_matrix(void);
void hardware_probe_json(char *out, size_t size);
void hardware_probe_events_json(char *out, size_t size);
