#include "LocoCounterRuntime.h"

#include "FileStore.h"
#include "Logger.h"

#include <math.h>

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
    const char* configPath,
    const char* statePath) {
  _fs = &fs;
  _configPath =
      configPath && *configPath
          ? configPath
          : "/config/locos.json";
  _statePath =
      statePath && *statePath
          ? statePath
          : "/state/loco-counters.json";

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
      _configPath,
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

  JsonDocument stateDocument;
  bool hasState = false;

  {
    File stateFile =
        _fs->open(
            _statePath,
            "r");

    if (stateFile) {
      const auto stateError =
          deserializeJson(
              stateDocument,
              stateFile);

      stateFile.close();

      hasState =
          !stateError &&
          stateDocument["items"]
              .is<JsonArray>();
    }
  }

  auto readPersistedTotal =
      [&](uint16_t address,
          const char* field,
          double fallback) {
        if (!hasState) {
          return fallback;
        }

        for (JsonObjectConst item :
             stateDocument["items"]
                 .as<JsonArrayConst>()) {
          if ((item["address"] | 0) != address) {
            continue;
          }

          return
              nonNegative(
                  item[field],
                  fallback);
        }

        return fallback;
      };

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

    const bool existed =
        find(
            address) !=
        nullptr;

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
        existed;

    if (!hadRuntime) {
      const double legacyKm =
          nonNegative(
              loco["odometerKm"]);

      const double legacyHours =
          nonNegative(
              loco["operatingHours"]);

      entry->totalKm =
          readPersistedTotal(
              address,
              "totalKm",
              legacyKm);

      entry->totalHours =
          readPersistedTotal(
              address,
              "totalHours",
              legacyHours);

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
                      entry.maxSpeedStep > 0
                          ? entry.maxSpeedStep
                          : 1)));

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
  if (_reloadRequested) {
    _reloadRequested = false;
    reloadConfiguration(true);
  }

  if (_saveRequested) {
    _saveRequested = false;
    save();
  }

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

void LocoCounterRuntime::requestSave() {
  _saveRequested = true;
}

void LocoCounterRuntime::requestReload() {
  _reloadRequested = true;
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

  JsonDocument document;
  document["version"] = 1;

  JsonArray items =
      document["items"]
          .to<JsonArray>();

  for (const auto& entry : _entries) {
    if (!entry.active) {
      continue;
    }

    JsonObject item =
        items.add<JsonObject>();

    item["address"] =
        entry.address;

    item["totalKm"] =
        entry.totalKm;

    item["totalHours"] =
        entry.totalHours;
  }

  FileStore store(*_fs);

  if (!store.saveJson(
          _statePath.c_str(),
          document)) {
    Logger::error(
        "LocoCounter: state save failed");

    return false;
  }

  Logger::info(
      "LocoCounter: totals saved to " +
      _statePath);

  return true;
}
