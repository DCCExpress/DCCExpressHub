#include "LayoutRuntime.h"

#include <ArduinoJson.h>
#include "Logger.h"

namespace {
uint16_t readElementId(JsonObjectConst element) {
  const long value = element["id"] | 0L;
  if (value <= 0 || value > 0xffff) return 0;
  return static_cast<uint16_t>(value);
}

bool readPersistedNumericId(JsonVariantConst value, uint16_t& out) {
  if (value.isNull() || value.is<bool>() || value.is<const char*>()) return false;
  if (!value.is<long>() && !value.is<unsigned long>() && !value.is<int>() && !value.is<unsigned int>()) return false;
  const long raw = value.as<long>();
  if (raw <= 0 || raw > 0xffff) return false;
  out = static_cast<uint16_t>(raw);
  return true;
}

bool containsId(const std::vector<uint16_t>& ids, uint16_t id) {
  for (uint16_t item : ids) if (item == id) return true;
  return false;
}

void addUnique(std::vector<uint16_t>& values, uint16_t value) {
  if (!value || containsId(values, value)) return;
  values.push_back(value);
}

uint16_t nextFreeLayoutId(const std::vector<uint16_t>& used, uint16_t start) {
  uint32_t candidate = start > 0 ? start : 1;
  for (uint32_t attempts = 0; attempts < 0xffffUL; ++attempts) {
    if (candidate > 0xffffUL) candidate = 1;
    const uint16_t id = static_cast<uint16_t>(candidate);
    if (!containsId(used, id)) return id;
    ++candidate;
  }
  return 0;
}

size_t migrateRuntimeElementIds(JsonDocument& doc) {
  JsonArray layers = doc["layers"].as<JsonArray>();
  std::vector<uint16_t> reservedNumeric;
  std::vector<uint16_t> seenNumeric;

  for (JsonObject layer : layers) {
    JsonArray elements = layer["elements"].as<JsonArray>();
    for (JsonObject element : elements) {
      uint16_t id = 0;
      if (readPersistedNumericId(element["id"], id) && !containsId(reservedNumeric, id)) {
        reservedNumeric.push_back(id);
      }
    }
  }

  std::vector<uint16_t> used = reservedNumeric;
  uint16_t next = 1;
  size_t migrated = 0;

  for (JsonObject layer : layers) {
    JsonArray elements = layer["elements"].as<JsonArray>();
    for (JsonObject element : elements) {
      uint16_t persistedId = 0;
      const bool hasNumericId = readPersistedNumericId(element["id"], persistedId);
      uint16_t runtimeId = 0;

      if (hasNumericId && !containsId(seenNumeric, persistedId)) {
        runtimeId = persistedId;
        seenNumeric.push_back(persistedId);
      } else {
        runtimeId = nextFreeLayoutId(used, next);
        if (!runtimeId) {
          Logger::error("LayoutRuntime: no free uint16 element ID");
          continue;
        }
        used.push_back(runtimeId);
        next = runtimeId == 0xffff ? 1 : static_cast<uint16_t>(runtimeId + 1);
        ++migrated;
      }

      if (!hasNumericId || persistedId != runtimeId) element["id"] = runtimeId;
    }
  }

  if (migrated > 0) {
    Logger::warn("LayoutRuntime: migrated " + String(migrated) + " legacy/duplicate element ID(s) in RAM");
  }

  return migrated;
}

template <typename T>
T* findState(std::vector<T>& items, uint16_t address) {
  for (auto& item : items) if (item.address == address) return &item;
  return nullptr;
}

template <typename T>
const T* findState(const std::vector<T>& items, uint16_t address) {
  for (const auto& item : items) if (item.address == address) return &item;
  return nullptr;
}

template <typename T, typename V>
std::vector<T> reconcileStates(
    const std::vector<T>& oldStates,
    const std::vector<uint16_t>& topology,
    V T::*member,
    V defaultValue) {
  std::vector<T> next;
  next.reserve(topology.size());

  for (uint16_t address : topology) {
    T state;
    state.address = address;
    state.*member = defaultValue;

    if (const T* old = findState(oldStates, address)) {
      state.*member = old->*member;
    }

    next.push_back(state);
  }

  return next;
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
         strcmp(type, "tracksignal4") == 0 ||
         strcmp(type, "tracklevelcrossing") == 0;
}

void LayoutRuntime::notify(RuntimeChangeKind kind, uint16_t id, uint8_t channel) {
  for (const auto& callback : _changeCallbacks) if (callback) callback(kind, id, channel);
}

void LayoutRuntime::addElement(
    JsonObjectConst element,
    std::vector<uint16_t>& basicTopology,
    std::vector<uint16_t>& extendedTopology,
    std::vector<uint16_t>& vpinTopology) {
  const char* type = element["type"] | "";
  const uint16_t id = readElementId(element);
  const uint16_t elementAddress = element["address"] | 0;

  bool addressIsSensor = false;
  if (
      strcmp(type, "trackstraight") == 0 ||
      strcmp(type, "trackdirection") == 0 ||
      strcmp(type, "trackend") == 0 ||
      strcmp(type, "trackcorner") == 0 ||
      strcmp(type, "trackcurve") == 0 ||
      strcmp(type, "trackcrossing") == 0 ||
      strcmp(type, "tracklevelcrossing") == 0 ||
      strcmp(type, "tracksensor") == 0) {
    addressIsSensor = true;
  } else if (isTurnoutType(type)) {
    const bool dual =
        strcmp(type, "trackturnoutdouble") == 0 ||
        strcmp(type, "trackturnouttreeway") == 0;
    addressIsSensor = dual
        ? (element["turnout1Address"] | 0) > 0 || (element["turnout2Address"] | 0) > 0
        : (element["turnoutAddress"] | 0) > 0;
  } else if (isSignalType(type)) {
    addressIsSensor = false;
  }

  if (id && addressIsSensor && elementAddress) {
    RuntimeSensor sensor;
    sensor.id = id;
    sensor.address = elementAddress;
    _sensors.push_back(sensor);
  }

  if (strcmp(type, "trackblock") == 0) {
    if (!id) return;
    RuntimeBlock block;
    block.id = id;
    _blocks.push_back(block);
    return;
  }

  if (isTurnoutType(type)) {
    const char* mode = element["outputMode"] | "accessory";
    const bool extended = strcmp(mode, "extended") == 0;
    const bool vpin = strcmp(mode, "vpin") == 0;
    const bool dual =
        strcmp(type, "trackturnoutdouble") == 0 ||
        strcmp(type, "trackturnouttreeway") == 0;

    auto addTurnout = [&](uint16_t address,
                          uint8_t channel,
                          bool closedValue,
                          int closedAspect,
                          int openedAspect) {
      if (!address) return;

      RuntimeAccessory item;
      item.id = id;
      item.kind = RuntimeAccessoryKind::Turnout;
      item.address = address;
      item.channel = channel;
      item.closedValue = closedValue;
      item.turnoutExtended = extended;
      item.turnoutVPin = vpin;
      item.turnoutClosedAspect = static_cast<uint8_t>(constrain(closedAspect, 0, 255));
      item.turnoutOpenedAspect = static_cast<uint8_t>(constrain(openedAspect, 0, 255));
      _accessories.push_back(item);

      if (extended) addUnique(extendedTopology, address);
      else if (vpin) addUnique(vpinTopology, address);
      else addUnique(basicTopology, address);
    };

    if (dual) {
      addTurnout(
          element["turnout1Address"] | 0,
          0,
          element["turnout1ClosedValue"] | false,
          element["turnout1ClosedAspect"] | 0,
          element["turnout1OpenedAspect"] | 1);

      addTurnout(
          element["turnout2Address"] | 0,
          1,
          element["turnout2ClosedValue"] | false,
          element["turnout2ClosedAspect"] | 0,
          element["turnout2OpenedAspect"] | 1);
    } else {
      uint16_t address = element["turnoutAddress"] | 0;
      if (!address) address = element["address"] | 0;

      addTurnout(
          address,
          0,
          element["turnoutClosedValue"] | false,
          element["turnoutClosedAspect"] | 0,
          element["turnoutOpenedAspect"] | 1);
    }

    return;
  }

  if (isSignalType(type)) {
    JsonObjectConst signalOutput = element["signalOutput"];
    const bool isLevelCrossing = strcmp(type, "tracklevelcrossing") == 0;

    uint16_t address = signalOutput["address"] | 0;
    if (!address && isLevelCrossing) address = element["basicAccessoryAddress"] | 0;
    if (!address && !isLevelCrossing) address = element["address"] | 0;
    if (!address) return;

    const char* protocol = signalOutput["protocol"] | (isLevelCrossing ? "dcc" : "dccext");
    const bool extended = strcmp(protocol, "dccext") == 0;

    int outputCount = signalOutput["outputCount"] | 0;
    if (outputCount <= 0) outputCount = element["addressLength"] | 1;
    outputCount = constrain(outputCount, 1, 16);

    RuntimeAccessory item;
    item.id = id;
    item.kind = RuntimeAccessoryKind::Signal;
    item.address = address;
    item.signalExtended = extended;
    item.signalOutputCount = static_cast<uint8_t>(outputCount);
    _accessories.push_back(item);

    if (extended) {
      addUnique(extendedTopology, address);
    } else {
      for (int i = 0; i < outputCount; ++i) {
        const uint32_t candidate = static_cast<uint32_t>(address) + i;
        if (candidate > 0xffff) break;
        addUnique(basicTopology, static_cast<uint16_t>(candidate));
      }
    }

    return;
  }

  if (strcmp(type, "button") == 0) {
    const uint16_t address = element["address"] | 0;
    if (!address) return;

    const char* outputMode = element["outputMode"] | "accessory";

    RuntimeAccessory item;
    item.id = id;
    item.address = address;

    if (strcmp(outputMode, "extended") == 0) {
      item.kind = RuntimeAccessoryKind::Signal;
      item.signalExtended = true;
      item.signalOutputCount = 1;
      addUnique(extendedTopology, address);
    } else {
      item.kind = RuntimeAccessoryKind::Accessory;
      addUnique(basicTopology, address);
    }

    _accessories.push_back(item);
  }
}

bool LayoutRuntime::rebuildFromLayout(const char* path) {
  if (!_fs) return false;

  File file = _fs->open(path, "r");
  if (!file) {
    Logger::warn(String("LayoutRuntime: no layout at ") + path);
    _accessories.clear();
    _sensors.clear();
    _blocks.clear();
    _basicAccessoryStates.clear();
    _extendedAccessoryStates.clear();
    _vpinStates.clear();
    return true;
  }

  const auto oldBasic = _basicAccessoryStates;
  const auto oldExtended = _extendedAccessoryStates;
  const auto oldVpins = _vpinStates;
  const auto oldBlocks = _blocks;

  JsonDocument filter;
  JsonObject element = filter["layers"][0]["elements"][0].to<JsonObject>();
  element["type"] = true;
  element["id"] = true;
  element["address"] = true;
  element["addressLength"] = true;
  element["turnoutAddress"] = true;
  element["turnoutClosedValue"] = true;
  element["turnoutClosedAspect"] = true;
  element["turnoutOpenedAspect"] = true;
  element["turnout1Address"] = true;
  element["turnout2Address"] = true;
  element["turnout1ClosedValue"] = true;
  element["turnout2ClosedValue"] = true;
  element["turnout1ClosedAspect"] = true;
  element["turnout1OpenedAspect"] = true;
  element["turnout2ClosedAspect"] = true;
  element["turnout2OpenedAspect"] = true;
  element["outputMode"] = true;
  element["basicAccessoryAddress"] = true;
  element["signalOutput"]["address"] = true;
  element["signalOutput"]["protocol"] = true;
  element["signalOutput"]["outputCount"] = true;

  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, file, DeserializationOption::Filter(filter));
  file.close();

