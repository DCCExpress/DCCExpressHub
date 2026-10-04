#include "MovementPlanBuilder.h"

#include <LittleFS.h>
#include <algorithm>

bool MovementPlanBuilder::validId(int value) {
  return value >= 1 && value <= 65535;
}

String MovementPlanBuilder::str(
    JsonObjectConst object,
    const char* name,
    const String& fallback) {
  const char* value = object[name] | nullptr;
  return value ? String(value) : fallback;
}

int MovementPlanBuilder::integer(
    JsonObjectConst object,
    const char* name,
    int fallback) {
  return object[name] | fallback;
}

void MovementPlanBuilder::uniquePush(
    std::vector<uint16_t>& values,
    uint16_t value) {
  if (value == 0) return;
  if (std::find(values.begin(), values.end(), value) == values.end())
    values.push_back(value);
}

void MovementPlanBuilder::uniqueTurnoutPush(
    std::vector<DispatcherTurnoutRequirement>& values,
    uint16_t address,
    bool closed,
    bool& conflict) {
  if (address == 0) return;

  for (const auto& value : values) {
    if (value.address != address) continue;
    if (value.closed != closed) conflict = true;
    return;
  }

  DispatcherTurnoutRequirement value;
  value.address = address;
  value.closed = closed;
  values.push_back(value);
}

void MovementPlanBuilder::readTurnoutStates(
    JsonVariantConst raw,
    std::vector<DispatcherTurnoutRequirement>& values,
    bool& conflict) {
  if (!raw.is<JsonArrayConst>()) return;

  for (JsonObjectConst state : raw.as<JsonArrayConst>()) {
    const int address = state["address"] | 0;
    if (address < 1 || address > 2048) continue;
    uniqueTurnoutPush(
        values,
        static_cast<uint16_t>(address),
        state["closed"] | false,
        conflict);
  }
}

bool MovementPlanBuilder::ignoredSafetySensor(
    JsonObjectConst page,
    uint16_t fromBlockId,
    uint16_t toBlockId,
    uint16_t sensor) {
  for (JsonObjectConst rule :
       page["safetyRules"].as<JsonArrayConst>()) {
    if ((rule["fromBlockId"] | 0) != fromBlockId ||
        (rule["toBlockId"] | 0) != toBlockId)
      continue;

    for (JsonVariantConst raw :
         rule["ignoredSensors"].as<JsonArrayConst>()) {
      if ((raw | 0) == sensor) return true;
    }
  }

  return false;
}

int MovementPlanBuilder::blockEventDelay(
    JsonObjectConst root,
    uint16_t blockId,
    const String& direction,
    const char* eventName) {
  if (direction != "forward" && direction != "reverse") return 0;
  const char* property = nullptr;
  if (strcmp(eventName, "arrival") == 0) property = "arrivalDelayMs";
  else if (strcmp(eventName, "arrived") == 0) property = "arrivedDelayMs";
  else if (strcmp(eventName, "leave") == 0) property = "leaveDelayMs";
  if (!property) return 0;
  for (JsonObjectConst layer : root["layers"].as<JsonArrayConst>())
    for (JsonObjectConst element : layer["elements"].as<JsonArrayConst>()) {
      if (str(element, "type") != "trackblock" ||
          (element["id"] | 0) != blockId) continue;
      JsonObjectConst cfg = element["eventConfig"][direction].as<JsonObjectConst>();
      if (!cfg || !cfg[property].is<int>()) return 0;
      return std::max(0, std::min(600000, cfg[property].as<int>()));
    }
  return 0;
}

std::vector<MovementSensorCondition>
MovementPlanBuilder::blockEventConditions(
    JsonObjectConst root,
    uint16_t blockId,
    const String& direction,
    const char* eventName) {
  std::vector<MovementSensorCondition> result;

  if (direction != "forward" &&
      direction != "reverse")
    return result;

  for (JsonObjectConst layer :
       root["layers"].as<JsonArrayConst>()) {
    for (JsonObjectConst element :
         layer["elements"].as<JsonArrayConst>()) {
      if (str(element, "type") != "trackblock" ||
          (element["id"] | 0) != blockId)
        continue;

      JsonObjectConst directionConfig =
          element["eventConfig"][direction]
              .as<JsonObjectConst>();

      if (!directionConfig)
        return result;

      JsonArrayConst conditions =
          directionConfig[eventName]
              .as<JsonArrayConst>();

      if (!conditions) {
        const char* legacyName = eventName;

        if (strcmp(eventName, "arrival") == 0)
          legacyName = "beforeArrive";
        else if (strcmp(eventName, "leave") == 0)
          legacyName =
              directionConfig["afterLeave"].is<JsonArrayConst>()
                  ? "afterLeave"
                  : "beforeLeave";

        conditions =
            directionConfig[legacyName]
                .as<JsonArrayConst>();
      }

      if (!conditions)
        return result;

      for (JsonObjectConst raw : conditions) {
        const int sensor =
            raw["sensor"] | 0;

        if (!validId(sensor))
          continue;

        MovementSensorCondition condition;
        condition.sensor =
            static_cast<uint16_t>(sensor);
        condition.state =
            !raw["state"].is<bool>() ||
            (raw["state"] | true);
        result.push_back(condition);
      }

      return result;
    }
  }

  return result;
}

