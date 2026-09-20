#pragma once

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

#include "ICommandCenter.h"
#include "LayoutRuntime.h"

#ifndef HUB_JS_SANDBOX
#define HUB_JS_SANDBOX 0
#endif

enum class JsSandboxState : uint8_t {
  Idle,
  Running,
  Paused,
  Stopping,
  Aborting,
  Completed,
  Stopped,
  Aborted,
  Error
};

struct JsSandboxSnapshot {
  JsSandboxState state = JsSandboxState::Idle;
  String stateText = "idle";
  String lastError;
  String log;
  uint32_t startedAtMs = 0;
  uint32_t finishedAtMs = 0;
  uint32_t totalHeap = 0;
  uint32_t freeHeap = 0;
  uint32_t minFreeHeap = 0;
  uint32_t largestFreeHeapBlock = 0;

  uint32_t totalPsram = 0;
  uint32_t freePsram = 0;
  uint32_t minFreePsram = 0;
  uint32_t largestFreePsramBlock = 0;

  uint32_t baselineFreeHeap = 0;
  uint32_t baselineFreePsram = 0;
  int32_t heapDeltaSinceStart = 0;
  int32_t psramDeltaSinceStart = 0;

  uint32_t sourceBytes = 0;
  uint32_t vmMemoryLimitBytes = 0;
  uint32_t taskStackBytes = 0;
};

class JsSandbox {
public:
  JsSandbox(
      ICommandCenter& commandCenter,
      LayoutRuntime& runtime);

  bool begin();

  bool start(
      const String& source,
      String& error);

  bool pause(
      String& error);

  bool resume(
      String& error);

  bool stop(
      String& error);

  bool abort(
      String& error);

  JsSandboxSnapshot snapshot();

  // Native bindings: JavaScript can only call these high-level Hub operations.
  bool commandSetLocoFunction(
      uint16_t address,
      uint8_t functionNumber,
      bool active);

  bool commandSetLoco(
      uint16_t address,
      uint8_t speed,
      bool forward);

  bool commandSetTurnout(
      uint16_t address,
      bool closed);

  bool commandSetSignal(
      uint16_t address,
      int16_t aspect);

  bool sensorState(
      uint16_t address);

  void appendLog(
      const String& line);

  bool cooperativeCheckpoint();

private:
  ICommandCenter& _commandCenter;
  LayoutRuntime& _runtime;

#if HUB_JS_SANDBOX
  static constexpr size_t MAX_LOG_BYTES = 8192;
  static constexpr size_t MAX_SOURCE_BYTES = 32768;
  static constexpr uint32_t VM_MEMORY_LIMIT_BYTES = 192U * 1024U;
  static constexpr uint32_t TASK_STACK_BYTES = 20U * 1024U;

  SemaphoreHandle_t _mutex = nullptr;
  TaskHandle_t _task = nullptr;

  String _source;
  String _lastError;
  String _log;

  volatile JsSandboxState _state = JsSandboxState::Idle;
  volatile bool _pauseRequested = false;
  volatile bool _stopRequested = false;
  volatile bool _abortRequested = false;

  uint32_t _startedAtMs = 0;
  uint32_t _finishedAtMs = 0;

  uint32_t _baselineFreeHeap = 0;
  uint32_t _baselineFreePsram = 0;

  static void taskEntry(
      void* argument);

  void runWorker();

  bool lock(
      TickType_t timeout = pdMS_TO_TICKS(100));

  void unlock();

  void setState(
      JsSandboxState state);

  static const char* stateText(
      JsSandboxState state);
#endif
};
