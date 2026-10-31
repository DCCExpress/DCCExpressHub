#pragma once
#include <stddef.h>
#include <stdint.h>

/* OEM-derived numeric key driver:
 * serial DATA GPIO26 / CLOCK GPIO27 / LATCH GPIO14,
 * queued rising-edge inputs GPIO32/33/34, 6 logical row indices.
 * Physical row gating remains unverified on the PIKO handheld.
 */
void hardware_probe_start(void);
uint32_t hardware_probe_matrix(void); /* retired diagnostic; returns 0 */
void hardware_probe_json(char *out, size_t size);
void hardware_probe_events_json(char *out, size_t size);

/* Legacy experimental scan endpoints: no longer drive any alternate patterns. */
void hardware_probe_capture_begin(void);
void hardware_probe_capture_end(void);
void hardware_probe_capture_json(char *out, size_t size);
