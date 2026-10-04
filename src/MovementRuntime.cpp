#include "MovementRuntime.h"

#include <LittleFS.h>
#include <algorithm>

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
    String& error) {
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

  execution.activeLegOwnerId =
      request.ownerId;
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

bool MovementRuntime::arrived(
    const MovementPlanLeg& leg) const {
  RuntimeBlock* target =
      const_cast<LayoutRuntime&>(_layout)
          .findBlockById(
              leg.to.blockId);

  if (!target) return false;

  // The physical occupancy detector is authoritative. A target marker alone
  // never counts as ARRIVED.
  if (target->sensorAddress == 0)
    return false;

  bool on = false;
  return _layout.getSensorState(
             target->sensorAddress,
             on) &&
         on;
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

  if (!arrived(leg))
    return;

  // Stop before changing block authority. This first slice intentionally
  // favours safety over seamless speed; later parity work will prepare the
  // next leg at APPROACH/ARRIVED like Windows.
  if (!applySpeed(execution, 0)) {
    finish(
        execution,
        "error",
        "movement_loco_command_failed");
    return;
  }

  RuntimeBlock* source =
      _layout.findBlockById(
          leg.from.blockId);

  if (source &&
      source->locoAddress ==
          execution.state.locoAddress)
    _layout.removeBlock(
        leg.from.blockId,
        source->locoId);

  _layout.setBlock(
      leg.to.blockId,
      String(execution.state.locoAddress),
      execution.state.locoAddress);

  releaseAuthority(execution);

  execution.state.currentBlockId =
      leg.to.blockId;
  execution.state.currentResourceKey =
      leg.to.key;
  ++execution.legIndex;

  if (execution.stopping ||
      execution.legIndex >=
          execution.plan.legs.size()) {
    finish(execution, "finished");
    return;
  }

  String error;
  if (!acquireLeg(
          execution,
          execution.legIndex,
          error)) {
    finish(execution, "error", error);
    return;
  }

  if (!applySpeed(
          execution,
          execution.state.desiredSpeed)) {
    finish(
        execution,
        "error",
        "movement_loco_command_failed");
    return;
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
    item["stoppedAt"] =
        state.stoppedAtMs
            ? JsonVariant(state.stoppedAtMs)
            : JsonVariant();
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
