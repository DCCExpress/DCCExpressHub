// Copy the relevant lines into your DCC-EX myHal.cpp.
// If you already have a myHal.cpp, DO NOT replace it blindly.

#include "IO_DCCExpressS88.h"
#include "Sensors.h"

void halSetup() {
    constexpr int FIRST_VPIN = 1001;
    constexpr int SENSOR_COUNT = 32;

    DCCExpressS88::create(FIRST_VPIN, SENSOR_COUNT, 0x30);

    for (int i = 0; i < SENSOR_COUNT; i++) {
        const int id = FIRST_VPIN + i;
        Sensor::create(id, id, 1);
    }
}