  if (error) {
    Logger::error(String("LayoutRuntime parse failed: ") + error.c_str());
    return false;
  }

  _accessories.clear();
  _sensors.clear();
  _blocks.clear();

  migrateRuntimeElementIds(doc);

  std::vector<uint16_t> basicTopology;
  std::vector<uint16_t> extendedTopology;
  std::vector<uint16_t> vpinTopology;

  const JsonArrayConst layers = doc["layers"].as<JsonArrayConst>();
  for (JsonObjectConst layer : layers) {
    const JsonArrayConst elements = layer["elements"].as<JsonArrayConst>();
    for (JsonObjectConst item : elements) {
      addElement(item, basicTopology, extendedTopology, vpinTopology);
    }
  }

  for (auto& block : _blocks) {
    for (const auto& old : oldBlocks) {
      if (old.id != block.id) continue;
      block.locoId = old.locoId;
      block.locoAddress = old.locoAddress;
      break;
    }
  }

  _basicAccessoryStates = reconcileStates(oldBasic, basicTopology, &BasicAccessoryState::active, false);
  _extendedAccessoryStates = reconcileStates(oldExtended, extendedTopology, &ExtendedAccessoryState::aspect, static_cast<uint8_t>(0));
  _vpinStates = reconcileStates(oldVpins, vpinTopology, &VPinState::active, false);

