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
  if (_changeCallback) {
    _changeCallback(kind, id, channel);
  }
}

void LayoutRuntime::addElement(JsonObjectConst element) {
  const char* type = element["type"] | "";
  const uint16_t id = readElementId(element);

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

    RuntimeAccessory item;
    item.id = id;
    item.kind =
        strcmp(outputMode, "vpin") == 0
            ? RuntimeAccessoryKind::VPin
            : RuntimeAccessoryKind::Accessory;
    item.address = address;
    item.active = false;

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
    return true;
  }

  const auto oldAccessories =
      _accessories;

  const auto oldSensors =
      _sensors;

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
      oldSensors);

  Logger::info(
      "LayoutRuntime rebuilt: " +
      String(_accessories.size()) +
      " accessories, " +
      String(_sensors.size()) +
      " sensors");

  return true;
}

void LayoutRuntime::rememberAndRestoreLiveState(
    const std::vector<RuntimeAccessory>& oldAccessories,
    const std::vector<RuntimeSensor>& oldSensors) {
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

bool LayoutRuntime::setTurnout(
    uint16_t address,
    bool closed) {
  auto* item =
      findAccessory(
          RuntimeAccessoryKind::Turnout,
          address);

  if (!item) return false;

  if (item->closed == closed) {
    return true;
  }

  item->closed = closed;

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
