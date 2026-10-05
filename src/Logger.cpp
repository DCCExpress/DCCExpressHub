#include "Logger.h"

namespace {
void writeLine(
    Print& output,
    const char* level,
    const String& message) {
  output.printf(
      "[%10lu] %-5s %s\n",
      static_cast<unsigned long>(
          millis()),
      level,
      message.c_str());
}

void write(
    const char* level,
    const String& message) {
  writeLine(
      Serial,
      level,
      message);

#if defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT
  // On ESP32-S3 builds Serial is USB CDC, while many Sunton boards expose
  // UART0 through the USB/UART bridge used for flashing and ROM boot logs.
  // Mirror Hub logs to UART0 so the application trace is visible on the same
  // monitor that shows "ESP-ROM..." during reset.
  writeLine(
      Serial0,
      level,
      message);
#endif
}
}

namespace Logger {
void begin() {
  Serial.begin(
      115200);

#if defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT
  Serial0.begin(
      115200);
#endif

  delay(
      250);

  write(
      "INFO",
      "LOGGER READY");
}

void info(const String& message) { write("INFO", message); }
void warn(const String& message) { write("WARN", message); }
void error(const String& message) { write("ERR", message); }
}