  Logger::info(
      "LayoutRuntime rebuilt: " +
      String(_basicAccessoryStates.size()) + " basic, " +
      String(_extendedAccessoryStates.size()) + " extended, " +
      String(_sensorStates.size()) + " sensor state(s), " +
      String(_accessories.size()) + " binding(s), " +
      String(_blocks.size()) + " block(s)");

  return true;
}

RuntimeAccessory* LayoutRuntime::findAccessory(RuntimeAccessoryKind kind, uint16_t address) {
  for (auto& item : _accessories) if (item.kind == kind && item.address == address) return &item;
  return nullptr;
}

const RuntimeAccessory* LayoutRuntime::findAccessory(RuntimeAccessoryKind kind, uint16_t address) const {
  for (const auto& item : _accessories) if (item.kind == kind && item.address == address) return &item;
  return nullptr;
}

RuntimeAccessory* LayoutRuntime::findAccessoryById(RuntimeAccessoryKind kind, uint16_t id, uint8_t channel) {
  for (auto& item : _accessories) {
    if (item.kind == kind && item.id == id && item.channel == channel) return &item;
  }
  return nullptr;
}

RuntimeSensor* LayoutRuntime::findSensor(uint16_t address) {
  for (auto& item : _sensors) if (item.address == address) return &item;
  return nullptr;
}

