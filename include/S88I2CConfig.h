#pragma once

// -----------------------------------------------------------------------------
// DCCExpressHub - S88 I2C defaults
//
// Runtime values are loaded from /config/device-config.json when an
// "s88adapter" device exists. These values are only fallbacks.
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

#ifndef S88_I2C_BASE_SENSOR_ADDRESS
#define S88_I2C_BASE_SENSOR_ADDRESS 1
#endif

#ifndef S88_I2C_DEFAULT_GROUP_COUNT
#define S88_I2C_DEFAULT_GROUP_COUNT 1
#endif

// Arduino Wire can return at most 32 bytes in one request.
// One S88 group = 16 sensors = 2 bytes.
#ifndef S88_I2C_MAX_GROUPS
#define S88_I2C_MAX_GROUPS 16
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

#ifndef S88_WS_SNAPSHOT_INTERVAL_MS
#define S88_WS_SNAPSHOT_INTERVAL_MS 1000UL
#endif

static_assert(
    S88_I2C_ADDRESS >= 0x08 &&
    S88_I2C_ADDRESS <= 0x77,
    "S88_I2C_ADDRESS must be a normal 7-bit I2C address");

static_assert(
    S88_I2C_DEFAULT_GROUP_COUNT >= 1 &&
    S88_I2C_DEFAULT_GROUP_COUNT <= S88_I2C_MAX_GROUPS,
    "Invalid default S88 group count");

static_assert(
    S88_I2C_MAX_GROUPS <= 16,
    "16 groups = 32 bytes, the AVR Wire transmit-buffer limit");
