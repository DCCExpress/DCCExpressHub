#include "MovementRuntime.h"

#include <LittleFS.h>
#include <algorithm>

void MovementRuntime::loadActions(
    JsonObjectConst page,
    std::vector<MovementAction>& actions) {
  actions.clear();

  for (JsonObjectConst raw :
       page["actions"].as<JsonArrayConst>()) {
    MovementAction action;
    action.resourceKey =
        raw["resourceKey"] | "";
    action.when =
        raw["when"] | "";
    action.sequenceId =
        raw["sequenceId"] | "";
    action.sequenceMode =
        raw["sequenceMode"] | "blocking";
    action.kind =
        raw["kind"] | "log";
    action.speed =
        raw["speed"] | 20;
    action.functionNumber =
        raw["functionNumber"] | 2;
    action.functionActive =
        raw["functionActive"] | true;
    action.pulseMs =
        raw["pulseMs"] | 700;
    action.delayMs =
        raw["delayMs"] | 500;
    action.accessoryAddress =
        raw["accessoryAddress"] | 1;
    action.accessoryActive =
        raw["accessoryActive"] | true;
    action.accessoryAspect =
        raw["accessoryAspect"] | 0;
    action.message =
        raw["message"] | "";
    actions.push_back(
        std::move(action));
  }
}

bool MovementRuntime::begin() {
  _executions.clear();
  _changed = true;
  return true;
}

MovementRuntime::Execution* MovementRuntime::findExecution(
    const String& pageId) {
  for (auto& execution : _executions)
    if (execution.state.pageId == pageId)
      return &execution;
  return nullptr;
}

bool MovementRuntime::loadPage(
    const String& pageId,
    JsonDocument& document,
    JsonObjectConst& page,
    String& error) const {
  File file = LittleFS.open(
      "/config/automations.json",
      "r");

  if (!file) {
    error = "movement_storage_not_found";
    return false;
  }

  const auto jsonError =
      deserializeJson(document, file);
  file.close();

  if (jsonError) {
    error = "movement_storage_invalid";
    return false;
  }

  JsonObjectConst movement =
      document["movement"].as<JsonObjectConst>();

  if (!movement ||
      !movement["pages"].is<JsonArrayConst>()) {
    error = "movement_storage_invalid";
    return false;
  }

  for (JsonObjectConst candidate :
       movement["pages"].as<JsonArrayConst>()) {
    const char* id =
        candidate["id"] | nullptr;

    if (id &&
        pageId == id) {
      page = candidate;
      return true;
    }
  }

  error = "movement_not_found";
  return false;
}

bool MovementRuntime::applySpeed(
    Execution& execution,
    uint8_t speed) {
  speed = std::min<uint8_t>(126, speed);

  if (!_commandCenter.setLoco(
          execution.state.locoAddress,
          speed,
          execution.state.direction == "forward"))
    return false;

  execution.state.desiredSpeed = speed;
  execution.state.moving = speed > 0;
  publishChanged();
  return true;
}

void MovementRuntime::releaseAuthority(
    Execution& execution) {
  if (!execution.activeLegOwnerId.isEmpty()) {
    _dispatcher.releaseLeg(
        execution.activeLegOwnerId);
    execution.activeLegOwnerId = "";
  }

  execution.state.targetBlockId = 0;
}

void MovementRuntime::finish(
    Execution& execution,
    const String& status,
    const String& error) {
  applySpeed(execution, 0);
  releaseAuthority(execution);
  execution.state.status = status;
  execution.state.error = error;
  execution.state.stoppedAtMs = millis();
  execution.state.moving = false;
  execution.state.info =
      error.isEmpty()
          ? "Movement finished"
          : error;
  publishChanged();
}

