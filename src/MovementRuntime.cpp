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
    action.minDelayMs =
        raw["minDelayMs"] | 500;
    action.maxDelayMs =
        raw["maxDelayMs"] | 1500;
    action.audioName =
        raw["audioName"] | "";
    action.audioWaitForEnd =
        raw["audioWaitForEnd"] | false;
    action.randomPlayChancePercent =
        raw["randomPlayChancePercent"] | 30;
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

void MovementRuntime::audioCompleted(
    const String& requestId,
    bool ok) {
  if (requestId.isEmpty())
    return;

  for (auto& execution : _executions) {
    if (execution.pendingAudioRequestId ==
        requestId) {
      execution.pendingAudioCompleted = true;
      execution.pendingAudioOk = ok;
      publishChanged();
      return;
    }

    for (auto& background :
         execution.backgroundSequences) {
      if (background.pendingAudioRequestId !=
          requestId)
        continue;

      background.pendingAudioCompleted = true;
      background.pendingAudioOk = ok;
      publishChanged();
      return;
    }
  }
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

void MovementRuntime::releasePreparedAuthority(
    Execution& execution) {
  if (execution.preparedLegOwnerId.isEmpty())
    return;
  _dispatcher.releaseLeg(execution.preparedLegOwnerId);
  execution.preparedLegOwnerId = "";
  execution.preparedLegIndex = static_cast<size_t>(-1);
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
  releasePreparedAuthority(execution);
  if (execution.hornActive) {
    _commandCenter.setLocoFunction(execution.state.locoAddress,
        execution.hornFunction, false);
    execution.hornActive = false;
  }
  for (auto& bg : execution.backgroundSequences) {
    if (bg.hornActive)
      _commandCenter.setLocoFunction(execution.state.locoAddress,
          bg.hornFunction, false);
    bg.hornActive = false;
  }
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

  if (Execution* existing = findExecution(pageId)) {
    if (existing->state.status == "running" ||
        existing->state.status == "stopping" ||
        existing->state.status == "starting") {
      error = "movement_already_running";
      return false;
    }
    _executions.erase(
        std::remove_if(_executions.begin(), _executions.end(),
            [&pageId](const Execution& item) {
              return item.state.pageId == pageId;
            }),
        _executions.end());
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

bool MovementRuntime::resourceEventSatisfied(
    const MovementPlanResource& resource,
    bool leaving) const {
  if (resource.detectors.empty())
    return false;
  bool any = false;
  for (const uint16_t sensor : resource.detectors) {
    bool on = false;
    if (!_layout.getSensorState(sensor, on))
      return false;
    if (leaving) {
      if (on) return false;
    } else if (on) {
      any = true;
    }
  }
  return leaving ? true : any;
}

bool MovementRuntime::runResourceEvents(
    Execution& execution,
    const MovementPlanLeg& leg,
    String& error) {
  for (const auto& resource : leg.resources) {
    if (resource.kind != "segment" && resource.kind != "turnout")
      continue;

    const bool entered = std::find(
        execution.enteredResources.begin(),
        execution.enteredResources.end(),
        resource.key) != execution.enteredResources.end();

    if (!entered && resourceEventSatisfied(resource, false)) {
      const String eventKey = resource.key + "|enter";
      startBackgroundActions(execution, resource.key, "enter");
      if (!runBlockingActions(execution, resource.key, "enter", error))
        return false;
      execution.enteredResources.push_back(resource.key);
      execution.firedResourceEvents.push_back(eventKey);
      execution.state.currentResourceKey = resource.key;
      publishChanged();
    }

    const bool nowEntered = std::find(
        execution.enteredResources.begin(),
        execution.enteredResources.end(),
        resource.key) != execution.enteredResources.end();
    const String leaveKey = resource.key + "|leave";
    const bool left = std::find(
        execution.firedResourceEvents.begin(),
        execution.firedResourceEvents.end(),
        leaveKey) != execution.firedResourceEvents.end();

    if (nowEntered && !left && resourceEventSatisfied(resource, true)) {
      startBackgroundActions(execution, resource.key, "leave");
      if (!runBlockingActions(execution, resource.key, "leave", error))
        return false;
      execution.firedResourceEvents.push_back(leaveKey);
      publishChanged();
    }
  }
  return true;
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

  if (action.kind == "randomDelay") {
    const int minMs =
        std::max(
            0,
            std::min(
                600000,
                std::min(
                    action.minDelayMs,
                    action.maxDelayMs)));
    const int maxMs =
        std::max(
            minMs,
            std::min(
                600000,
                std::max(
                    action.minDelayMs,
                    action.maxDelayMs)));
    const int span = maxMs - minMs;
    const int waitMs =
        minMs +
        (span > 0
             ? static_cast<int>(random(span + 1))
             : 0);
    execution.actionWaitUntilMs =
        millis() +
        static_cast<unsigned long>(waitMs);
    return true;
  }

  if (action.kind == "playAudio" ||
      action.kind == "randomPlay") {
    if (action.audioName.isEmpty())
      return true;

    if (action.kind == "randomPlay") {
      const int roll =
          static_cast<int>(random(1, 11));
      const int threshold =
          std::max(
              1,
              std::min(
                  9,
                  (action.randomPlayChancePercent + 5) /
                      10));

      if (roll > threshold) {
        execution.state.info =
            "Random audio skipped: " +
            String(roll) + "/" +
            String(threshold);
        publishChanged();
        return true;
      }
    }

    if (!_audioRequest) {
      error = "movement_audio_unavailable";
      return false;
    }

    const String requestId =
        "movement-backend:" +
        execution.state.pageId + ":" +
        String(millis());

    if (!_audioRequest(
            requestId,
            action.audioName)) {
      error = "movement_audio_failed";
      return false;
    }

    if (action.audioWaitForEnd) {
      execution.pendingAudioRequestId =
          requestId;
      execution.pendingAudioCompleted = false;
      execution.pendingAudioOk = false;
    }

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

  if (!execution.pendingAudioRequestId.isEmpty()) {
    if (!execution.pendingAudioCompleted)
      return false;

    if (!execution.pendingAudioOk) {
      error = "movement_audio_failed";
      execution.pendingAudioRequestId = "";
      execution.pendingAudioCompleted = false;
      return false;
    }

    execution.pendingAudioRequestId = "";
    execution.pendingAudioCompleted = false;
    execution.pendingAudioOk = false;
    ++execution.blockingActionPosition;
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

    if (execution.actionWaitUntilMs != 0 ||
        !execution.pendingAudioRequestId.isEmpty())
      return false;

    ++execution.blockingActionPosition;
  }

  execution.blockingActionsActive = false;
  execution.blockingActionIndexes.clear();
  execution.blockingActionPosition = 0;
  execution.blockingEventKey = "";
  return true;
}

void MovementRuntime::startBackgroundActions(
    Execution& execution,
    const String& resourceKey,
    const String& when) {
  const String eventKey =
      resourceKey + "|" + when;

  if (std::find(
          execution.firedBackgroundEvents.begin(),
          execution.firedBackgroundEvents.end(),
          eventKey) !=
      execution.firedBackgroundEvents.end())
    return;

  execution.firedBackgroundEvents.push_back(
      eventKey);

  std::vector<String> sequenceIds;
  for (size_t i = 0;
       i < execution.actions.size();
       ++i) {
    const auto& action = execution.actions[i];
    if (action.resourceKey != resourceKey ||
        action.when != when ||
        action.sequenceMode != "background")
      continue;

    String id = action.sequenceId;
    if (id.isEmpty())
      id = "legacy:" + eventKey;

    auto found = std::find(
        sequenceIds.begin(),
        sequenceIds.end(),
        id);

    if (found == sequenceIds.end()) {
      sequenceIds.push_back(id);
      execution.backgroundSequences.emplace_back();
      execution.backgroundSequences.back()
          .actionIndexes.push_back(i);
    } else {
      const size_t index =
          static_cast<size_t>(
              found - sequenceIds.begin());
      execution.backgroundSequences[index]
          .actionIndexes.push_back(i);
    }
  }
}

void MovementRuntime::processBackgroundActions(
    Execution& execution) {
  for (auto& sequence :
       execution.backgroundSequences) {
    if (sequence.failed ||
        sequence.position >=
            sequence.actionIndexes.size())
      continue;

    if (!sequence.pendingAudioRequestId.isEmpty()) {
      if (!sequence.pendingAudioCompleted)
        continue;

      if (!sequence.pendingAudioOk) {
        sequence.failed = true;
        sequence.error = "movement_audio_failed";
        sequence.pendingAudioRequestId = "";
        continue;
      }

      sequence.pendingAudioRequestId = "";
      sequence.pendingAudioCompleted = false;
      sequence.pendingAudioOk = false;
      ++sequence.position;
    }

    if (sequence.waitUntilMs != 0) {
      if (static_cast<long>(
              millis() - sequence.waitUntilMs) < 0)
        continue;

      sequence.waitUntilMs = 0;
      if (sequence.hornActive) {
        _commandCenter.setLocoFunction(
            execution.state.locoAddress,
            sequence.hornFunction,
            false);
        sequence.hornActive = false;
      }
      ++sequence.position;
    }

    while (sequence.position <
           sequence.actionIndexes.size()) {
      const auto& action =
          execution.actions[
              sequence.actionIndexes[
                  sequence.position]];
      String error;

      if (action.kind == "delay" ||
          action.kind == "randomDelay") {
        int waitMs = action.delayMs;
        if (action.kind == "randomDelay") {
          const int minMs = std::max(0, std::min(600000,
              std::min(action.minDelayMs, action.maxDelayMs)));
          const int maxMs = std::max(minMs, std::min(600000,
              std::max(action.minDelayMs, action.maxDelayMs)));
          waitMs = minMs + (maxMs > minMs
              ? static_cast<int>(random(maxMs - minMs + 1)) : 0);
        }
        sequence.waitUntilMs = millis() +
            static_cast<unsigned long>(std::max(0, std::min(600000, waitMs)));
        break;
      }

      if (action.kind == "horn") {
        const uint8_t fn = static_cast<uint8_t>(
            std::max(0, std::min(68, action.functionNumber)));
        if (!_commandCenter.setLocoFunction(
                execution.state.locoAddress, fn, true)) {
          sequence.failed = true;
          sequence.error = "movement_horn_on_failed";
          break;
        }
        sequence.hornActive = true;
        sequence.hornFunction = fn;
        sequence.waitUntilMs = millis() +
            static_cast<unsigned long>(
                std::max(1, std::min(600000, action.pulseMs)));
        break;
      }

      if (action.kind == "playAudio" ||
          action.kind == "randomPlay") {
        bool play = !action.audioName.isEmpty();
        if (play && action.kind == "randomPlay") {
          const int roll = static_cast<int>(random(1, 11));
          const int threshold = std::max(1, std::min(9,
              (action.randomPlayChancePercent + 5) / 10));
          play = roll <= threshold;
        }
        if (play) {
          const String requestId =
              "movement-backend:" + execution.state.pageId +
              ":bg:" + String(millis()) + ":" + String(sequence.position);
          if (!_audioRequest || !_audioRequest(requestId, action.audioName)) {
            sequence.failed = true;
            sequence.error = "movement_audio_failed";
            break;
          }
          if (action.audioWaitForEnd) {
            sequence.pendingAudioRequestId = requestId;
            sequence.pendingAudioCompleted = false;
            sequence.pendingAudioOk = false;
            break;
          }
        }
        ++sequence.position;
        continue;
      }

      if (!executeAction(execution, action, error)) {
        sequence.failed = true;
        sequence.error = error;
        break;
      }

      // executeAction uses the foreground wait fields only for the three
      // action kinds handled above, so all remaining actions complete now.
      ++sequence.position;
    }
  }
}

void MovementRuntime::processExecution(
    Execution& execution) {
  processBackgroundActions(execution);
  if (execution.state.status != "running" &&
      execution.state.status != "stopping")
    return;

  if (execution.legIndex >=
      execution.plan.legs.size()) {
    finish(execution, "finished");
    return;
  }

  const auto& leg =
      execution.plan.legs[
          execution.legIndex];

  if (execution.departed && !execution.arrivedCommitted &&
      !legSafetyFree(leg)) {
    applySpeed(execution, 0);
    finish(execution, "error", "movement_safety_became_unsafe");
    return;
  }

  String resourceError;
  if (!runResourceEvents(execution, leg, resourceError)) {
    if (!resourceError.isEmpty())
      finish(execution, "error", resourceError);
    return;
  }

  if (!execution.departed) {
    startBackgroundActions(
        execution,
        leg.from.key,
        "beforeDepart");
    String actionError;
    if (!runBlockingActions(
            execution,
            leg.from.key,
            "beforeDepart",
            actionError)) {
      if (!actionError.isEmpty())
        finish(execution, "error", actionError);
      return;
    }

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

    startBackgroundActions(
        execution,
        leg.from.key,
        "depart");
    if (!runBlockingActions(
            execution,
            leg.from.key,
            "depart",
            actionError)) {
      if (!actionError.isEmpty())
        finish(execution, "error", actionError);
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
    startBackgroundActions(
        execution,
        leg.to.key,
        "approach");
    String actionError;
    if (!runBlockingActions(
            execution,
            leg.to.key,
            "approach",
            actionError)) {
      if (!actionError.isEmpty())
        finish(execution, "error", actionError);
      return;
    }

    execution.approachFired = true;
    execution.state.info =
        "Approaching: " +
        leg.to.name;
    publishChanged();
  }

  if (!execution.arrivedCommitted) {
    if (!arrived(leg))
      return;

    startBackgroundActions(
        execution,
        leg.to.key,
        "arrived");
    String actionError;
    if (!runBlockingActions(
            execution,
            leg.to.key,
            "arrived",
            actionError)) {
      if (!actionError.isEmpty())
        finish(execution, "error", actionError);
      return;
    }

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

  startBackgroundActions(
      execution,
      leg.from.key,
      "leave");
  String leaveActionError;
  if (!runBlockingActions(
          execution,
          leg.from.key,
          "leave",
          leaveActionError)) {
    if (!leaveActionError.isEmpty())
      finish(execution, "error", leaveActionError);
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

  ++execution.legIndex;
  execution.departed = false;
  execution.approachFired = false;
  execution.arrivedCommitted = false;
  execution.leaveSeenOccupied = false;
  execution.enteredResources.clear();
  execution.firedResourceEvents.clear();

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

  // Never recurse into the movement state machine from LayoutRuntime notify().
  // loop() processes the changed state after the current mutation unwinds.
  for (auto& execution : _executions)
    execution.runtimeDirty = true;
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
