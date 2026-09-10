#pragma once

// -----------------------------------------------------------------------------
// DCCExpressHub - S88 I2C defaults
//
// Runtime values are loaded from /config/device-config.json when an
// "s88adapter" device exists.
//
// IMPORTANT:
//   1 S88 transport group = 8 feedback bits = 1 byte.
//
// Physical modules may expose 8, 16, 32... inputs. The Hub does not need to
// know the physical module boundaries; it reads one continuous S88 bit stream.
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
#define S88_I2C_DEFAULT_GROUP_COUNT 2
#endif

// Arduino AVR Wire transmit buffer is 32 bytes.
// 32 byte-groups = 256 feedback inputs.
#ifndef S88_I2C_MAX_GROUPS
#define S88_I2C_MAX_GROUPS 32
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
    "Invalid default S88 byte-group count");

static_assert(
    S88_I2C_MAX_GROUPS <= 32,
    "AVR Wire can return at most 32 S88 bytes in one request");
