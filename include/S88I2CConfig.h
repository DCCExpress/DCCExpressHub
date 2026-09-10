#pragma once

// -----------------------------------------------------------------------------
// DCCExpressHub - S88 I2C transport defaults
//
// The Arduino S88 adapter owns its S88 byte count. The Hub stores only the
// adapter I2C address (plus the generic enabled flag), requests adapter INFO,
// learns the byte count from that response, then reads exactly that many bytes.
// Sensor addresses are fixed to 1..N on the Hub side.
// -----------------------------------------------------------------------------

#ifndef S88_I2C_ENABLED
  #if defined(HUB_TARGET_M5STACK_BASIC)
    #define S88_I2C_ENABLED 1
  #else
    #define S88_I2C_ENABLED 0
  #endif
#endif

#ifndef S88_I2C_ADDRESS
#define S88_I2C_ADDRESS 0x30
#endif

#ifndef S88_I2C_SDA_PIN
#define S88_I2C_SDA_PIN 21
#endif

#ifndef S88_I2C_SCL_PIN
#define S88_I2C_SCL_PIN 22
#endif

#ifndef S88_I2C_CLOCK_HZ
#define S88_I2C_CLOCK_HZ 100000UL
#endif

#ifndef S88_I2C_READ_INTERVAL_MS
#define S88_I2C_READ_INTERVAL_MS 20UL
#endif

#ifndef S88_I2C_PROBE_INTERVAL_MS
#define S88_I2C_PROBE_INTERVAL_MS 2000UL
#endif

// Retry INFO quickly while an adapter answers at the configured address but
// has not yet returned a valid v0.5+ INFO packet.
#ifndef S88_I2C_INFO_RETRY_MS
#define S88_I2C_INFO_RETRY_MS 1000UL
#endif

// Re-read INFO periodically so a serial-side byte-count change is discovered
// without restarting the Hub.
#ifndef S88_I2C_INFO_REFRESH_MS
#define S88_I2C_INFO_REFRESH_MS 5000UL
#endif

// Successful S88 reads normally happen every 20 ms. If no successful read has
// happened for this long, the UI treats the data as stale.
#ifndef S88_I2C_DATA_FRESH_MS
#define S88_I2C_DATA_FRESH_MS 1000UL
#endif

#ifndef S88_WS_SNAPSHOT_INTERVAL_MS
#define S88_WS_SNAPSHOT_INTERVAL_MS 1000UL
#endif

static_assert(
    S88_I2C_ADDRESS >= 0x08 &&
    S88_I2C_ADDRESS <= 0x77,
    "S88_I2C_ADDRESS must be a normal 7-bit I2C address");
