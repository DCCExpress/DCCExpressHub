// Copy the relevant lines into your DCC-EX myHal.cpp.
// If you already have a myHal.cpp, DO NOT replace it blindly.

#include "IO_DCCExpressS88.h"

void halSetup() {
  // firstVpin, number of S88 inputs, adapter I2C address
  DCCExpressS88::create(1001, 32, 0x30);
}