const RuntimeSensor* LayoutRuntime::findSensor(uint16_t address) const {
  for (const auto& item : _sensors) if (item.address == address) return &item;
  return nullptr;
}

RuntimeSensor* LayoutRuntime::findSensorById(uint16_t id) {
  for (auto& item : _sensors) if (item.id == id) return &item;
  return nullptr;
}

RuntimeBlock* LayoutRuntime::findBlockById(uint16_t id) {
  for (auto& block : _blocks) if (block.id == id) return &block;
  return nullptr;
}

bool LayoutRuntime::getSensorState(uint16_t address, bool& on) const {
  if (const auto* state = findState(_sensorStates, address)) {
    on = state->on;
    return true;
  }
  on = false;
  return false;
}

bool LayoutRuntime::getBasicAccessoryState(uint16_t address, bool& active) const {
  if (const auto* state = findState(_basicAccessoryStates, address)) {
    active = state->active;
    return true;
  }
  active = false;
  return false;
}

bool LayoutRuntime::getExtendedAccessoryState(uint16_t address, uint8_t& aspect) const {
  if (const auto* state = findState(_extendedAccessoryStates, address)) {
    aspect = state->aspect;
    return true;
  }
  aspect = 0;
  return false;
}

bool LayoutRuntime::getTurnoutClosed(uint16_t address, bool& closed) const {
  const RuntimeAccessory* turnout = findAccessory(RuntimeAccessoryKind::Turnout, address);
  if (!turnout) {
    closed = false;
    return false;
  }

  if (turnout->turnoutExtended) {
    uint8_t aspect = 0;
    if (!getExtendedAccessoryState(address, aspect)) {
      closed = false;
      return false;
    }
    if (aspect == turnout->turnoutClosedAspect) {
      closed = true;
      return true;
    }
    if (aspect == turnout->turnoutOpenedAspect) {
      closed = false;
      return true;
    }
    closed = false;
    return false;
  }

  bool physical = false;
  if (turnout->turnoutVPin) {
    const VPinState* state = findState(_vpinStates, address);
    if (!state) {
      closed = false;
      return false;
    }
    physical = state->active;
  } else {
    if (!getBasicAccessoryState(address, physical)) {
      closed = false;
      return false;
    }
  }

  closed = physical == turnout->closedValue;
  return true;
}

