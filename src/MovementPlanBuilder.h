#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>

#include "DispatcherRuntime.h"

struct MovementPlanResource {
  String key;
  String kind;
  String name;
  uint16_t blockId = 0;
  uint16_t sensorAddress = 0;
  int nodeIndex = -1;
  std::vector<uint16_t> detectors;
  std::vector<DispatcherTurnoutRequirement> turnouts;
};

struct MovementPlanLeg {
  size_t index = 0;
  MovementPlanResource from;
  MovementPlanResource to;
  std::vector<MovementPlanResource> resources;
  std::vector<DispatcherTurnoutRequirement> turnouts;
  std::vector<uint16_t> safetySensors;
};

struct MovementPlan {
  String direction = "unknown";
  std::vector<MovementPlanResource> resources;
  std::vector<MovementPlanResource> blocks;
  std::vector<MovementPlanLeg> legs;
};

class MovementPlanBuilder {
public:
  bool build(
      JsonObjectConst page,
      MovementPlan& plan,
      String& error) const;

private:
  static bool validId(int value);
  static String str(
      JsonObjectConst object,
      const char* name,
      const String& fallback = "");

  static int integer(
      JsonObjectConst object,
      const char* name,
      int fallback = 0);

  static void uniquePush(
      std::vector<uint16_t>& values,
      uint16_t value);

  static void uniqueTurnoutPush(
      std::vector<DispatcherTurnoutRequirement>& values,
      uint16_t address,
      bool closed,
      bool& conflict);

  static void readTurnoutStates(
      JsonVariantConst raw,
      std::vector<DispatcherTurnoutRequirement>& values,
      bool& conflict);

  static bool ignoredSafetySensor(
      JsonObjectConst page,
      uint16_t fromBlockId,
      uint16_t toBlockId,
      uint16_t sensor);

  bool loadLayout(JsonDocument& document, String& error) const;
};
