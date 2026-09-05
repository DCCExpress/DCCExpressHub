#include "RuntimeStateStore.h"

#include <ArduinoJson.h>
#include "Logger.h"

bool RuntimeStateStore::begin(fs::FS& fs, LayoutRuntime& runtime) {
  _fs = &fs;
  _runtime = &runtime;
  ensureDirectory("/state");
  return true;
}

bool RuntimeStateStore::ensureDirectory(const char* path) {
  if (!_fs) return false;
  if (_fs->exists(path)) return true;
  return _fs->mkdir(path);
}

bool RuntimeStateStore::load(const char* path) {
  if (!_fs || !_runtime) return false;

  File file = _fs->open(path, "r");
  if (!file) {
    Logger::info("No saved runtime state; defaults remain active");
    return true;
  }

  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, file);
  file.close();

  if (error) {
    Logger::warn(String("Runtime state parse failed: ") + error.c_str());
    return false;
  }

  JsonObjectConst accessories = doc["accessories"];
  for (JsonPairConst pair : accessories) {
    JsonObjectConst value = pair.value().as<JsonObjectConst>();
    const char* key = pair.key().c_str();

    if (strncmp(key, "turnout:", 8) == 0) {
      _runtime->setTurnout(atoi(key + 8), value["closed"] | false);
    } else if (strncmp(key, "signal:", 7) == 0) {
      if (!value["aspect"].isNull()) {
        _runtime->setSignal(atoi(key + 7), value["aspect"].as<int>());
      }
    } else if (strncmp(key, "accessory:", 10) == 0) {
      _runtime->setAccessory(atoi(key + 10), value["active"] | false);
    } else if (strncmp(key, "vpin:", 5) == 0) {
      _runtime->setVPin(atoi(key + 5), value["active"] | false);
    }
  }

  JsonObjectConst sensors = doc["sensors"];
  for (JsonPairConst pair : sensors) {
    _runtime->setSensor(
        atoi(pair.key().c_str()),
        pair.value()["on"] | false);
  }

  JsonObjectConst blocks = doc["blocks"];
  for (JsonPairConst pair : blocks) {
    const long blockIdValue = atol(pair.key().c_str());
    if (blockIdValue <= 0 || blockIdValue > 0xffff) {
      continue;
    }

    JsonObjectConst value = pair.value().as<JsonObjectConst>();
    const String locoId = value["locoId"].isNull()
        ? String()
        : String(value["locoId"].as<const char*>());

    const long locoAddressValue = value["locoAddress"] | 0L;
    const uint16_t locoAddress =
        locoAddressValue > 0 && locoAddressValue <= 10239
            ? static_cast<uint16_t>(locoAddressValue)
            : 0;

    _runtime->setBlock(
        static_cast<uint16_t>(blockIdValue),
        locoId,
        locoAddress);
  }

  Logger::info("Runtime state restored");
  return true;
}

bool RuntimeStateStore::save(const char* path) {
  if (!_fs || !_runtime) return false;

  ensureDirectory("/state");

  const String tmpPath = String(path) + ".tmp";
  File file = _fs->open(tmpPath, "w");
  if (!file) {
    Logger::error("Cannot open runtime state temp file");
    return false;
  }

  JsonDocument doc;
  doc["version"] = 2;
  doc["savedAtMs"] = millis();

  JsonObject accessories = doc["accessories"].to<JsonObject>();
  for (const auto& item : _runtime->accessories()) {
    String key;
    switch (item.kind) {
      case RuntimeAccessoryKind::Turnout:
        key = "turnout:" + String(item.address);
        accessories[key]["closed"] = item.closed;
        break;
      case RuntimeAccessoryKind::Signal:
        key = "signal:" + String(item.address);
        if (item.aspect >= 0) {
          accessories[key]["aspect"] = item.aspect;
        } else {
          accessories[key]["aspect"] = nullptr;
        }
        break;
      case RuntimeAccessoryKind::Accessory:
        key = "accessory:" + String(item.address);
        accessories[key]["active"] = item.active;
        break;
      case RuntimeAccessoryKind::VPin:
        key = "vpin:" + String(item.address);
        accessories[key]["active"] = item.active;
        break;
    }
  }

  JsonObject sensors = doc["sensors"].to<JsonObject>();
  for (const auto& sensor : _runtime->sensors()) {
    sensors[String(sensor.address)]["on"] = sensor.on;
  }

  // Only occupied blocks need to be persisted. Empty blocks are reconstructed
  // from layout.json and start empty by default.
  JsonObject blocks = doc["blocks"].to<JsonObject>();
  for (const auto& block : _runtime->blocks()) {
    if (!block.occupied()) continue;

    JsonObject state =
        blocks[String(block.id)].to<JsonObject>();

    if (block.locoId.isEmpty()) {
      state["locoId"] = nullptr;
    } else {
      state["locoId"] = block.locoId;
    }

    if (block.locoAddress > 0) {
      state["locoAddress"] = block.locoAddress;
    }
  }

  if (serializeJson(doc, file) == 0) {
    file.close();
    _fs->remove(tmpPath);
    Logger::error("Runtime state serialization failed");
    return false;
  }

  file.flush();
  file.close();

  if (_fs->exists(path)) {
    _fs->remove(path);
  }

  if (!_fs->rename(tmpPath, path)) {
    Logger::error("Runtime state atomic rename failed");
    return false;
  }

  Logger::info("Runtime state saved on POWER OFF");
  return true;
}