bool LayoutRuntime::getSignalValue(uint16_t address, int16_t& value) const {
  const RuntimeAccessory* signal = findAccessory(RuntimeAccessoryKind::Signal, address);
  if (!signal) {
    value = 0;
    return false;
  }

  if (signal->signalExtended) {
    uint8_t aspect = 0;
    if (!getExtendedAccessoryState(address, aspect)) {
      value = 0;
      return false;
    }
    value = aspect;
    return true;
  }

  uint16_t bits = 0;
  for (uint8_t i = 0; i < signal->signalOutputCount; ++i) {
    bool active = false;
    if (!getBasicAccessoryState(static_cast<uint16_t>(signal->address + i), active)) {
      value = 0;
      return false;
    }
    if (active) bits |= static_cast<uint16_t>(1U << i);
  }

  value = static_cast<int16_t>(bits);
  return true;
}

void LayoutRuntime::notifyTurnoutsForAddress(uint16_t address) {
  for (const auto& item : _accessories) {
    if (item.kind == RuntimeAccessoryKind::Turnout && item.address == address) {
      notify(RuntimeChangeKind::Turnout, item.id, item.channel);
    }
  }
}

bool LayoutRuntime::setTurnout(uint16_t address, bool physicalValue) {
  RuntimeAccessory* turnout = findAccessory(RuntimeAccessoryKind::Turnout, address);
  if (!turnout) {
    Logger::warn("LayoutRuntime: turnout address " + String(address) + " not found");
    return false;
  }

  if (turnout->turnoutExtended) {
    notifyTurnoutsForAddress(address);
    return true;
  }

  if (turnout->turnoutVPin) return setVPin(address, physicalValue);
  return setAccessory(address, physicalValue);
}

bool LayoutRuntime::setSignal(uint16_t address, int16_t aspect) {
  if (aspect < 0 || aspect > 255) return false;

  ExtendedAccessoryState* state = findState(_extendedAccessoryStates, address);
  if (!state) return false;

  const bool changed = state->aspect != static_cast<uint8_t>(aspect);
  state->aspect = static_cast<uint8_t>(aspect);

  if (changed) notify(RuntimeChangeKind::Signal, address, 0);
  notifyTurnoutsForAddress(address);
  return true;
}

bool LayoutRuntime::setAccessory(uint16_t address, bool active) {
  BasicAccessoryState* state = findState(_basicAccessoryStates, address);
  if (!state) return false;

  const bool changed = state->active != active;
  state->active = active;

  if (changed) notify(RuntimeChangeKind::Accessory, address, 0);
  notifyTurnoutsForAddress(address);
  return true;
}

bool LayoutRuntime::setVPin(uint16_t address, bool active) {
  VPinState* state = findState(_vpinStates, address);
  if (!state) return false;

  const bool changed = state->active != active;
  state->active = active;

  if (changed) notify(RuntimeChangeKind::VPin, address, 0);
  notifyTurnoutsForAddress(address);
  return true;
}

bool LayoutRuntime::setSensor(uint16_t address, bool on) {
  SensorState* state = findState(_sensorStates, address);
  const bool changed = !state || state->on != on;

  if (!state) {
    SensorState created;
    created.address = address;
    created.on = on;
    _sensorStates.push_back(created);
  } else {
    state->on = on;
  }

  if (changed) {
    bool notified = false;
    for (auto& ref : _sensors) {
      if (ref.address != address) continue;
      // Compatibility mirror only. Authoritative sensor state remains in
      // _sensorStates and is learned from Q/q feedback.
      ref.on = on;
      notify(RuntimeChangeKind::Sensor, ref.id, 0);
      notified = true;
    }
    if (!notified) notify(RuntimeChangeKind::Sensor, address, 0);
  }

  return true;
}