bool MovementRuntime::acquireLeg(
    Execution& execution,
    size_t legIndex,
    String& error,
    bool prepared) {
  if (legIndex >= execution.plan.legs.size()) {
    error = "movement_leg_missing";
    return false;
  }

  const auto& leg =
      execution.plan.legs[legIndex];

  DispatcherLegRequest request;
  request.ownerId =
      "movement:" +
      execution.state.pageId +
      ":leg:" +
      String(static_cast<unsigned int>(legIndex));
  request.ownerName =
      "Movement: " +
      execution.state.movementName;
  request.locoAddress =
      execution.state.locoAddress;
  request.fromBlockId =
      leg.from.blockId;
  request.toBlockId =
      leg.to.blockId;
  request.safetySensors =
      leg.safetySensors;
  request.turnouts =
      leg.turnouts;

  for (const auto& turnout :
       leg.turnouts) {
    request.turnoutAddresses.push_back(
        turnout.address);
    request.resourceKeys.push_back(
        "turnout:" +
        String(turnout.address));
  }

  for (const auto& resource :
       leg.resources)
    request.resourceKeys.push_back(
        resource.key);

  const auto result =
      _dispatcher.acquireLeg(request);

  if (!result.ok) {
    error = result.error;
    return false;
  }

  if (prepared) {
    execution.preparedLegOwnerId = request.ownerId;
    execution.preparedLegIndex = legIndex;
  } else {
    execution.activeLegOwnerId = request.ownerId;
  }
  execution.state.targetBlockId =
      leg.to.blockId;
  execution.state.activeRouteResourceKey =
      leg.from.key +
      "->" +
      leg.to.key;
  execution.state.info =
      "Authority " +
      leg.from.name +
      " -> " +
      leg.to.name;
  publishChanged();
  return true;
}

bool MovementRuntime::start(
    const String& pageId,
    String& error) {
  error = "";

  if (pageId.isEmpty()) {
    error = "invalid_movement";
    return false;
  }

  if (findExecution(pageId)) {
    error = "movement_already_running";
    return false;
  }

  JsonDocument document;
  JsonObjectConst page;

  if (!loadPage(
          pageId,
          document,
          page,
          error))
    return false;

  if (!(page["enabled"] | true)) {
    error = "movement_disabled";
    return false;
  }

  MovementPlan plan;
  if (!_planBuilder.build(
          page,
          plan,
          error))
    return false;

  if (plan.blocks.empty() ||
      plan.legs.empty()) {
    error = "movement_route_incomplete";
    return false;
  }

  RuntimeBlock* source =
      _layout.findBlockById(
          plan.blocks.front().blockId);

  if (!source ||
      !source->occupied() ||
      source->locoAddress == 0) {
    error = "movement_source_loco_missing";
    return false;
  }

  const int expected =
      page["expectedLocoAddress"] | 0;

  if (expected > 0 &&
      expected != source->locoAddress) {
    error = "movement_source_loco_mismatch";
    return false;
  }

  Execution execution;
  execution.state.pageId = pageId;
  execution.state.movementName =
      page["name"] | "Movement";
  execution.state.status = "starting";
  execution.state.startedAtMs = millis();
  execution.state.locoAddress =
      source->locoAddress;
  execution.state.direction =
      plan.direction;
  execution.state.desiredSpeed =
      static_cast<uint8_t>(
          std::max(
              0,
              std::min(
                  126,
                  page["speed"] | 20)));
  execution.state.currentBlockId =
      plan.blocks.front().blockId;
  execution.state.currentResourceKey =
      plan.blocks.front().key;
  execution.state.info =
      "Starting from " +
      plan.blocks.front().name;
  execution.plan =
      std::move(plan);
  loadActions(
      page,
      execution.actions);

  _executions.push_back(
      std::move(execution));

  Execution& active =
      _executions.back();

  // Direction is armed at zero before route authority is requested.
  if (!applySpeed(active, 0)) {
    error = "movement_loco_command_failed";
    finish(active, "error", error);
    return false;
  }

  if (!acquireLeg(
          active,
          0,
          error)) {
    finish(active, "error", error);
    return false;
  }

  active.state.status = "running";

  if (!applySpeed(
          active,
          active.state.desiredSpeed)) {
    error = "movement_loco_command_failed";
    finish(active, "error", error);
    return false;
  }

  publishChanged();
  return true;
}

bool MovementRuntime::conditionsSatisfied(
    const std::vector<MovementSensorCondition>& conditions) const {
  if (conditions.empty())
    return false;

  for (const auto& condition :
       conditions) {
    if (condition.sensor == 0)
      return false;

    bool on = false;
    if (!_layout.getSensorState(
            condition.sensor,
            on) ||
        on != condition.state)
      return false;
  }

  return true;
}

bool MovementRuntime::arrived(
    const MovementPlanLeg& leg) const {
  return conditionsSatisfied(
      leg.arrivedWhen);
}

