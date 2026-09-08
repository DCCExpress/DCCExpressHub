#include "LayoutRuntime.h"

#include <ArduinoJson.h>
#include "Logger.h"

namespace {
uint16_t readElementId(JsonObjectConst element) {
  const long value = element["id"] | 0L;

  if (value <= 0 || value > 0xffff) {
    return 0;
  }

  return static_cast<uint16_t>(value);
}

bool readPersistedNumericId(
    JsonVariantConst value,
    uint16_t& out) {
  if (
      value.isNull() ||
      value.is<bool>() ||
      value.is<const char*>()
  ) {
    return false;
  }

  if (
      !value.is<long>() &&
      !value.is<unsigned long>() &&
      !value.is<int>() &&
      !value.is<unsigned int>()
  ) {
    return false;
  }

  const long raw =
      value.as<long>();

  if (
      raw <= 0 ||
      raw > 0xffff
  ) {
    return false;
  }

  out =
      static_cast<uint16_t>(
          raw);

  return true;
}

bool containsId(
    const std::vector<uint16_t>& ids,
    uint16_t id) {
  for (
      const uint16_t item :
      ids
  ) {
    if (item == id) {
      return true;
    }
  }

  return false;
}

uint16_t nextFreeLayoutId(
    const std::vector<uint16_t>& used,
    uint16_t start) {
  uint32_t candidate =
      start > 0
          ? start
          : 1;

  for (
      uint32_t attempts = 0;
      attempts < 0xffffUL;
      ++attempts
  ) {
    if (candidate > 0xffffUL) {
      candidate = 1;
    }

    const uint16_t id =
        static_cast<uint16_t>(
            candidate);

    if (!containsId(used, id)) {
      return id;
    }

    ++candidate;
  }

  return 0;
}

// Keep firmware runtime IDs bit-for-bit compatible with the browser-side
// migrateSerializedLayoutIds() algorithm. This is critical for automation:
// compiled rules reference layout IDs, while restored/legacy layouts may still
// contain UUID/string IDs on LittleFS.
size_t migrateRuntimeElementIds(
    JsonDocument& doc) {
  JsonArray layers =
      doc["layers"]
          .as<JsonArray>();

  std::vector<uint16_t> reservedNumeric;
  std::vector<uint16_t> seenNumeric;

  // Pass 1: reserve every first unique persisted numeric ID, regardless of
  // where it occurs in the layout. Legacy/string IDs must never steal one.
  for (
      JsonObject layer :
      layers
  ) {
    JsonArray elements =
        layer["elements"]
            .as<JsonArray>();

    for (
        JsonObject element :
        elements
    ) {
      uint16_t id = 0;

      if (
          readPersistedNumericId(
              element["id"],
              id) &&
          !containsId(
              reservedNumeric,
              id)
      ) {
        reservedNumeric.push_back(
            id);
      }
    }
  }

  std::vector<uint16_t> used =
      reservedNumeric;

  uint16_t next =
      1;

  size_t migrated =
      0;

  // Pass 2: keep the first occurrence of every valid numeric ID. UUID/string,
  // missing and duplicate IDs receive the lowest free uint16 ID in persisted
  // layer/element order -- exactly like the web UI migration.
  for (
      JsonObject layer :
      layers
  ) {
    JsonArray elements =
        layer["elements"]
            .as<JsonArray>();

    for (
        JsonObject element :
        elements
    ) {
      uint16_t persistedId =
          0;

      const bool hasNumericId =
          readPersistedNumericId(
              element["id"],
              persistedId);

      uint16_t runtimeId =
          0;

      if (
          hasNumericId &&
          !containsId(
              seenNumeric,
              persistedId)
      ) {
        runtimeId =
            persistedId;

        seenNumeric.push_back(
            persistedId);
      } else {
        runtimeId =
            nextFreeLayoutId(
                used,
                next);

        if (runtimeId == 0) {
          Logger::error(
              "LayoutRuntime: no free uint16 element ID");

          continue;
        }

        used.push_back(
            runtimeId);

        next =
            runtimeId ==
                    0xffff
                ? 1
                : static_cast<uint16_t>(
                      runtimeId +
                      1);

        ++migrated;
      }

      if (
          !hasNumericId ||
          persistedId !=
              runtimeId
      ) {
        element["id"] =
            runtimeId;
      }
    }
  }

  if (migrated > 0) {
    Logger::warn(
        "LayoutRuntime: migrated " +
        String(migrated) +
        " legacy/duplicate element ID(s) in RAM");
  }

  return migrated;
}
}

bool LayoutRuntime::begin(fs::FS& fs) {
  _fs = &fs;
  return rebuildFromLayout();
}

