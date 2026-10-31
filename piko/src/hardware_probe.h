#pragma once
#include <stddef.h>
#include <stdint.h>
void hardware_probe_start(void);
/* 7x3 shifted keyboard: DATA26/CLOCK27/LATCH14, columns GPIO32/33/34. */
uint32_t hardware_probe_matrix(void);
void hardware_probe_json(char *out, size_t size);
void hardware_probe_events_json(char *out, size_t size);

void hardware_probe_capture_begin(void);
void hardware_probe_capture_end(void);
void hardware_probe_capture_json(char *out, size_t size);
