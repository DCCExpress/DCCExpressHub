#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <functional>
#include <vector>

enum class RuntimeAccessoryKind : uint8_t {
  Turnout,
  Signal,
  Accessory,
  VPin
};

enum class RuntimeChangeKind : uint8_t {
  Turnout,
  Signal,
  Accessory,
  VPin,
  Sensor,
  Block
};

// Topology/binding metadata only. Physical state is stored separately by
// address in BasicAccessoryState / ExtendedAccessoryState / SensorState.
struct RuntimeAccessory {
  uint16_t id = 0;
  RuntimeAccessoryKind kind = RuntimeAccessoryKind::Accessory;
  uint16_t address = 0;
  uint8_t channel = 0;

  bool closedValue = false;
  bool turnoutExtended = false;
  bool turnoutVPin = false;
  uint8_t turnoutClosedAspect = 0;
  uint8_t turnoutOpenedAspect = 1;

  bool signalExtended = true;
  uint8_t signalOutputCount = 1;

  // Derived compatibility fields used only by snapshot/API serialization.
  // They are never authoritative state.
  bool closed = false;
  int16_t aspect = -1;
  bool active = false;
};

struct RuntimeSensor {
  uint16_t id = 0;
  uint16_t address = 0;
  // Derived compatibility field for snapshot/API serialization.
  bool on = false;
};

struct BasicAccessoryState {
  uint16_t address = 0;
  bool active = false;
};

struct ExtendedAccessoryState {
  uint16_t address = 0;
  uint8_t aspect = 0;
};

struct SensorState {
  uint16_t address = 0;
  bool on = false;
};

struct VPinState {
  uint16_t address = 0;
  bool active = false;
};

struct RuntimeBlock {
  static constexpr const char* TARGET_LOCO_PREFIX =
      "__dcc_target_loco__:";

  uint16_t id = 0;
  String locoId;
  uint16_t locoAddress = 0;

  bool targetOnly() const {
    return locoAddress == 0 &&
           locoId.startsWith(TARGET_LOCO_PREFIX);
  }

  bool occupied() const {
    return locoAddress > 0 ||
           (!locoId.isEmpty() && !targetOnly());
  }

  bool hasRuntimeState() const {
    return occupied() || targetOnly();
  }
};

class LayoutRuntime {
public:
  using ChangeCallback =
      std::function<void(RuntimeChangeKind, uint16_t, uint8_t)>;

  bool begin(fs::FS& fs);
  bool rebuildFromLayout(const char* path = "/config/layout.json");

  bool setTurnout(uint16_t address, bool physicalValue);
  bool setSignal(uint16_t address, int16_t aspect);
  bool setAccessory(uint16_t address, bool active);
  bool setVPin(uint16_t vpin, bool active);
  bool setSensor(uint16_t address, bool on);

  bool getTurnoutClosed(uint16_t address, bool& closed) const;
  bool getSignalValue(uint16_t address, int16_t& value) const;
  bool getSensorState(uint16_t address, bool& on) const;
  bool getBasicAccessoryState(uint16_t address, bool& active) const;
  bool getExtendedAccessoryState(uint16_t address, uint8_t& aspect) const;

  bool setBlock(
      uint16_t blockId,
      const String& locoId,
      uint16_t locoAddress = 0);

  bool removeBlock(
      uint16_t blockId,
      const String& locoId = String());

  bool clearBlocks();

  void onChange(ChangeCallback callback) {
    if (callback) {
      _changeCallbacks.push_back(std::move(callback));
    }
  }

  RuntimeAccessory* findAccessory(
      RuntimeAccessoryKind kind,
      uint16_t address);

  const RuntimeAccessory* findAccessory(
      RuntimeAccessoryKind kind,
      uint16_t address) const;

  RuntimeAccessory* findAccessoryById(
      RuntimeAccessoryKind kind,
      uint16_t id,
      uint8_t channel = 0);

  RuntimeSensor* findSensor(uint16_t address);
  const RuntimeSensor* findSensor(uint16_t address) const;
  RuntimeSensor* findSensorById(uint16_t id);
  RuntimeBlock* findBlockById(uint16_t id);

  // Compatibility snapshot views. They are synthesized from physical state
  // maps plus layout bindings and contain no independent state.
  const std::vector<RuntimeAccessory>& accessories() const;
  const std::vector<RuntimeSensor>& sensors() const;

  const std::vector<BasicAccessoryState>& basicAccessories() const {
    return _basicAccessoryStates;
  }

  const std::vector<ExtendedAccessoryState>& extendedAccessories() const {
    return _extendedAccessoryStates;
  }

  const std::vector<SensorState>& sensorStates() const {
    return _sensorStates;
  }

  const std::vector<VPinState>& vpinStates() const {
    return _vpinStates;
  }

  const std::vector<RuntimeBlock>& blocks() const {
    return _blocks;
  }

  size_t accessoryCount() const {
    return _basicAccessoryStates.size() +
           _extendedAccessoryStates.size();
  }

  size_t sensorCount() const {
    return _sensorStates.size();
  }

  size_t blockCount() const {
    return _blocks.size();
  }

private:
  fs::FS* _fs = nullptr;

  std::vector<RuntimeAccessory> _accessories;
  std::vector<RuntimeSensor> _sensors;
  std::vector<RuntimeBlock> _blocks;

  std::vector<BasicAccessoryState> _basicAccessoryStates;
  std::vector<ExtendedAccessoryState> _extendedAccessoryStates;
  std::vector<SensorState> _sensorStates;
  std::vector<VPinState> _vpinStates;

  mutable std::vector<RuntimeAccessory> _snapshotAccessories;
  mutable std::vector<RuntimeSensor> _snapshotSensors;

  std::vector<ChangeCallback> _changeCallbacks;

  void notify(
      RuntimeChangeKind kind,
      uint16_t id,
      uint8_t channel = 0);

  void addElement(
      JsonObjectConst element,
      std::vector<uint16_t>& basicTopology,
      std::vector<uint16_t>& extendedTopology,
      std::vector<uint16_t>& vpinTopology);

  static bool isTurnoutType(const char* type);
  static bool isSignalType(const char* type);

  void notifyTurnoutsForAddress(uint16_t address);
};