bool MovementRuntime::leaveSatisfied(
    Execution& execution,
    const MovementPlanLeg& leg) const {
  if (leg.leaveWhen.empty())
    return true;

  if (leg.leaveWhenExplicit)
    return conditionsSatisfied(
        leg.leaveWhen);

  if (leg.from.sensorAddress == 0)
    return false;

  bool occupied = false;
  if (!_layout.getSensorState(
          leg.from.sensorAddress,
          occupied))
    return false;

  if (occupied) {
    execution.leaveSeenOccupied = true;
    return false;
  }

  return execution.leaveSeenOccupied;
}

bool MovementRuntime::legSafetyFree(
    const MovementPlanLeg& leg) const {
  for (const auto sensor :
       leg.safetySensors) {
    bool on = false;
    if (!_layout.getSensorState(
            sensor,
            on) ||
        on)
      return false;
  }

  return true;
}

bool MovementRuntime::targetBasicallyFree(
    const MovementPlanLeg& leg) const {
  RuntimeBlock* target =
      const_cast<LayoutRuntime&>(_layout)
          .findBlockById(
              leg.to.blockId);

  return target &&
         !target->hasRuntimeState();
}

bool MovementRuntime::executeAction(
    Execution& execution,
    const MovementAction& action,
    String& error) {
  if (action.kind == "speed") {
    const uint8_t speed =
        static_cast<uint8_t>(
            std::max(
                0,
                std::min(
                    126,
                    action.speed)));
    execution.state.desiredSpeed = speed;
    return applySpeed(
        execution,
        speed);
  }

  if (action.kind == "function") {
    const int fn =
        std::max(
            0,
            std::min(
                68,
                action.functionNumber));

    if (!_commandCenter.setLocoFunction(
            execution.state.locoAddress,
            static_cast<uint8_t>(fn),
            action.functionActive)) {
      error = "movement_function_command_failed";
      return false;
    }
    return true;
  }

  if (action.kind == "horn") {
    const int fn =
        std::max(
            0,
            std::min(
                68,
                action.functionNumber));

    if (!_commandCenter.setLocoFunction(
            execution.state.locoAddress,
            static_cast<uint8_t>(fn),
            true)) {
      error = "movement_horn_on_failed";
      return false;
    }

    execution.hornActive = true;
    execution.hornFunction =
        static_cast<uint8_t>(fn);
    execution.actionWaitUntilMs =
        millis() +
        static_cast<unsigned long>(
            std::max(
                1,
                std::min(
                    600000,
                    action.pulseMs)));
    return true;
  }

  if (action.kind == "delay") {
    execution.actionWaitUntilMs =
        millis() +
        static_cast<unsigned long>(
            std::max(
                0,
                std::min(
                    600000,
                    action.delayMs)));
    return true;
  }

  if (action.kind == "setAccessory") {
    if (action.accessoryAddress < 1 ||
        action.accessoryAddress > 65535 ||
        !_commandCenter.setAccessory(
            static_cast<uint16_t>(
                action.accessoryAddress),
            action.accessoryActive)) {
      error = "movement_accessory_command_failed";
      return false;
    }
    return true;
  }

  if (action.kind == "setExtendedAccessory") {
    if (action.accessoryAddress < 1 ||
        action.accessoryAddress > 65535 ||
        !_commandCenter.setSignalAspect(
            static_cast<uint16_t>(
                action.accessoryAddress),
            static_cast<int16_t>(
                action.accessoryAspect))) {
      error = "movement_extended_accessory_command_failed";
      return false;
    }
    return true;
  }

  if (action.kind == "log") {
    execution.state.info =
        action.message;
    publishChanged();
    return true;
  }

  // Audio/random actions are intentionally left for the WS audio lifecycle
  // layer; unknown actions are ignored like the Windows switch default.
  return true;
}

