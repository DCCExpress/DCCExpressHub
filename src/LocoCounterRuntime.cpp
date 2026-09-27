#include "LocoCounterRuntime.h"

#include "Logger.h"

namespace {
constexpr unsigned long COUNTER_TICK_MS = 500;
}

double LocoCounterRuntime::nonNegative(
    JsonVariantConst value,
    double fallback) {
  const double parsed =
      value.isNull()
          ? fallback
          : value.as<double>();

  return
      isfinite(parsed) &&
              parsed >= 0.0
          ? parsed
          : fallback;
}

LocoCounterRuntime::Entry*
LocoCounterRuntime::find(
    uint16_t address) {
  for (auto& entry : _entries) {
    if (entry.active &&
        entry.address == address) {
      return &entry;
    }
  }

  return nullptr;
}

const LocoCounterRuntime::Entry*
LocoCounterRuntime::find(
    uint16_t address) const {
  for (const auto& entry : _entries) {
    if (entry.active &&
        entry.address == address) {
      return &entry;
    }
  }

  return nullptr;
}

LocoCounterRuntime::Entry*
LocoCounterRuntime::findOrAllocate(
    uint16_t address) {
  if (auto* existing = find(address)) {
    return existing;
  }

  for (auto& entry : _entries) {
    if (!entry.active) {
      entry = Entry{};
      entry.active = true;
      entry.address = address;
      entry.lastUpdateAt = millis();
      return &entry;
    }
  }

  return nullptr;
}

bool LocoCounterRuntime::begin(
    fs::FS& fs,
    const char* path) {
  _fs = &fs;
  _path =
      path && *path
          ? path
          : "/config/locos.json";

  for (auto& entry : _entries) {
    entry = Entry{};
  }

  _trackPowerOn = false;
  _changed = true;
  _nextTickAt = millis() + COUNTER_TICK_MS;

  return reloadConfiguration(false);
}

bool LocoCounterRuntime::reloadConfiguration(
    bool preserveRuntimeTotals) {
  if (!_fs) {
    return false;
  }

  File file = _fs->open(
      _path,
      "r");

  if (!file) {
    Logger::warn(
        "LocoCounter: no locomotive configuration");
    return false;
  }

  JsonDocument document;
  const auto error =
      deserializeJson(
          document,
          file);
  file.close();

  if (error ||
      !document.is<JsonArray>()) {
    Logger::error(
        "LocoCounter: invalid locos.json");
    return false;
  }

  bool seen[MAX_LOCOS] = {};

  for (JsonObjectConst loco :
       document.as<JsonArrayConst>()) {
    const long rawAddress =
        loco["address"] | 0L;

    if (rawAddress <= 0 ||
        rawAddress > 10239) {
      continue;
    }

    const uint16_t address =
        static_cast<uint16_t>(
            rawAddress);

    Entry* entry =
        findOrAllocate(
            address);

    if (!entry) {
      Logger::warn(
          "LocoCounter: runtime capacity exhausted");
      break;
    }

    const size_t index =
        static_cast<size_t>(
            entry - _entries);

    seen[index] = true;

    const bool hadRuntime =
        preserveRuntimeTotals &&
        entry->lastUpdateAt != 0;

    if (!hadRuntime) {
      entry->totalKm =
          nonNegative(
              loco["odometerKm"]);

      entry->totalHours =
          nonNegative(
              loco["operatingHours"]);

      entry->dailyKm = 0.0;
      entry->dailyHours = 0.0;
    }

    entry->maxSpeedStep =
        constrain(
            loco["maxSpeed"] | 100,
            1,
            1000);

    JsonObjectConst counter =
        loco["counterSettings"]
            .as<JsonObjectConst>();

    entry->maxScaleSpeedKmh =
        nonNegative(
            counter["maxScaleSpeedKmh"],
            120.0);

    if (entry->maxScaleSpeedKmh < 1.0) {
      entry->maxScaleSpeedKmh = 120.0;
    }

    entry->lastUpdateAt =
        millis();
  }

  for (size_t i = 0;
       i < MAX_LOCOS;
       ++i) {
    if (_entries[i].active &&
        !seen[i] &&
        _entries[i].speed == 0) {
      _entries[i] = Entry{};
    }
  }

  _changed = true;
  return true;
}

void LocoCounterRuntime::integrate(
    Entry& entry,
    unsigned long now) {
  const unsigned long elapsedMs =
      now - entry.lastUpdateAt;

  entry.lastUpdateAt = now;

  if (!_trackPowerOn ||
      entry.speed == 0 ||
      elapsedMs == 0) {
    return;
  }

  const double elapsedHours =
      static_cast<double>(
          elapsedMs) /
      3600000.0;

  const double speedRatio =
      min(
          1.0,
          max(
              0.0,
              static_cast<double>(
                  entry.speed) /
                  static_cast<double>(
                      max<uint16_t>(
                          1,
                          entry.maxSpeedStep))));

  const double distanceKm =
      entry.maxScaleSpeedKmh *
      speedRatio *
      elapsedHours;

  entry.totalHours += elapsedHours;
  entry.dailyHours += elapsedHours;
  entry.totalKm += distanceKm;
  entry.dailyKm += distanceKm;
}

