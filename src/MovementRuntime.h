#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>

#include "DispatcherRuntime.h"
#include "ICommandCenter.h"
#include "LayoutRuntime.h"
#include "MovementPlanBuilder.h"

struct MovementRuntimeState {
  String pageId;
  String movementName;
  String status = "idle";
  unsigned long startedAtMs = 0;
  unsigned long stoppedAtMs = 0;
  uint16_t locoAddress = 0;
  String direction;
  uint8_t desiredSpeed = 0;
  bool moving = false;
  uint16_t currentBlockId = 0;
  uint16_t targetBlockId = 0;
  String currentResourceKey;
  String activeRouteResourceKey;
  String info;
  String error;
};

class MovementRuntime {
public:
  MovementRuntime(
      LayoutRuntime& layout,
      DispatcherRuntime& dispatcher,
      ICommandCenter& commandCenter)
      : _layout(layout),
        _dispatcher(dispatcher),
        _commandCenter(commandCenter) {}

  bool begin();
  void loop();

  bool start(
      const String& pageId,
      String& error);

  bool stop(
      const String& pageId);

  bool abort(
      const String& pageId);

  size_t stopAll();
  size_t abortAll();

  void onRuntimeChange(
      RuntimeChangeKind kind,
      uint16_t id,
      uint8_t channel);

  void appendSnapshot(
      JsonObject out) const;

  bool takeChanged();

private:
  struct Execution {
    MovementRuntimeState state;
    MovementPlan plan;
    size_t legIndex = 0;
    String activeLegOwnerId;
    String preparedLegOwnerId;
    size_t preparedLegIndex = static_cast<size_t>(-1);
    bool stopping = false;
    bool aborting = false;
  };

  LayoutRuntime& _layout;
  DispatcherRuntime& _dispatcher;
  ICommandCenter& _commandCenter;
  MovementPlanBuilder _planBuilder;
  std::vector<Execution> _executions;
  bool _changed = true;

  bool loadPage(
      const String& pageId,
      JsonDocument& document,
      JsonObjectConst& page,
      String& error) const;

  Execution* findExecution(
      const String& pageId);

  bool acquireLeg(
      Execution& execution,
      size_t legIndex,
      String& error,
      bool prepared = false);

  bool applySpeed(
      Execution& execution,
      uint8_t speed);

  bool conditionsSatisfied(
      const std::vector<MovementSensorCondition>& conditions) const;

  bool arrived(
      const MovementPlanLeg& leg) const;

  bool legSafetyFree(
      const MovementPlanLeg& leg) const;

  bool targetBasicallyFree(
      const MovementPlanLeg& leg) const;

  void processExecution(
      Execution& execution);

  void finish(
      Execution& execution,
      const String& status,
      const String& error = "");

  void releaseAuthority(
      Execution& execution);

  void publishChanged() {
    _changed = true;
  }
};
