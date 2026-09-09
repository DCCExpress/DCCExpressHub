#pragma once

// -----------------------------------------------------------------------------
// DCCExpressHub - S88 I2C master configuration
// -----------------------------------------------------------------------------

#ifndef S88_I2C_ENABLED
  #if defined(HUB_TARGET_M5STACK_BASIC)
    #define S88_I2C_ENABLED 1
  #else
    #define S88_I2C_ENABLED 0
  #endif
#endif

// Arduino S88 adapter I2C slave address.
#ifndef S88_I2C_ADDRESS
#define S88_I2C_ADDRESS 0x30
#endif

// Occupancy address assigned to S88 input 1.
// Input 1 -> BASE, input 2 -> BASE+1, ... input 16 -> BASE+15.
#ifndef S88_I2C_BASE_SENSOR_ADDRESS
#define S88_I2C_BASE_SENSOR_ADDRESS 1
#endif

#ifndef S88_I2C_INPUT_COUNT
#define S88_I2C_INPUT_COUNT 16
#endif

// M5Stack Basic GROVE Port A / internal I2C bus.
#ifndef S88_I2C_SDA_PIN
#define S88_I2C_SDA_PIN 21
#endif

#ifndef S88_I2C_SCL_PIN
#define S88_I2C_SCL_PIN 22
#endif

#ifndef S88_I2C_CLOCK_HZ
#define S88_I2C_CLOCK_HZ 100000UL
#endif

// Read occupancy bytes from the UNO every 20 ms.
#ifndef S88_I2C_READ_INTERVAL_MS
#define S88_I2C_READ_INTERVAL_MS 20UL
#endif

// Probe address presence for hot-plug diagnostics.
#ifndef S88_I2C_PROBE_INTERVAL_MS
#define S88_I2C_PROBE_INTERVAL_MS 2000UL
#endif

// Periodic WS snapshot so newly connected clients learn the current state.
#ifndef S88_WS_SNAPSHOT_INTERVAL_MS
#define S88_WS_SNAPSHOT_INTERVAL_MS 1000UL
#endif

static_assert(
    S88_I2C_ADDRESS >= 0x08 &&
    S88_I2C_ADDRESS <= 0x77,
    "S88_I2C_ADDRESS must be a normal 7-bit I2C address (0x08..0x77)");

static_assert(
    S88_I2C_INPUT_COUNT == 16,
    "Current S88 Hub transport expects exactly 16 inputs / 2 bytes");

static_assert(
    S88_I2C_BASE_SENSOR_ADDRESS >= 1 &&
    S88_I2C_BASE_SENSOR_ADDRESS <= 65520,
    "S88 base address must leave room for 16 input addresses");
