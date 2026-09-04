#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <vector>

enum class RuntimeAccessoryKind : uint8_t {
  Turnout,
  Signal,
  Accessory,
  VPin
};

struct RuntimeAccessory {
  String id;
  RuntimeAccessoryKind kind = RuntimeAccessoryKind::Accessory;
  uint16_t address = 0;

  // Turnout
  bool closed = false;
  bool closedValue = false;

  // Signal
  int16_t aspect = -1;

  // Accessory / VPin
  bool active = false;
};

struct RuntimeSensor {
  String id;
  uint16_t address = 0;
  bool on = false;
};

class LayoutRuntime {
public:
  bool begin(fs::FS& fs);
  bool rebuildFromLayout(const char* path = "/config/layout.json");

  bool setTurnout(uint16_t address, bool closed);
  bool setSignal(uint16_t address, int16_t aspect);
  bool setAccessory(uint16_t address, bool active);
  bool setVPin(uint16_t vpin, bool active);
  bool setSensor(uint16_t address, bool on);

  RuntimeAccessory* findAccessory(RuntimeAccessoryKind kind, uint16_t address);
  RuntimeSensor* findSensor(uint16_t address);

  const std::vector<RuntimeAccessory>& accessories() const { return _accessories; }
  const std::vector<RuntimeSensor>& sensors() const { return _sensors; }

  size_t accessoryCount() const { return _accessories.size(); }
  size_t sensorCount() const { return _sensors.size(); }

private:
  fs::FS* _fs = nullptr;
  std::vector<RuntimeAccessory> _accessories;
  std::vector<RuntimeSensor> _sensors;

  void rememberAndRestoreLiveState(
      const std::vector<RuntimeAccessory>& oldAccessories,
      const std::vector<RuntimeSensor>& oldSensors);

  void addElement(JsonObjectConst element);
  static bool isTurnoutType(const char* type);
  static bool isSignalType(const char* type);
};
