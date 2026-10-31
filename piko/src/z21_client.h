#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

typedef struct {
    uint16_t address;
    uint8_t speed; /* DCC 128 step: 0..126 */
    bool forward;
    uint32_t functions;
    bool valid;
} z21_loco_state_t;

esp_err_t z21_start(const char *host, uint16_t port);
void z21_stop(void);
bool z21_is_connected(void); /* UDP peer configured; not an established session */
esp_err_t z21_request_serial(void);
esp_err_t z21_request_loco(uint16_t address);
esp_err_t z21_set_drive(uint16_t address, uint8_t speed, bool forward);
esp_err_t z21_set_function(uint16_t address, uint8_t function, bool enabled);
bool z21_get_loco_state(z21_loco_state_t *out);
