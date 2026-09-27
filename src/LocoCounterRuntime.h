#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <FS.h>

class LocoCounterRuntime {
public:
  static constexpr size_t MAX_LOCOS = 32;

  bool begin(
      fs::FS& fs,
      const char* path = "/config/locos.json");

  bool reloadConfiguration(
      bool preserveRuntimeTotals = true);

  void setTrackPower(
      bool on);

  void updateLoco(
      uint16_t address,
      uint8_t speed);

  void loop();

  bool save();

  bool consumeChanged();

  void appendSnapshot(
      JsonArray out) const;

private:
  struct Entry {
    bool active = false;
    uint16_t address = 0;
    double totalKm = 0.0;
    double totalHours = 0.0;
    double dailyKm = 0.0;
    double dailyHours = 0.0;
    uint16_t maxSpeedStep = 100;
    double maxScaleSpeedKmh = 120.0;
    uint8_t speed = 0;
    unsigned long lastUpdateAt = 0;
  };

  fs::FS* _fs = nullptr;
  String _path = "/config/locos.json";
  Entry _entries[MAX_LOCOS];
  bool _trackPowerOn = false;
  bool _changed = false;
  unsigned long _nextTickAt = 0;

  Entry* find(
      uint16_t address);

  const Entry* find(
      uint16_t address) const;

  Entry* findOrAllocate(
      uint16_t address);

  void integrate(
      Entry& entry,
      unsigned long now);

  void integrateAll(
      unsigned long now);

  static double nonNegative(
      JsonVariantConst value,
      double fallback = 0.0);
};