bool MovementRuntime::runBlockingActions(
    Execution& execution,
    const String& resourceKey,
    const String& when,
    String& error) {
  const String eventKey =
      resourceKey + "|" + when;

  if (!execution.blockingActionsActive) {
    execution.blockingActionIndexes.clear();
    execution.blockingActionPosition = 0;
    execution.blockingEventKey =
        eventKey;

    for (size_t i = 0;
         i < execution.actions.size();
         ++i) {
      const auto& action =
          execution.actions[i];

      if (action.resourceKey ==
              resourceKey &&
          action.when == when &&
          action.sequenceMode !=
              "background")
        execution.blockingActionIndexes
            .push_back(i);
    }

    execution.blockingActionsActive =
        !execution.blockingActionIndexes.empty();

    if (!execution.blockingActionsActive)
      return true;
  } else if (
      execution.blockingEventKey !=
      eventKey) {
    error = "movement_blocking_action_overlap";
    return false;
  }

  if (execution.actionWaitUntilMs != 0) {
    if (static_cast<long>(
            millis() -
            execution.actionWaitUntilMs) < 0)
      return false;

    execution.actionWaitUntilMs = 0;

    if (execution.hornActive) {
      _commandCenter.setLocoFunction(
          execution.state.locoAddress,
          execution.hornFunction,
          false);
      execution.hornActive = false;
    }

    ++execution.blockingActionPosition;
  }

  while (execution.blockingActionPosition <
         execution.blockingActionIndexes.size()) {
    const auto& action =
        execution.actions[
            execution.blockingActionIndexes[
                execution.blockingActionPosition]];

    if (!executeAction(
            execution,
            action,
            error))
      return false;

    if (execution.actionWaitUntilMs != 0)
      return false;

    ++execution.blockingActionPosition;
  }

  execution.blockingActionsActive = false;
  execution.blockingActionIndexes.clear();
  execution.blockingActionPosition = 0;
  execution.blockingEventKey = "";
  return true;
}

void MovementRuntime::processExecution(
    Execution& execution) {
  if (execution.state.status != "running")
    return;

  if (execution.legIndex >=
      execution.plan.legs.size()) {
    finish(execution, "finished");
    return;
  }

  const auto& leg =
      execution.plan.legs[
          execution.legIndex];

  if (!execution.departed) {
    if (!leg.departWhen.empty() &&
        !conditionsSatisfied(
            leg.departWhen)) {
      if (execution.state.moving)
        applySpeed(execution, 0);

      execution.state.info =
          "Waiting for departure condition at " +
          leg.from.name;
      publishChanged();
      return;
    }

    execution.departed = true;
    execution.leaveSeenOccupied = false;

    if (leg.from.sensorAddress != 0) {
      bool occupied = false;
      if (_layout.getSensorState(
              leg.from.sensorAddress,
              occupied) &&
          occupied)
        execution.leaveSeenOccupied = true;
    }

    if (!execution.state.moving &&
        !applySpeed(
            execution,
            execution.state.desiredSpeed)) {
      finish(
          execution,
          "error",
          "movement_loco_command_failed");
      return;
    }
  }

  if (!execution.approachFired &&
      !leg.approachWhen.empty() &&
      conditionsSatisfied(
          leg.approachWhen)) {
    execution.approachFired = true;
    execution.state.info =
        "Approaching: " +
        leg.to.name;
    publishChanged();
  }

  if (!execution.arrivedCommitted) {
    if (!arrived(leg))
      return;

    if (!_layout.setBlock(
            leg.to.blockId,
            String(execution.state.locoAddress),
            execution.state.locoAddress)) {
      finish(
          execution,
          "error",
          "movement_destination_commit_failed");
      return;
    }

    execution.arrivedCommitted = true;
    execution.state.currentBlockId =
        leg.to.blockId;
    execution.state.currentResourceKey =
        leg.to.key;

    // ARRIVED makes the destination the legal source for the next leg.
    // Release old route authority now, but retain the old block occupancy
    // until its LEAVE condition has actually fired.
    releaseAuthority(execution);

    const size_t nextIndex =
        execution.legIndex + 1;
    const bool hasNext =
        nextIndex <
        execution.plan.legs.size();

    if (execution.stopping ||
        !hasNext) {
      applySpeed(execution, 0);
    } else {
      const auto& next =
          execution.plan.legs[nextIndex];

      const bool mayKeepRolling =
          next.departWhen.empty() &&
          targetBasicallyFree(next) &&
          legSafetyFree(next);

      if (!mayKeepRolling) {
        if (!applySpeed(execution, 0)) {
          finish(
              execution,
              "error",
              "movement_loco_command_failed");
          return;
        }
      } else {
        String error;
        if (!acquireLeg(
                execution,
                nextIndex,
                error,
                true)) {
          applySpeed(execution, 0);
          execution.state.info =
              "Waiting at " +
              leg.to.name +
              ": " +
              error;
          publishChanged();
        } else {
          execution.state.info =
              "Next leg prepared: " +
              next.from.name +
              " -> " +
              next.to.name;
          publishChanged();
        }
      }
    }
  }

  if (!leaveSatisfied(
          execution,
          leg))
    return;

  RuntimeBlock* source =
      _layout.findBlockById(
          leg.from.blockId);

  if (source &&
      source->locoAddress ==
          execution.state.locoAddress)
    _layout.removeBlock(
        leg.from.blockId,
        source->locoId);

  ++execution.legIndex;
  execution.departed = false;
  execution.approachFired = false;
  execution.arrivedCommitted = false;
  execution.leaveSeenOccupied = false;

  if (execution.stopping ||
      execution.legIndex >=
          execution.plan.legs.size()) {
    finish(execution, "finished");
    return;
  }

  const auto& next =
      execution.plan.legs[
          execution.legIndex];

  if (!execution.preparedLegOwnerId.isEmpty() &&
      execution.preparedLegIndex ==
          execution.legIndex) {
    execution.activeLegOwnerId =
        execution.preparedLegOwnerId;
    execution.preparedLegOwnerId = "";
    execution.preparedLegIndex =
        static_cast<size_t>(-1);
  } else {
    String error;
    if (!acquireLeg(
            execution,
            execution.legIndex,
            error)) {
      finish(execution, "error", error);
      return;
    }
  }

  if (next.departWhen.empty()) {
    execution.departed = true;

    if (!execution.state.moving &&
        !applySpeed(
            execution,
            execution.state.desiredSpeed)) {
      finish(
          execution,
          "error",
          "movement_loco_command_failed");
      return;
    }
  } else {
    applySpeed(execution, 0);
    execution.state.info =
        "Waiting for departure condition at " +
        next.from.name;
    publishChanged();
  }
}

