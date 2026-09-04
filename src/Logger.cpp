#include "Logger.h"

namespace {
void write(const char* level, const String& message) {
  Serial.printf("[%10lu] %-5s %s\n",
                static_cast<unsigned long>(millis()),
                level,
                message.c_str());
}
}

namespace Logger {
void begin() {
  Serial.begin(115200);
  delay(250);
}

void info(const String& message) { write("INFO", message); }
void warn(const String& message) { write("WARN", message); }
void error(const String& message) { write("ERR", message); }
}
