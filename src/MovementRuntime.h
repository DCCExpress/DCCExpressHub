#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>

#include "DispatcherRuntime.h"
#include "ICommandCenter.h"
#include "LayoutRuntime.h"
#include "MovementPlanBuilder.h"

struct MovementAction {
  String resourceKey;
  String when;
  String sequenceId;
  String sequenceMode = "blocking";
  String kind = "log";
  int speed = 20;
  int functionNumber = 2;
  bool functionActive = true;
  int pulseMs = 700;
  int delayMs = 500;
  int minDelayMs = 500;
  int maxDelayMs = 1500;
  String audioName;
  bool audioWaitForEnd = false;
  int randomPlayChancePercent = 30;
  int accessoryAddress = 1;
  bool accessoryActive = true;
  int accessoryAspect = 0;
  String message;
};

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
  using AudioRequestCallback =
      std::function<bool(
          const String& requestId,
          const String& fileName)>;
  MovementRuntime(
      LayoutRuntime& layout,
      DispatcherRuntime& dispatcher,
      ICommandCenter& commandCenter)
      : _layout(layout),
        _dispatcher(dispatcher),
        _commandCenter(commandCenter) {}

  bool begin();
  void loop();

  void audioCompleted(
      const String& requestId,
      bool ok);

  void setAudioRequestCallback(
      AudioRequestCallback callback) {
    _audioRequest = std::move(callback);
  }

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
  struct BackgroundSequence {
    std::vector<size_t> actionIndexes;
    size_t position = 0;
    unsigned long waitUntilMs = 0;
    bool hornActive = false;
    uint8_t hornFunction = 0;
    String pendingAudioRequestId;
    bool pendingAudioCompleted = false;
    bool pendingAudioOk = false;
    bool failed = false;
    String error;
  };

  struct Execution {
    MovementRuntimeState state;
    MovementPlan plan;
    size_t legIndex = 0;
    String activeLegOwnerId;
    String preparedLegOwnerId;
    size_t preparedLegIndex = static_cast<size_t>(-1);
    bool stopping = false;
    bool aborting = false;
    bool departed = false;
    bool approachFired = false;
    bool arrivedCommitted = false;
    bool leaveSeenOccupied = false;
    bool runtimeDirty = true;
    std::vector<String> firedResourceEvents;
    std::vector<String> enteredResources;
    std::vector<MovementAction> actions;
    std::vector<BackgroundSequence> backgroundSequences;
    std::vector<String> firedBackgroundEvents;
    std::vector<size_t> blockingActionIndexes;
    size_t blockingActionPosition = 0;
    bool blockingActionsActive = false;
    String blockingEventKey;
    unsigned long actionWaitUntilMs = 0;
    bool hornActive = false;
    uint8_t hornFunction = 0;
    String sourceLocoId;
    String eventDelayKey;
    unsigned long eventDelayUntilMs = 0;
    String pendingAudioRequestId;
    bool pendingAudioCompleted = false;
    bool pendingAudioOk = false;
  };

  LayoutRuntime& _layout;
  DispatcherRuntime& _dispatcher;
  ICommandCenter& _commandCenter;
  MovementPlanBuilder _planBuilder;
  std::vector<Execution> _executions;
  bool _changed = true;
  AudioRequestCallback _audioRequest;

  static void loadActions(
      JsonObjectConst page,
      std::vector<MovementAction>& actions);

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

  bool leaveSatisfied(
      Execution& execution,
      const MovementPlanLeg& leg) const;

  bool legSafetyFree(
      const MovementPlanLeg& leg) const;

  bool targetBasicallyFree(
      const MovementPlanLeg& leg) const;

  bool resourceEventSatisfied(
      const MovementPlan& plan,
      const MovementPlanResource& resource,
      bool leaving) const;

  bool runResourceEvents(
      Execution& execution,
      const MovementPlanLeg& leg,
      String& error);

  bool waitEventDelay(
      Execution& execution,
      const String& key,
      int delayMs);

  void releasePreparedAuthority(
      Execution& execution);

  bool runBlockingActions(
      Execution& execution,
      const String& resourceKey,
      const String& when,
      String& error);

  bool executeAction(
      Execution& execution,
      const MovementAction& action,
      String& error);

  void startBackgroundActions(
      Execution& execution,
      const String& resourceKey,
      const String& when);

  void processBackgroundActions(
      Execution& execution);

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