void LocoCounterRuntime::integrateAll(
    unsigned long now) {
  for (auto& entry : _entries) {
    if (!entry.active) {
      continue;
    }

    integrate(
        entry,
        now);
  }
}

void LocoCounterRuntime::setTrackPower(
    bool on) {
  const unsigned long now =
      millis();

  integrateAll(
      now);

  if (_trackPowerOn == on) {
    return;
  }

  _trackPowerOn = on;

  for (auto& entry : _entries) {
    if (entry.active) {
      entry.lastUpdateAt = now;
    }
  }

  _changed = true;
}

void LocoCounterRuntime::updateLoco(
    uint16_t address,
    uint8_t speed) {
  Entry* entry =
      find(
          address);

  if (!entry) {
    return;
  }

  const unsigned long now =
      millis();

  integrate(
      *entry,
      now);

  if (entry->speed != speed) {
    entry->speed = speed;
    _changed = true;
  }
}

void LocoCounterRuntime::loop() {
  const unsigned long now =
      millis();

  if (static_cast<long>(
          now - _nextTickAt) < 0) {
    return;
  }

  bool moving = false;

  for (auto& entry : _entries) {
    if (!entry.active) {
      continue;
    }

    if (_trackPowerOn &&
        entry.speed > 0) {
      integrate(
          entry,
          now);

      moving = true;
    } else {
      entry.lastUpdateAt = now;
    }
  }

  if (moving) {
    _changed = true;
  }

  _nextTickAt =
      now + COUNTER_TICK_MS;
}

bool LocoCounterRuntime::consumeChanged() {
  const bool changed =
      _changed;

  _changed = false;
  return changed;
}

void LocoCounterRuntime::appendSnapshot(
    JsonArray out) const {
  for (const auto& entry : _entries) {
    if (!entry.active) {
      continue;
    }

    JsonObject item =
        out.add<JsonObject>();

    item["address"] =
        entry.address;

    item["totalKm"] =
        entry.totalKm;

    item["dailyKm"] =
        entry.dailyKm;

    item["totalHours"] =
        entry.totalHours;

    item["dailyHours"] =
        entry.dailyHours;

    item["speed"] =
        entry.speed;

    item["moving"] =
        _trackPowerOn &&
        entry.speed > 0;
  }
}

bool LocoCounterRuntime::save() {
  if (!_fs) {
    return false;
  }

  integrateAll(
      millis());

  File input =
      _fs->open(
          _path,
          "r");

  if (!input) {
    Logger::warn(
        "LocoCounter: locos.json missing during save");
    return false;
  }

  JsonDocument document;
  const auto error =
      deserializeJson(
          document,
          input);
  input.close();

  if (error ||
      !document.is<JsonArray>()) {
    Logger::error(
        "LocoCounter: cannot parse locos.json during save");
    return false;
  }

  for (JsonObject loco :
       document.as<JsonArray>()) {
    const uint16_t address =
        loco["address"] | 0;

    const Entry* entry =
        find(
            address);

    if (!entry) {
      continue;
    }

    loco["odometerKm"] =
        entry->totalKm;

    loco["operatingHours"] =
        entry->totalHours;
  }

  const String tempPath =
      _path + ".counter.tmp";

  const String backupPath =
      _path + ".counter.bak";

  _fs->remove(
      tempPath);

  _fs->remove(
      backupPath);

  File output =
      _fs->open(
          tempPath,
          "w");

  if (!output) {
    Logger::error(
        "LocoCounter: cannot open temp file");
    return false;
  }

  const size_t written =
      serializeJson(
          document,
          output);

  output.flush();
  output.close();

  if (written == 0) {
    _fs->remove(
        tempPath);

    Logger::error(
        "LocoCounter: temp save failed");
    return false;
  }

  if (_fs->exists(_path)) {
    if (!_fs->rename(
            _path,
            backupPath)) {
      _fs->remove(
          tempPath);

      Logger::error(
          "LocoCounter: backup rename failed");
      return false;
    }
  }

  if (!_fs->rename(
          tempPath,
          _path)) {
    if (_fs->exists(
            backupPath)) {
      _fs->rename(
          backupPath,
          _path);
    }

    Logger::error(
        "LocoCounter: commit rename failed");
    return false;
  }

  _fs->remove(
      backupPath);

  Logger::info(
      "LocoCounter: totals saved");

  return true;
}