void MovementRuntime::loop() {
  for (auto& execution : _executions)
    processExecution(execution);
}

bool MovementRuntime::stop(
    const String& pageId) {
  Execution* execution =
      findExecution(pageId);

  if (!execution ||
      execution->state.status != "running")
    return false;

  execution->stopping = true;
  applySpeed(*execution, 0);
  execution->state.status = "stopping";
  execution->state.info = "Movement stop requested";
  publishChanged();
  return true;
}

bool MovementRuntime::abort(
    const String& pageId) {
  Execution* execution =
      findExecution(pageId);

  if (!execution)
    return false;

  execution->aborting = true;
  finish(*execution, "aborted");
  return true;
}

size_t MovementRuntime::stopAll() {
  size_t count = 0;
  for (auto& execution : _executions)
    if (stop(execution.state.pageId))
      ++count;
  return count;
}

size_t MovementRuntime::abortAll() {
  size_t count = 0;
  for (auto& execution : _executions)
    if (abort(execution.state.pageId))
      ++count;
  return count;
}

void MovementRuntime::onRuntimeChange(
    RuntimeChangeKind kind,
    uint16_t,
    uint8_t) {
  if (kind != RuntimeChangeKind::Sensor &&
      kind != RuntimeChangeKind::Block)
    return;

  for (auto& execution : _executions)
    processExecution(execution);
}

void MovementRuntime::appendSnapshot(
    JsonObject out) const {
  JsonArray states =
      out["states"].to<JsonArray>();

  for (const auto& execution :
       _executions) {
    const auto& state =
        execution.state;

    JsonObject item =
        states.add<JsonObject>();

    item["pageId"] = state.pageId;
    item["movementName"] = state.movementName;
    item["status"] = state.status;
    item["startedAt"] = state.startedAtMs;
    if (state.stoppedAtMs)
        item["stoppedAt"] = state.stoppedAtMs;
    else
        item["stoppedAt"] = nullptr;
    item["locoAddress"] = state.locoAddress;
    item["direction"] = state.direction;
    item["desiredSpeed"] = state.desiredSpeed;
    item["moving"] = state.moving;
    item["currentBlockId"] =
        state.currentBlockId;
    item["targetBlockId"] =
        state.targetBlockId;
    item["currentResourceKey"] =
        state.currentResourceKey;
    item["activeRouteResourceKey"] =
        state.activeRouteResourceKey;
    item["info"] = state.info;
    item["error"] = state.error;
  }
}

bool MovementRuntime::takeChanged() {
  const bool changed = _changed;
  _changed = false;
  return changed;
}
