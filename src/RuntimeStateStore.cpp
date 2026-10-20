#include "RuntimeStateStore.h"

#include <ArduinoJson.h>

#include "Logger.h"

bool RuntimeStateStore::begin(
    fs::FS& fs,
    LayoutRuntime& runtime) {
  _fs = &fs;
  _runtime = &runtime;

  FileStore files(fs);
  return files.ensureParent("/state/runtime-state.json");
}

bool RuntimeStateStore::load(const char* path) {
  if (!_fs || !_runtime) return false;

  FileStore files(*_fs);
  File file = files.openRead(path);

  if (!file) {
    Logger::info("No saved runtime state; defaults remain active");
    return true;
  }

  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, file);
  file.close();

  if (error) {
    Logger::warn(String("Runtime state parse failed: ") + error.c_str());
    return false;
  }

  // v3: authoritative physical runtime state only.
  JsonObjectConst basic = doc["basicAccessories"];
  for (JsonPairConst pair : basic) {
    const uint16_t address = static_cast<uint16_t>(atoi(pair.key().c_str()));
    if (!address) continue;
    _runtime->setAccessory(address, pair.value().as<bool>());
  }

  JsonObjectConst extended = doc["extendedAccessories"];
  for (JsonPairConst pair : extended) {
    const uint16_t address = static_cast<uint16_t>(atoi(pair.key().c_str()));
    const int aspect = pair.value().as<int>();
    if (!address || aspect < 0 || aspect > 255) continue;
    _runtime->setSignal(address, aspect);
  }

  JsonObjectConst vpins = doc["vpins"];
  for (JsonPairConst pair : vpins) {
    const uint16_t address = static_cast<uint16_t>(atoi(pair.key().c_str()));
    if (!address) continue;
    _runtime->setVPin(address, pair.value().as<bool>());
  }

  // Read-only migration from old semantic v2 storage. Values are accepted
  // only when they map to the CURRENT layout topology, so protocol changes do
  // not leak stale state across Basic <-> Extended.
  JsonObjectConst legacy = doc["accessories"];
  for (JsonPairConst pair : legacy) {
    JsonObjectConst value = pair.value().as<JsonObjectConst>();
    const char* key = pair.key().c_str();

    if (strncmp(key, "accessory:", 10) == 0) {
      _runtime->setAccessory(
          static_cast<uint16_t>(atoi(key + 10)),
          value["active"] | false);
    } else if (strncmp(key, "signal:", 7) == 0) {
      if (!value["aspect"].isNull()) {
        const int aspect = value["aspect"].as<int>();
        if (aspect >= 0 && aspect <= 255) {
          _runtime->setSignal(
              static_cast<uint16_t>(atoi(key + 7)),
              aspect);
        }
      }
    } else if (strncmp(key, "vpin:", 5) == 0) {
      _runtime->setVPin(
          static_cast<uint16_t>(atoi(key + 5)),
          value["active"] | false);
    } else if (strncmp(key, "turnout:", 8) == 0) {
      const uint16_t address = static_cast<uint16_t>(atoi(key + 8));
      RuntimeAccessory* turnout =
          _runtime->findAccessory(RuntimeAccessoryKind::Turnout, address);

      if (!turnout || turnout->turnoutExtended) continue;

      const bool logicalClosed = value["closed"] | false;
      const bool physicalValue =
          logicalClosed
              ? turnout->closedValue
              : !turnout->closedValue;

      _runtime->setTurnout(address, physicalValue);
    }
  }

  // Sensor state is intentionally never restored. DCC-EX <Q> is authoritative.

  JsonObjectConst blocks = doc["blocks"];
  for (JsonPairConst pair : blocks) {
    const long blockIdValue = atol(pair.key().c_str());
    if (blockIdValue <= 0 || blockIdValue > 0xffff) continue;

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

  Logger::info("Physical runtime state restored");
  return true;
}

bool RuntimeStateStore::save(const char* path) {
  if (!_fs || !_runtime) return false;

  JsonDocument doc;
  doc["version"] = 3;
  doc["savedAtMs"] = millis();

  JsonObject basic = doc["basicAccessories"].to<JsonObject>();
  for (const auto& item : _runtime->basicAccessories()) {
    basic[String(item.address)] = item.active;
  }

  JsonObject extended = doc["extendedAccessories"].to<JsonObject>();
  for (const auto& item : _runtime->extendedAccessories()) {
    extended[String(item.address)] = item.aspect;
  }

  JsonObject vpins = doc["vpins"].to<JsonObject>();
  for (const auto& item : _runtime->vpinStates()) {
    vpins[String(item.address)] = item.active;
  }

  JsonObject blocks = doc["blocks"].to<JsonObject>();
  for (const auto& block : _runtime->blocks()) {
    if (!block.occupied()) continue;

    JsonObject state = blocks[String(block.id)].to<JsonObject>();
    if (block.locoId.isEmpty()) state["locoId"] = nullptr;
    else state["locoId"] = block.locoId;

    if (block.locoAddress > 0) state["locoAddress"] = block.locoAddress;
  }

  FileStore files(*_fs);
  if (!files.saveJson(path, doc)) {
    Logger::error("Runtime state atomic save failed");
    return false;
  }

  Logger::info("Physical runtime state saved on POWER OFF");
  return true;
}