bool MovementPlanBuilder::loadLayout(
    JsonDocument& document,
    String& error) const {
  File file = LittleFS.open(
      "/config/layout.json",
      "r");

  if (!file) {
    error = "movement_layout_not_found";
    return false;
  }

  const auto jsonError =
      deserializeJson(document, file);
  file.close();

  if (jsonError) {
    error = "movement_layout_invalid";
    return false;
  }

  return true;
}

bool MovementPlanBuilder::build(
    JsonObjectConst page,
    MovementPlan& plan,
    String& error) const {
  plan = MovementPlan{};
  error = "";

  JsonDocument layout;
  if (!loadLayout(layout, error)) return false;

  JsonObjectConst root =
      layout.as<JsonObjectConst>();
  for (JsonObjectConst rawRule :
       page["resourceEventRules"].as<JsonArrayConst>()) {
    MovementResourceEventRule rule;
    rule.resourceKey = str(rawRule, "resourceKey");
    rule.event = str(rawRule, "event");
    rule.match = str(rawRule, "match", "all");
    for (JsonObjectConst rawCondition :
         rawRule["conditions"].as<JsonArrayConst>()) {
      const int sensor = rawCondition["sensor"] | 0;
      if (!validId(sensor)) continue;
      MovementSensorCondition condition;
      condition.sensor = static_cast<uint16_t>(sensor);
      condition.state = !rawCondition["state"].is<bool>() ||
          (rawCondition["state"] | true);
      rule.conditions.push_back(condition);
    }
    if (!rule.resourceKey.isEmpty() && !rule.event.isEmpty())
      plan.resourceEventRules.push_back(std::move(rule));
  }


  JsonObjectConst topology =
      root["routeTopology"].as<JsonObjectConst>();

  const int version =
      topology["version"] | 0;

  if (version != 2 && version != 3) {
    error = "movement_route_topology_unsupported";
    return false;
  }

  JsonObjectConst graph =
      topology["graph"].as<JsonObjectConst>();

  if (!graph ||
      !(graph["ready"] | false) ||
      !graph["nodes"].is<JsonArrayConst>() ||
      !topology["routeTable"].is<JsonArrayConst>()) {
    error = "movement_route_topology_incomplete";
    return false;
  }

  const int requestedFrom =
      page["fromBlockId"] | 0;
  const int requestedTo =
      page["toBlockId"] | 0;

  if (!validId(requestedFrom) ||
      !validId(requestedTo)) {
    error = "movement_requires_from_to_blocks";
    return false;
  }

  std::vector<uint16_t> checkpoints;
  checkpoints.push_back(
      static_cast<uint16_t>(requestedFrom));

  for (JsonVariantConst raw :
       page["viaBlockIds"].as<JsonArrayConst>()) {
    const int id = raw | 0;
    if (validId(id))
      uniquePush(
          checkpoints,
          static_cast<uint16_t>(id));
  }

  checkpoints.push_back(
      static_cast<uint16_t>(requestedTo));

  JsonObjectConst selected;
  size_t candidates = 0;

  for (JsonObjectConst route :
       topology["routeTable"].as<JsonArrayConst>()) {
    if ((route["fromBlockId"] | 0) != requestedFrom ||
        (route["toBlockId"] | 0) != requestedTo)
      continue;

    size_t checkpointIndex = 0;

    for (JsonObjectConst block :
         route["blockPath"].as<JsonArrayConst>()) {
      if (checkpointIndex >= checkpoints.size()) break;
      if ((block["id"] | 0) ==
          checkpoints[checkpointIndex])
        ++checkpointIndex;
    }

    if (checkpointIndex != checkpoints.size())
      continue;

    selected = route;
    ++candidates;
  }

  if (candidates == 0) {
    error = "movement_route_not_found";
    return false;
  }

  if (candidates > 1) {
    error = "movement_route_ambiguous";
    return false;
  }

  plan.direction =
      str(selected, "locoDirection", "unknown");

  if (plan.direction != "forward" &&
      plan.direction != "reverse") {
    error = "movement_direction_unknown";
    return false;
  }

  std::vector<std::pair<uint16_t, uint16_t>> blockSensors;

  for (JsonObjectConst layer :
       root["layers"].as<JsonArrayConst>()) {
    for (JsonObjectConst element :
         layer["elements"].as<JsonArrayConst>()) {
      if (str(element, "type") != "trackblock")
        continue;

      const int blockId = element["id"] | 0;
      const int sensor = element["sensorAddress"] | 0;

      if (validId(blockId) &&
          validId(sensor))
        blockSensors.push_back({
            static_cast<uint16_t>(blockId),
            static_cast<uint16_t>(sensor)});
    }
  }

  std::vector<std::pair<int, uint16_t>> trackSensors;
  for (JsonObjectConst layer :
       root["layers"].as<JsonArrayConst>()) {
    for (JsonObjectConst element :
         layer["elements"].as<JsonArrayConst>()) {
      const int elementId = element["id"] | 0;
      const int sensor = element["sensorAddress"] | 0;
      if (validId(elementId) && validId(sensor))
        trackSensors.push_back({elementId, static_cast<uint16_t>(sensor)});
    }
  }

  auto trackSensor = [&trackSensors](int elementId) -> uint16_t {
    for (const auto& item : trackSensors)
      if (item.first == elementId)
        return item.second;
    return 0;
  };

  std::vector<MovementPlanResource> blocks;

  for (JsonObjectConst block :
       selected["blockPath"].as<JsonArrayConst>()) {
    const int id = block["id"] | 0;
    if (!validId(id)) continue;

    MovementPlanResource resource;
    resource.key = "block:" + String(id);
    resource.kind = "block";
    resource.name = str(block, "name", resource.key);
    resource.blockId = static_cast<uint16_t>(id);
    resource.nodeIndex = block["nodeIndex"] | -1;

    for (const auto& mapping : blockSensors) {
      if (mapping.first == resource.blockId) {
        resource.sensorAddress = mapping.second;
        break;
      }
    }

    blocks.push_back(resource);
    plan.resources.push_back(resource);
  }

  if (blocks.size() < 2) {
    error = "movement_route_incomplete";
    return false;
  }

  plan.blocks = blocks;

  JsonArrayConst edges =
      selected["edgePath"].as<JsonArrayConst>();

  std::vector<MovementPlanResource> routeResources;
  size_t routeNodeIndex = 0;
  for (JsonVariantConst rawName :
       selected["nodes"].as<JsonArrayConst>()) {
    const String nodeName = rawName.as<String>();
    MovementPlanResource resource;
    resource.key = "segment:" + nodeName;
    resource.kind = "segment";
    resource.name = nodeName;
    resource.nodeIndex = static_cast<int>(routeNodeIndex);

    for (JsonObjectConst node :
         graph["nodes"].as<JsonArrayConst>()) {
      if (str(node, "name") != nodeName)
        continue;

      for (JsonObjectConst detector :
           node["detectors"].as<JsonArrayConst>()) {
        const int address = detector["address"] | 0;
        if (validId(address))
          uniquePush(resource.detectors, static_cast<uint16_t>(address));
      }
      for (JsonVariantConst detector :
           node["detectors"].as<JsonArrayConst>()) {
        if (detector.is<int>()) {
          const int address = detector.as<int>();
          if (validId(address))
            uniquePush(resource.detectors, static_cast<uint16_t>(address));
        }
      }
      for (JsonVariantConst elementId :
           node["elementIds"].as<JsonArrayConst>()) {
        const uint16_t sensor = trackSensor(elementId | 0);
        uniquePush(resource.detectors, sensor);
      }
      break;
    }

    routeResources.push_back(resource);
    plan.resources.push_back(resource);
    ++routeNodeIndex;
  }

  for (size_t index = 0;
       index + 1 < blocks.size();
       ++index) {
    MovementPlanLeg leg;
    leg.index = index;
    leg.from = blocks[index];
    leg.to = blocks[index + 1];

    bool turnoutConflict = false;

    for (JsonObjectConst edge : edges) {
      const int edgeFromIndex =
          edge["fromNodeIndex"] | -1;
      const int edgeToIndex =
          edge["toNodeIndex"] | -1;

      const bool insideByIndex =
          edgeFromIndex >= leg.from.nodeIndex &&
          edgeToIndex <= leg.to.nodeIndex &&
          edgeToIndex > leg.from.nodeIndex;

      // Older topology payloads may not carry node indexes on edges.
      const bool fallbackInside =
          edgeFromIndex < 0 &&
          edgeToIndex < 0;

      if (!insideByIndex &&
          !fallbackInside)
        continue;

      readTurnoutStates(
          edge["turnoutStates"],
          leg.turnouts,
          turnoutConflict);

      for (JsonObjectConst passage :
           edge["turnoutPath"].as<JsonArrayConst>()) {
        readTurnoutStates(
            passage["turnoutStates"],
            leg.turnouts,
            turnoutConflict);

        const int elementId =
            passage["elementId"] | 0;

        if (validId(elementId)) {
          MovementPlanResource resource;
          resource.key =
              "turnout:" +
              String(elementId);
          resource.kind = "turnout";
          resource.name =
              str(passage, "name", resource.key);
          resource.nodeIndex =
              edge["fromNodeIndex"] | leg.from.nodeIndex;
          resource.sensorAddress =
              trackSensor(elementId);
          uniquePush(
              resource.detectors,
              resource.sensorAddress);
          bool resourceConflict = false;
          readTurnoutStates(
              passage["turnoutStates"],
              resource.turnouts,
              resourceConflict);
          leg.resources.push_back(resource);
          plan.resources.push_back(resource);
        }
      }
    }

    for (const auto& resource : routeResources) {
      if (resource.nodeIndex <= leg.from.nodeIndex ||
          resource.nodeIndex > leg.to.nodeIndex)
        continue;
      leg.resources.push_back(resource);
    }

    if (turnoutConflict) {
      error = "movement_route_conflicting_turnout_state";
      return false;
    }

    leg.approachWhen =
        blockEventConditions(
            root,
            leg.to.blockId,
            plan.direction,
            "arrival");

    leg.approachDelayMs = blockEventDelay(
        root, leg.to.blockId, plan.direction, "arrival");

    leg.departWhen =
        blockEventConditions(
            root,
            leg.from.blockId,
            plan.direction,
            "depart");

    leg.arrivedWhen =
        blockEventConditions(
            root,
            leg.to.blockId,
            plan.direction,
            "arrived");

    leg.arrivedDelayMs = blockEventDelay(
        root, leg.to.blockId, plan.direction, "arrived");

    if (leg.arrivedWhen.empty() &&
        leg.to.sensorAddress != 0) {
      MovementSensorCondition condition;
      condition.sensor =
          leg.to.sensorAddress;
      condition.state = true;
      leg.arrivedWhen.push_back(condition);
    }

    leg.leaveWhen =
        blockEventConditions(
            root,
            leg.from.blockId,
            plan.direction,
            "leave");

    leg.leaveWhenExplicit =
        !leg.leaveWhen.empty();
    leg.leaveDelayMs = blockEventDelay(
        root, leg.from.blockId, plan.direction, "leave");

    if (leg.leaveWhen.empty() &&
        leg.from.sensorAddress != 0) {
      MovementSensorCondition condition;
      condition.sensor =
          leg.from.sensorAddress;
      condition.state = false;
      leg.leaveWhen.push_back(condition);
    }

    // Fail closed: destination occupancy plus all explicitly persisted
    // route detectors must be known/free unless the user disabled them.
    for (JsonObjectConst node :
         graph["nodes"].as<JsonArrayConst>()) {
      const int nodeIndex =
          node["index"] | -1;

      if (nodeIndex <= leg.from.nodeIndex ||
          nodeIndex > leg.to.nodeIndex)
        continue;

      for (JsonVariantConst detector :
           node["detectors"].as<JsonArrayConst>()) {
        const int address = detector | 0;
        if (!validId(address)) continue;

        const uint16_t sensor =
            static_cast<uint16_t>(address);

        if (!ignoredSafetySensor(
                page,
                leg.from.blockId,
                leg.to.blockId,
                sensor))
          uniquePush(
              leg.safetySensors,
              sensor);
      }
    }

    if (leg.to.sensorAddress != 0 &&
        !ignoredSafetySensor(
            page,
            leg.from.blockId,
            leg.to.blockId,
            leg.to.sensorAddress))
      uniquePush(leg.safetySensors, leg.to.sensorAddress);

    plan.legs.push_back(
        std::move(leg));
  }

  if (plan.legs.empty()) {
    error = "movement_route_incomplete";
    return false;
  }

  return true;
}
