#pragma once
#include <Arduino.h>

namespace Logger {
void begin();
void info(const String& message);
void warn(const String& message);
void error(const String& message);
}