bool LayoutRuntime::isTurnoutType(const char* type) {
  if (!type) return false;

  return strcmp(type, "trackturnout") == 0 ||
         strcmp(type, "trackturnoutleft") == 0 ||
         strcmp(type, "trackturnoutright") == 0 ||
         strcmp(type, "trackturnoutdouble") == 0 ||
         strcmp(type, "trackturnouttwoway") == 0 ||
         strcmp(type, "trackturnouttreeway") == 0;
}

bool LayoutRuntime::isSignalType(const char* type) {
  if (!type) return false;

  return strcmp(type, "tracksignal") == 0 ||
         strcmp(type, "tracksignal2") == 0 ||
         strcmp(type, "tracksignal3") == 0 ||
         strcmp(type, "tracksignal4") == 0;
}

void LayoutRuntime::notify(
    RuntimeChangeKind kind,
    uint16_t id,
    uint8_t channel) {
  for (const auto& callback :
       _changeCallbacks) {
    if (callback) {
      callback(
          kind,
          id,
          channel);
    }
  }
}

void LayoutRuntime::addElement(JsonObjectConst element) {
  const char* type = element["type"] | "";
  const uint16_t id = readElementId(element);

  if (strcmp(type, "trackblock") == 0) {
    if (!id) return;

    RuntimeBlock block;
    block.id = id;
    _blocks.push_back(std::move(block));
    return;
  }

  if (isTurnoutType(type)) {
    const bool isDouble =
        strcmp(type, "trackturnoutdouble") == 0;

    if (isDouble) {
      const uint16_t address1 =
          element["turnout1Address"] | 0;

      const uint16_t address2 =
          element["turnout2Address"] | 0;

      if (address1) {
        RuntimeAccessory item;
        item.id = id;
        item.kind = RuntimeAccessoryKind::Turnout;
        item.address = address1;
        item.channel = 0;
        item.closedValue =
            element["turnout1ClosedValue"] | false;
        _accessories.push_back(std::move(item));
      }

      if (address2) {
        RuntimeAccessory item;
        item.id = id;
        item.kind = RuntimeAccessoryKind::Turnout;
        item.address = address2;
        item.channel = 1;
        item.closedValue =
            element["turnout2ClosedValue"] | false;
        _accessories.push_back(std::move(item));
      }

      return;
    }

    uint16_t address =
        element["turnoutAddress"] | 0;

    if (!address) {
      address = element["address"] | 0;
    }

    if (!address) return;

    RuntimeAccessory item;
    item.id = id;
    item.kind = RuntimeAccessoryKind::Turnout;
    item.address = address;
    item.channel = 0;
    item.closedValue =
        element["turnoutClosedValue"] | false;

    _accessories.push_back(std::move(item));
    return;
  }

  if (isSignalType(type)) {
    JsonObjectConst signalOutput =
        element["signalOutput"];

    uint16_t address =
        signalOutput["address"] | 0;

    if (!address) {
      address = element["address"] | 0;
    }

    if (!address) return;

    const char* protocol =
        signalOutput["protocol"] | "dccext";

    RuntimeAccessory item;
    item.id = id;
    item.kind = RuntimeAccessoryKind::Signal;
    item.address = address;
    item.aspect = -1;
    item.signalExtended =
        strcmp(protocol, "dccext") == 0;
    item.signalOutputCount =
        constrain(
            signalOutput["outputCount"] | 1,
            1,
            16);

    _accessories.push_back(std::move(item));
    return;
  }

  if (strcmp(type, "button") == 0) {
    const uint16_t address =
        element["address"] | 0;

    if (!address) return;

    const char* outputMode =
        element["outputMode"] | "accessory";

    // Button VPIN support is retired. Extended buttons are represented as
    // signal-like runtime items so their aspect can be retained in RAM/state.
    RuntimeAccessory item;
    item.id = id;
    item.address = address;

    if (strcmp(outputMode, "extended") == 0) {
      item.kind = RuntimeAccessoryKind::Signal;
      item.aspect = -1;
      item.signalExtended = true;
      item.signalOutputCount = 1;
    } else {
      item.kind = RuntimeAccessoryKind::Accessory;
      item.active = false;
    }

    _accessories.push_back(std::move(item));
    return;
  }

  if (strcmp(type, "tracksensor") == 0) {
    const uint16_t address =
        element["address"] | 0;

    if (!address) return;

    RuntimeSensor sensor;
    sensor.id = id;
    sensor.address = address;
    sensor.on = false;

    _sensors.push_back(std::move(sensor));
  }
}