bool LayoutRuntime::setBlock(uint16_t blockId, const String& locoId, uint16_t locoAddress) {
  RuntimeBlock* target = findBlockById(blockId);
  if (!target) return false;

  const bool clearing = locoId.isEmpty() && locoAddress == 0;
  bool changed = false;

  if (!clearing) {
    for (auto& block : _blocks) {
      if (block.id == blockId || !block.occupied()) continue;
      const bool sameAddress = locoAddress > 0 && block.locoAddress == locoAddress;
      const bool sameId = !locoId.isEmpty() && block.locoId == locoId;
      if (!sameAddress && !sameId) continue;
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
  } else if (target->locoId != locoId || target->locoAddress != locoAddress) {
    target->locoId = locoId;
    target->locoAddress = locoAddress;
    changed = true;
  }

  if (changed) notify(RuntimeChangeKind::Block, blockId, 0);
  return true;
}

bool LayoutRuntime::removeBlock(uint16_t blockId, const String& locoId) {
  RuntimeBlock* block = findBlockById(blockId);
  if (!block) return false;
  if (!block->hasRuntimeState()) return true;
  if (!locoId.isEmpty() && block->locoId != locoId) return false;

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
  if (changed) notify(RuntimeChangeKind::Block, 0, 0);
  return true;
}

const std::vector<RuntimeAccessory>& LayoutRuntime::accessories() const {
  _snapshotAccessories.clear();

  // Turnout rows are semantic views derived from current physical state.
  for (const auto& binding : _accessories) {
    if (binding.kind != RuntimeAccessoryKind::Turnout) continue;

    RuntimeAccessory row = binding;

    if (binding.turnoutExtended) {
      uint8_t aspect = 0;
      row.aspect = getExtendedAccessoryState(binding.address, aspect)
          ? static_cast<int16_t>(aspect)
          : -1;

      bool logical = false;
      if (getTurnoutClosed(binding.address, logical)) {
        row.closed = logical
            ? binding.closedValue
            : !binding.closedValue;
      } else {
        row.closed = false;
      }
    } else if (binding.turnoutVPin) {
      const VPinState* state = findState(_vpinStates, binding.address);
      row.closed = state ? state->active : false;
    } else {
      bool active = false;
      getBasicAccessoryState(binding.address, active);
      row.closed = active;
    }

    _snapshotAccessories.push_back(row);
  }

  // Every Basic-DCC physical endpoint gets exactly one Accessory row,
  // including consecutive outputs produced by a Basic-DCC signal.
  for (const auto& state : _basicAccessoryStates) {
    RuntimeAccessory row;
    row.kind = RuntimeAccessoryKind::Accessory;
    row.address = state.address;
    row.active = state.active;
    _snapshotAccessories.push_back(row);
  }

  // Every Extended-DCC physical endpoint gets exactly one Signal row.
  for (const auto& state : _extendedAccessoryStates) {
    RuntimeAccessory row;
    row.kind = RuntimeAccessoryKind::Signal;
    row.address = state.address;
    row.signalExtended = true;
    row.aspect = state.aspect;
    _snapshotAccessories.push_back(row);
  }

  for (const auto& state : _vpinStates) {
    RuntimeAccessory row;
    row.kind = RuntimeAccessoryKind::VPin;
    row.address = state.address;
    row.active = state.active;
    _snapshotAccessories.push_back(row);
  }

  return _snapshotAccessories;
}

const std::vector<RuntimeSensor>& LayoutRuntime::sensors() const {
  _snapshotSensors.clear();

  for (const auto& state : _sensorStates) {
    RuntimeSensor row;
    row.address = state.address;
    row.on = state.on;

    // Preserve a layout ID when one happens to reference this address. The
    // state itself still exists independently from the layout.
    if (const RuntimeSensor* ref = findSensor(state.address)) {
      row.id = ref->id;
    }

    _snapshotSensors.push_back(row);
  }

  return _snapshotSensors;
}
