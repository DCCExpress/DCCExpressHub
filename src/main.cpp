#include <Arduino.h>
#include "App.h"

namespace {
App app;
}

void setup() {
  app.begin();
}

void loop() {
  app.loop();
}