bool LayoutRuntime::rebuildFromLayout(
    const char* path) {
  if (!_fs) return false;

  File file =
      _fs->open(path, "r");

  if (!file) {
    Logger::warn(
        String("LayoutRuntime: no layout at ") +
        path);

    _accessories.clear();
    _sensors.clear();
    _blocks.clear();
    return true;
  }

  const auto oldAccessories =
      _accessories;

  const auto oldSensors =
      _sensors;

  const auto oldBlocks =
      _blocks;

  JsonDocument filter;
  JsonObject element =
      filter["layers"][0]["elements"][0]
          .to<JsonObject>();

  element["type"] = true;
  element["id"] = true;
  element["address"] = true;
  element["turnoutAddress"] = true;
  element["turnoutClosedValue"] = true;
  element["turnout1Address"] = true;
  element["turnout2Address"] = true;
  element["turnout1ClosedValue"] = true;
  element["turnout2ClosedValue"] = true;
  element["outputMode"] = true;
  element["signalOutput"]["address"] = true;
  element["signalOutput"]["protocol"] = true;
  element["signalOutput"]["outputCount"] = true;

  JsonDocument doc;

  const DeserializationError error =
      deserializeJson(
          doc,
          file,
          DeserializationOption::Filter(filter));

  file.close();

  if (error) {
    Logger::error(
        String("LayoutRuntime parse failed: ") +
        error.c_str());

    return false;
  }

  _accessories.clear();
  _sensors.clear();
  _blocks.clear();

  // The browser compiles signal automation against migrated numeric layout
  // IDs. Apply the exact same deterministic migration in firmware before
  // building runtime objects, otherwise legacy UUID/string layouts produce
  // runtime id=0 and no automation condition can ever match.
  migrateRuntimeElementIds(
      doc);

  const JsonArrayConst layers =
      doc["layers"].as<JsonArrayConst>();

  for (JsonObjectConst layer : layers) {
    const JsonArrayConst elements =
        layer["elements"].as<JsonArrayConst>();

    for (JsonObjectConst item : elements) {
      addElement(item);
    }
  }

  rememberAndRestoreLiveState(
      oldAccessories,
      oldSensors,
      oldBlocks);

  Logger::info(
      "LayoutRuntime rebuilt: " +
      String(_accessories.size()) +
      " accessories, " +
      String(_sensors.size()) +
      " sensors, " +
      String(_blocks.size()) +
      " blocks");

  return true;
}

void LayoutRuntime::rememberAndRestoreLiveState(
    const std::vector<RuntimeAccessory>& oldAccessories,
    const std::vector<RuntimeSensor>& oldSensors,
    const std::vector<RuntimeBlock>& oldBlocks) {
  for (auto& item : _accessories) {
    for (const auto& old : oldAccessories) {
      if (old.kind != item.kind ||
          old.address != item.address) {
        continue;
      }

      item.closed = old.closed;
      item.aspect = old.aspect;
      item.active = old.active;
      break;
    }
  }

  for (auto& sensor : _sensors) {
    for (const auto& old : oldSensors) {
      if (old.address != sensor.address) {
        continue;
      }

      sensor.on = old.on;
      break;
    }
  }

  for (auto& block : _blocks) {
    for (const auto& old : oldBlocks) {
      if (old.id != block.id) {
        continue;
      }

      block.locoId = old.locoId;
      block.locoAddress = old.locoAddress;
      break;
    }
  }
}

RuntimeAccessory* LayoutRuntime::findAccessory(
    RuntimeAccessoryKind kind,
    uint16_t address) {
  for (auto& item : _accessories) {
    if (item.kind == kind &&
        item.address == address) {
      return &item;
    }
  }

  return nullptr;
}

RuntimeAccessory* LayoutRuntime::findAccessoryById(
    RuntimeAccessoryKind kind,
    uint16_t id,
    uint8_t channel) {
  for (auto& item : _accessories) {
    if (item.kind == kind &&
        item.id == id &&
        item.channel == channel) {
      return &item;
    }
  }

  return nullptr;
}

RuntimeSensor* LayoutRuntime::findSensor(
    uint16_t address) {
  for (auto& item : _sensors) {
    if (item.address == address) {
      return &item;
    }
  }

  return nullptr;
}

RuntimeSensor* LayoutRuntime::findSensorById(
    uint16_t id) {
  for (auto& item : _sensors) {
    if (item.id == id) {
      return &item;
    }
  }

  return nullptr;
}

RuntimeBlock* LayoutRuntime::findBlockById(
    uint16_t id) {
  for (auto& block : _blocks) {
    if (block.id == id) {
      return &block;
    }
  }

  return nullptr;
}

