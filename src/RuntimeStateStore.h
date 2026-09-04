#pragma once

#include <Arduino.h>
#include <LittleFS.h>
#include "LayoutRuntime.h"

class RuntimeStateStore {
public:
  bool begin(fs::FS& fs, LayoutRuntime& runtime);

  bool load(const char* path = "/state/runtime-state.json");
  bool save(const char* path = "/state/runtime-state.json");

private:
  fs::FS* _fs = nullptr;
  LayoutRuntime* _runtime = nullptr;

  bool ensureDirectory(const char* path);
};