bool LayoutRuntime::setTurnout(
    uint16_t address,
    bool physicalValue) {
  auto* item =
      findAccessory(
          RuntimeAccessoryKind::Turnout,
          address);

  if (!item) {
    Logger::warn(
        "LayoutRuntime: turnout address " +
        String(address) +
        " not found");
    return false;
  }

  // WS/output callers send the physical decoder value (0/1).
  // Runtime state must remain semantic: closed=true means CLOSED,
  // regardless of whether the configured decoder uses 0 or 1 for CLOSED.
  const bool logicalClosed =
      physicalValue ==
      item->closedValue;

  Logger::info(
      "LayoutRuntime: turnout id=" +
      String(item->id) +
      " ch=" +
      String(item->channel) +
      " address=" +
      String(item->address) +
      " physical=" +
      String(physicalValue ? 1 : 0) +
      " closedValue=" +
      String(item->closedValue ? 1 : 0) +
      " logical=" +
      String(logicalClosed ? "CLOSED" : "THROWN"));

  if (item->closed == logicalClosed) {
    return true;
  }

  item->closed = logicalClosed;

  notify(
      RuntimeChangeKind::Turnout,
      item->id,
      item->channel);

  return true;
}

bool LayoutRuntime::setSignal(
    uint16_t address,
    int16_t aspect) {
  auto* item =
      findAccessory(
          RuntimeAccessoryKind::Signal,
          address);

  if (!item) return false;

  if (item->aspect == aspect) {
    return true;
  }

  item->aspect = aspect;

  notify(
      RuntimeChangeKind::Signal,
      item->id,
      item->channel);

  return true;
}

bool LayoutRuntime::setAccessory(
    uint16_t address,
    bool active) {
  auto* item =
      findAccessory(
          RuntimeAccessoryKind::Accessory,
          address);

  if (!item) return false;

  if (item->active == active) {
    return true;
  }

  item->active = active;

  notify(
      RuntimeChangeKind::Accessory,
      item->id,
      item->channel);

  return true;
}

bool LayoutRuntime::setVPin(
    uint16_t vpin,
    bool active) {
  auto* item =
      findAccessory(
          RuntimeAccessoryKind::VPin,
          vpin);

  if (!item) return false;

  if (item->active == active) {
    return true;
  }

  item->active = active;

  notify(
      RuntimeChangeKind::VPin,
      item->id,
      item->channel);

  return true;
}

bool LayoutRuntime::setSensor(
    uint16_t address,
    bool on) {
  auto* item =
      findSensor(address);

  if (!item) return false;

  if (item->on == on) {
    return true;
  }

  item->on = on;

  notify(
      RuntimeChangeKind::Sensor,
      item->id,
      0);

  return true;
}

bool LayoutRuntime::setBlock(
    uint16_t blockId,
    const String& locoId,
    uint16_t locoAddress) {
  RuntimeBlock* target = findBlockById(blockId);
  if (!target) return false;

  const String normalizedLocoId = locoId;
  const bool clearing =
      normalizedLocoId.isEmpty() &&
      locoAddress == 0;

  bool changed = false;

  if (!clearing) {
    // The same locomotive can never be present in two blocks. Match by DCC
    // address whenever available, and by logical loco id as a fallback.
    for (auto& block : _blocks) {
      if (block.id == blockId || !block.occupied()) {
        continue;
      }

      const bool sameAddress =
          locoAddress > 0 &&
          block.locoAddress == locoAddress;

      const bool sameId =
          !normalizedLocoId.isEmpty() &&
          block.locoId == normalizedLocoId;

      if (!sameAddress && !sameId) {
        continue;
      }

      block.locoId = "";
      block.locoAddress = 0;
      changed = true;
    }
  }

  if (clearing) {
    if (target->hasRuntimeState()) {
      target->locoId = "";
      target->locoAddress = 0;
      changed = true;
    }
  } else if (
      target->locoId != normalizedLocoId ||
      target->locoAddress != locoAddress) {
    target->locoId = normalizedLocoId;
    target->locoAddress = locoAddress;
    changed = true;
  }

  if (changed) {
    notify(RuntimeChangeKind::Block, blockId, 0);
  }

  return true;
}

bool LayoutRuntime::removeBlock(
    uint16_t blockId,
    const String& locoId) {
  RuntimeBlock* block = findBlockById(blockId);
  if (!block) return false;

  if (!block->hasRuntimeState()) {
    return true;
  }

  // If the caller supplied a loco id, do not accidentally remove another
  // locomotive that has meanwhile been assigned to the block by another client.
  if (!locoId.isEmpty() &&
      block->locoId != locoId) {
    return false;
  }

  block->locoId = "";
  block->locoAddress = 0;
  notify(RuntimeChangeKind::Block, blockId, 0);
  return true;
}

bool LayoutRuntime::clearBlocks() {
  bool changed = false;

  for (auto& block : _blocks) {
    if (!block.hasRuntimeState()) continue;

    block.locoId = "";
    block.locoAddress = 0;
    changed = true;
  }

  if (changed) {
    notify(RuntimeChangeKind::Block, 0, 0);
  }

  return true;
}
