#include "JsSandbox.h"

#include <vector>

#include "Logger.h"

#if HUB_JS_SANDBOX

extern "C" {
#include <quickjs.h>
}

namespace {

struct JsDelayTimer {
  uint32_t dueAt = 0;
  JSValue resolve = JS_UNDEFINED;
  JSValue reject = JS_UNDEFINED;
};

struct JsEngineState {
  JsSandbox* sandbox = nullptr;
  JSRuntime* runtime = nullptr;
  JSContext* context = nullptr;

  std::vector<JsDelayTimer> timers;

  int unhandledRejectionCount = 0;
  String lastUnhandledRejection;
};

JsEngineState* engineFrom(
    JSContext* ctx) {
  return
      static_cast<JsEngineState*>(
          JS_GetContextOpaque(ctx));
}

JsSandbox* sandboxFrom(
    JSContext* ctx) {
  JsEngineState* engine =
      engineFrom(
          ctx);

  return
      engine
          ? engine->sandbox
          : nullptr;
}

bool readUint32(
    JSContext* ctx,
    JSValueConst value,
    uint32_t& result) {
  return
      JS_ToUint32(
          ctx,
          &result,
          value) >= 0;
}

JSValue interrupted(
    JSContext* ctx) {
  return
      JS_ThrowInternalError(
          ctx,
          "Sandbox execution interrupted");
}

bool checkpoint(
    JSContext* ctx) {
  JsSandbox* sandbox =
      sandboxFrom(
          ctx);

  return
      sandbox &&
      sandbox->cooperativeCheckpoint();
}

String valueText(
    JSContext* ctx,
    JSValueConst value,
    const char* fallback) {
  const char* text =
      JS_ToCString(
          ctx,
          value);

  if (!text) {
    return
        String(
            fallback);
  }

  String result =
      text;

  JS_FreeCString(
      ctx,
      text);

  return result;
}

String exceptionText(
    JSContext* context) {
  JSValue exception =
      JS_GetException(
          context);

  String message =
      valueText(
          context,
          exception,
          "QuickJS exception");

  JSValue stack =
      JS_GetPropertyStr(
          context,
          exception,
          "stack");

  if (
      !JS_IsUndefined(
          stack)
  ) {
    const String stackText =
        valueText(
            context,
            stack,
            "");

    if (!stackText.isEmpty()) {
      message += "\n";
      message += stackText;
    }
  }

  JS_FreeValue(
      context,
      stack);

  JS_FreeValue(
      context,
      exception);

  return message;
}

bool timeReached(
    uint32_t now,
    uint32_t dueAt) {
  return
      static_cast<int32_t>(
          now - dueAt) >= 0;
}

JSValue jsHubLog(
    JSContext* ctx,
    JSValueConst,
    int argc,
    JSValueConst* argv) {
  if (!checkpoint(ctx)) {
    return interrupted(ctx);
  }

  JsSandbox* sandbox =
      sandboxFrom(
          ctx);

  String line;

  for (
      int index = 0;
      index < argc;
      ++index
  ) {
    const char* text =
        JS_ToCString(
            ctx,
            argv[index]);

    if (text) {
      if (!line.isEmpty()) {
        line += " ";
      }

      line += text;

      JS_FreeCString(
          ctx,
          text);
    }
  }

  sandbox->appendLog(
      line);

  return
      JS_UNDEFINED;
}

JSValue jsHubDelay(
    JSContext* ctx,
    JSValueConst,
    int argc,
    JSValueConst* argv) {
  if (!checkpoint(ctx)) {
    return interrupted(ctx);
  }

  if (argc < 1) {
    return
        JS_ThrowTypeError(
            ctx,
            "hub.delay(ms) requires 1 argument");
  }

  uint32_t milliseconds =
      0;

  if (
      !readUint32(
          ctx,
          argv[0],
          milliseconds)
  ) {
    return JS_EXCEPTION;
  }

  JsEngineState* engine =
      engineFrom(
          ctx);

  if (!engine) {
    return
        JS_ThrowInternalError(
            ctx,
            "Sandbox engine is unavailable");
  }

  JSValue resolvingFunctions[2] = {
    JS_UNDEFINED,
    JS_UNDEFINED,
  };

  JSValue promise =
      JS_NewPromiseCapability(
          ctx,
          resolvingFunctions);

  if (
      JS_IsException(
          promise)
  ) {
    return promise;
  }

  JsDelayTimer timer;
  timer.dueAt =
      millis() +
      milliseconds;
  timer.resolve =
      resolvingFunctions[0];
  timer.reject =
      resolvingFunctions[1];

  engine->timers.push_back(
      timer);

  return promise;
}

JSValue jsHubSetLocoFunction(
    JSContext* ctx,
    JSValueConst,
    int argc,
    JSValueConst* argv) {
  if (!checkpoint(ctx)) {
    return interrupted(ctx);
  }

  if (argc < 3) {
    return
        JS_ThrowTypeError(
            ctx,
            "hub.setLocoFunction(address, functionNumber, active) requires 3 arguments");
  }

  uint32_t address = 0;
  uint32_t functionNumber = 0;

  if (
      !readUint32(
          ctx,
          argv[0],
          address) ||
      !readUint32(
          ctx,
          argv[1],
          functionNumber)
  ) {
    return JS_EXCEPTION;
  }

  if (
      address == 0 ||
      address > 10239
  ) {
    return
        JS_ThrowRangeError(
            ctx,
            "invalid locomotive address");
  }

  if (functionNumber > 68) {
    return
        JS_ThrowRangeError(
            ctx,
            "function number must be 0..68");
  }

  JsSandbox* sandbox =
      sandboxFrom(
          ctx);

  const bool ok =
      sandbox
          ->commandSetLocoFunction(
              static_cast<uint16_t>(
                  address),
              static_cast<uint8_t>(
                  functionNumber),
              JS_ToBool(
                  ctx,
                  argv[2]));

  return
      JS_NewBool(
          ctx,
          ok);
}

JSValue jsHubSetLoco(
    JSContext* ctx,
    JSValueConst,
    int argc,
    JSValueConst* argv) {
  if (!checkpoint(ctx)) {
    return interrupted(ctx);
  }

  if (argc < 3) {
    return
        JS_ThrowTypeError(
            ctx,
            "hub.setLoco(address, speed, forward) requires 3 arguments");
  }

  uint32_t address = 0;
  uint32_t speed = 0;

  if (
      !readUint32(
          ctx,
          argv[0],
          address) ||
      !readUint32(
          ctx,
          argv[1],
          speed)
  ) {
    return JS_EXCEPTION;
  }

  if (
      address == 0 ||
      address > 10239
  ) {
    return
        JS_ThrowRangeError(
            ctx,
            "invalid locomotive address");
  }

  if (speed > 126) {
    return
        JS_ThrowRangeError(
            ctx,
            "speed must be 0..126");
  }

  JsSandbox* sandbox =
      sandboxFrom(
          ctx);

  const bool ok =
      sandbox
          ->commandSetLoco(
              static_cast<uint16_t>(
                  address),
              static_cast<uint8_t>(
                  speed),
              JS_ToBool(
                  ctx,
                  argv[2]));

  return
      JS_NewBool(
          ctx,
          ok);
}

JSValue jsHubSetTurnout(
    JSContext* ctx,
    JSValueConst,
    int argc,
    JSValueConst* argv) {
  if (!checkpoint(ctx)) {
    return interrupted(ctx);
  }

  if (argc < 2) {
    return
        JS_ThrowTypeError(
            ctx,
            "hub.setTurnout(address, closed) requires 2 arguments");
  }

  uint32_t address = 0;

  if (
      !readUint32(
          ctx,
          argv[0],
          address)
  ) {
    return JS_EXCEPTION;
  }

  JsSandbox* sandbox =
      sandboxFrom(
          ctx);

  const bool ok =
      sandbox
          ->commandSetTurnout(
              static_cast<uint16_t>(
                  address),
              JS_ToBool(
                  ctx,
                  argv[1]));

  return
      JS_NewBool(
          ctx,
          ok);
}

JSValue jsHubSetSignal(
    JSContext* ctx,
    JSValueConst,
    int argc,
    JSValueConst* argv) {
  if (!checkpoint(ctx)) {
    return interrupted(ctx);
  }

  if (argc < 2) {
    return
        JS_ThrowTypeError(
            ctx,
            "hub.setSignal(address, aspect) requires 2 arguments");
  }

  uint32_t address = 0;
  int32_t aspect = 0;

  if (
      !readUint32(
          ctx,
          argv[0],
          address) ||
      JS_ToInt32(
          ctx,
          &aspect,
          argv[1]) < 0
  ) {
    return JS_EXCEPTION;
  }

  JsSandbox* sandbox =
      sandboxFrom(
          ctx);

  const bool ok =
      sandbox
          ->commandSetSignal(
              static_cast<uint16_t>(
                  address),
              static_cast<int16_t>(
                  aspect));

  return
      JS_NewBool(
          ctx,
          ok);
}

JSValue jsHubGetSensor(
    JSContext* ctx,
    JSValueConst,
    int argc,
    JSValueConst* argv) {
  if (!checkpoint(ctx)) {
    return interrupted(ctx);
  }

  if (argc < 1) {
    return
        JS_ThrowTypeError(
            ctx,
            "hub.getSensor(address) requires 1 argument");
  }

  uint32_t address = 0;

  if (
      !readUint32(
          ctx,
          argv[0],
          address)
  ) {
    return JS_EXCEPTION;
  }

  JsSandbox* sandbox =
      sandboxFrom(
          ctx);

  return
      JS_NewBool(
          ctx,
          sandbox
              ->sensorState(
                  static_cast<uint16_t>(
                      address)));
}

int interruptHandler(
    JSRuntime*,
    void* opaque) {
  JsEngineState* engine =
      static_cast<JsEngineState*>(
          opaque);

  if (
      !engine ||
      !engine->sandbox
  ) {
    return 1;
  }

  return
      engine
          ->sandbox
          ->cooperativeCheckpoint()
          ? 0
          : 1;
}

void promiseRejectionTracker(
    JSContext* ctx,
    JSValueConst,
    JSValueConst reason,
    JS_BOOL isHandled,
    void* opaque) {
  JsEngineState* engine =
      static_cast<JsEngineState*>(
          opaque);

  if (
      !engine ||
      !engine->sandbox
  ) {
    return;
  }

  if (isHandled) {
    if (
        engine
            ->unhandledRejectionCount >
        0
    ) {
      --engine
          ->unhandledRejectionCount;
    }

    return;
  }

  ++engine
      ->unhandledRejectionCount;

  engine
      ->lastUnhandledRejection =
      valueText(
          ctx,
          reason,
          "Unhandled Promise rejection");

  engine
      ->sandbox
      ->appendLog(
          String(
              "Unhandled Promise rejection: ") +
          engine
              ->lastUnhandledRejection);
}

void installHubApi(
    JSContext* context) {
  JSValue global =
      JS_GetGlobalObject(
          context);

  JSValue hub =
      JS_NewObject(
          context);

  JS_SetPropertyStr(
      context,
      hub,
      "log",
      JS_NewCFunction(
          context,
          jsHubLog,
          "log",
          1));

  JS_SetPropertyStr(
      context,
      hub,
      "delay",
      JS_NewCFunction(
          context,
          jsHubDelay,
          "delay",
          1));

  JS_SetPropertyStr(
      context,
      hub,
      "setLocoFunction",
      JS_NewCFunction(
          context,
          jsHubSetLocoFunction,
          "setLocoFunction",
          3));

  JS_SetPropertyStr(
      context,
      hub,
      "setLoco",
      JS_NewCFunction(
          context,
          jsHubSetLoco,
          "setLoco",
          3));

  JS_SetPropertyStr(
      context,
      hub,
      "setTurnout",
      JS_NewCFunction(
          context,
          jsHubSetTurnout,
          "setTurnout",
          2));

  JS_SetPropertyStr(
      context,
      hub,
      "setSignal",
      JS_NewCFunction(
          context,
          jsHubSetSignal,
          "setSignal",
          2));

  JS_SetPropertyStr(
      context,
      hub,
      "getSensor",
      JS_NewCFunction(
          context,
          jsHubGetSensor,
          "getSensor",
          1));

  JS_SetPropertyStr(
      context,
      global,
      "hub",
      hub);

  JS_FreeValue(
      context,
      global);
}

void freeTimer(
    JSContext* context,
    JsDelayTimer& timer) {
  JS_FreeValue(
      context,
      timer.resolve);

  JS_FreeValue(
      context,
      timer.reject);

  timer.resolve =
      JS_UNDEFINED;

  timer.reject =
      JS_UNDEFINED;
}

bool processDueTimers(
    JsEngineState& engine,
    String& error) {
  const uint32_t now =
      millis();

  for (
      size_t index = 0;
      index <
          engine.timers.size();
  ) {
    JsDelayTimer& timer =
        engine.timers[index];

    if (
        !timeReached(
            now,
            timer.dueAt)
    ) {
      ++index;
      continue;
    }

    JSValue callResult =
        JS_Call(
            engine.context,
            timer.resolve,
            JS_UNDEFINED,
            0,
            nullptr);

    if (
        JS_IsException(
            callResult)
    ) {
      error =
          exceptionText(
              engine.context);

      JS_FreeValue(
          engine.context,
          callResult);

      freeTimer(
          engine.context,
          timer);

      engine.timers.erase(
          engine.timers.begin() +
          index);

      return false;
    }

    JS_FreeValue(
        engine.context,
        callResult);

    freeTimer(
        engine.context,
        timer);

    engine.timers.erase(
        engine.timers.begin() +
        index);
  }

  return true;
}

bool executePendingJobs(
    JsEngineState& engine,
    String& error) {
  while (
      JS_IsJobPending(
          engine.runtime)
  ) {
    JSContext* jobContext =
        nullptr;

    const int result =
        JS_ExecutePendingJob(
            engine.runtime,
            &jobContext);

    if (result < 0) {
      error =
          exceptionText(
              jobContext
                  ? jobContext
                  : engine.context);

      return false;
    }

    if (result == 0) {
      break;
    }
  }

  return true;
}

void freeAllTimers(
    JsEngineState& engine) {
  for (
      JsDelayTimer& timer :
      engine.timers
  ) {
    freeTimer(
        engine.context,
        timer);
  }

  engine.timers.clear();
}

}  // namespace

#endif  // HUB_JS_SANDBOX

JsSandbox::JsSandbox(
    ICommandCenter& commandCenter,
    LayoutRuntime& runtime)
    : _commandCenter(commandCenter),
      _runtime(runtime) {}

bool JsSandbox::begin() {
#if !HUB_JS_SANDBOX
  return false;
#else
  if (!_mutex) {
    _mutex =
        xSemaphoreCreateMutex();
  }

  return
      _mutex != nullptr;
#endif
}

bool JsSandbox::start(
    const String& source,
    String& error) {
#if !HUB_JS_SANDBOX
  (void)source;
  error = "JavaScript Sandbox is disabled at build time";
  return false;
#else
  if (!begin()) {
    error = "Could not create Sandbox mutex";
    return false;
  }

  if (
      source.isEmpty() ||
      source.length() >
          MAX_SOURCE_BYTES
  ) {
    error =
        source.isEmpty()
            ? "Script is empty"
            : "Script exceeds the 32 KB Sandbox limit";
    return false;
  }

  const JsSandboxState current =
      _state;

  if (
      current == JsSandboxState::Running ||
      current == JsSandboxState::Paused ||
      current == JsSandboxState::Stopping ||
      current == JsSandboxState::Aborting
  ) {
    error =
        "A Sandbox script is already active";
    return false;
  }

  if (lock()) {
    _source = source;
    _lastError = "";
    _log = "";
    _startedAtMs = millis();
    _finishedAtMs = 0;

    // Baseline is captured immediately before QuickJS worker creation.
    // The deltas are system-level changes since Start, so they include
    // QuickJS plus any other allocations happening while the script runs.
    _baselineFreeHeap = ESP.getFreeHeap();
    _baselineFreePsram = ESP.getFreePsram();

    _pauseRequested = false;
    _stopRequested = false;
    _abortRequested = false;
    _state = JsSandboxState::Running;
    unlock();
  }

  BaseType_t result =
      xTaskCreatePinnedToCore(
          taskEntry,
          "hub-js-sandbox",
          TASK_STACK_BYTES,
          this,
          1,
          &_task,
          tskNO_AFFINITY);

  if (result != pdPASS) {
    _task = nullptr;
    setState(
        JsSandboxState::Error);

    error =
        "Could not create JavaScript worker task";

    if (lock()) {
      _lastError = error;
      _finishedAtMs = millis();
      unlock();
    }

    return false;
  }

  appendLog(
      "Sandbox started");

  return true;
#endif
}

bool JsSandbox::pause(
    String& error) {
#if !HUB_JS_SANDBOX
  error = "JavaScript Sandbox is disabled at build time";
  return false;
#else
  if (_state != JsSandboxState::Running) {
    error = "Sandbox is not running";
    return false;
  }

  _pauseRequested = true;
  return true;
#endif
}

bool JsSandbox::resume(
    String& error) {
#if !HUB_JS_SANDBOX
  error = "JavaScript Sandbox is disabled at build time";
  return false;
#else
  if (
      _state != JsSandboxState::Paused &&
      !_pauseRequested
  ) {
    error = "Sandbox is not paused";
    return false;
  }

  _pauseRequested = false;
  setState(
      JsSandboxState::Running);

  appendLog(
      "Sandbox resumed");

  return true;
#endif
}

bool JsSandbox::stop(
    String& error) {
#if !HUB_JS_SANDBOX
  error = "JavaScript Sandbox is disabled at build time";
  return false;
#else
  const JsSandboxState current =
      _state;

  if (
      current != JsSandboxState::Running &&
      current != JsSandboxState::Paused
  ) {
    error = "Sandbox is not active";
    return false;
  }

  _stopRequested = true;
  _pauseRequested = false;
  setState(
      JsSandboxState::Stopping);

  appendLog(
      "Stop requested");

  return true;
#endif
}

bool JsSandbox::abort(
    String& error) {
#if !HUB_JS_SANDBOX
  error = "JavaScript Sandbox is disabled at build time";
  return false;
#else
  const JsSandboxState current =
      _state;

  if (
      current != JsSandboxState::Running &&
      current != JsSandboxState::Paused &&
      current != JsSandboxState::Stopping
  ) {
    error = "Sandbox is not active";
    return false;
  }

  _abortRequested = true;
  _pauseRequested = false;
  setState(
      JsSandboxState::Aborting);

  appendLog(
      "ABORT requested");

  return true;
#endif
}

JsSandboxSnapshot JsSandbox::snapshot() {
  JsSandboxSnapshot result;

#if HUB_JS_SANDBOX
  if (lock()) {
    result.state = _state;
    result.stateText =
        stateText(
            _state);
    result.lastError =
        _lastError;
    result.log =
        _log;
    result.startedAtMs =
        _startedAtMs;
    result.finishedAtMs =
        _finishedAtMs;
    unlock();
  }
#endif

  result.totalHeap =
      ESP.getHeapSize();

  result.freeHeap =
      ESP.getFreeHeap();

  result.minFreeHeap =
      ESP.getMinFreeHeap();

  result.largestFreeHeapBlock =
      ESP.getMaxAllocHeap();

  result.totalPsram =
      ESP.getPsramSize();

  result.freePsram =
      ESP.getFreePsram();

  result.minFreePsram =
      ESP.getMinFreePsram();

  result.largestFreePsramBlock =
      ESP.getMaxAllocPsram();

#if HUB_JS_SANDBOX
  result.baselineFreeHeap =
      _baselineFreeHeap;

  result.baselineFreePsram =
      _baselineFreePsram;

  result.heapDeltaSinceStart =
      static_cast<int32_t>(
          _baselineFreeHeap) -
      static_cast<int32_t>(
          result.freeHeap);

  result.psramDeltaSinceStart =
      static_cast<int32_t>(
          _baselineFreePsram) -
      static_cast<int32_t>(
          result.freePsram);

  result.sourceBytes =
      static_cast<uint32_t>(
          _source.length());

  result.vmMemoryLimitBytes =
      VM_MEMORY_LIMIT_BYTES;

  result.taskStackBytes =
      TASK_STACK_BYTES;
#endif

  return result;
}

bool JsSandbox::commandSetLocoFunction(
    uint16_t address,
    uint8_t functionNumber,
    bool active) {
  return
      _commandCenter
          .setLocoFunction(
              address,
              functionNumber,
              active);
}

bool JsSandbox::commandSetLoco(
    uint16_t address,
    uint8_t speed,
    bool forward) {
  return
      _commandCenter
          .setLoco(
              address,
              speed,
              forward);
}

bool JsSandbox::commandSetTurnout(
    uint16_t address,
    bool closed) {
  return
      _commandCenter
          .setTurnout(
              address,
              closed);
}

bool JsSandbox::commandSetSignal(
    uint16_t address,
    int16_t aspect) {
  return
      _commandCenter
          .setSignalAspect(
              address,
              aspect);
}

bool JsSandbox::sensorState(
    uint16_t address) {
  RuntimeSensor* sensor =
      _runtime
          .findSensor(
              address);

  return
      sensor &&
      sensor->on;
}

void JsSandbox::appendLog(
    const String& line) {
#if HUB_JS_SANDBOX
  Logger::info(
      "[JS] " +
      line);

  if (!lock()) {
    return;
  }

  if (!_log.isEmpty()) {
    _log += "\n";
  }

  _log +=
      line;

  if (
      _log.length() >
      MAX_LOG_BYTES
  ) {
    _log.remove(
        0,
        _log.length() -
            MAX_LOG_BYTES);
  }

  unlock();
#else
  (void)line;
#endif
}

bool JsSandbox::cooperativeCheckpoint() {
#if !HUB_JS_SANDBOX
  return false;
#else
  if (
      _abortRequested ||
      _stopRequested
  ) {
    return false;
  }

  if (_pauseRequested) {
    setState(
        JsSandboxState::Paused);

    while (
        _pauseRequested &&
        !_abortRequested &&
        !_stopRequested
    ) {
      vTaskDelay(
          pdMS_TO_TICKS(20));
    }

    if (
        _abortRequested ||
        _stopRequested
    ) {
      return false;
    }

    setState(
        JsSandboxState::Running);
  }

  return true;
#endif
}

#if HUB_JS_SANDBOX

void JsSandbox::taskEntry(
    void* argument) {
  JsSandbox* sandbox =
      static_cast<JsSandbox*>(
          argument);

  sandbox->runWorker();

  sandbox->_task =
      nullptr;

  vTaskDelete(
      nullptr);
}

void JsSandbox::runWorker() {
  String source;

  if (lock()) {
    source = _source;
    unlock();
  }

  JSRuntime* runtime =
      JS_NewRuntime();

  if (!runtime) {
    if (lock()) {
      _lastError =
          "JS_NewRuntime failed";
      _finishedAtMs =
          millis();
      _state =
          JsSandboxState::Error;
      unlock();
    }

    return;
  }

  JS_SetMemoryLimit(
      runtime,
      VM_MEMORY_LIMIT_BYTES);

  JS_SetGCThreshold(
      runtime,
      64U * 1024U);

  JsEngineState engine;
  engine.sandbox =
      this;
  engine.runtime =
      runtime;

  JS_SetInterruptHandler(
      runtime,
      interruptHandler,
      &engine);

  JS_SetHostPromiseRejectionTracker(
      runtime,
      promiseRejectionTracker,
      &engine);

  JSContext* context =
      JS_NewContext(
          runtime);

  if (!context) {
    JS_FreeRuntime(
        runtime);

    if (lock()) {
      _lastError =
          "JS_NewContext failed";
      _finishedAtMs =
          millis();
      _state =
          JsSandboxState::Error;
      unlock();
    }

    return;
  }

  engine.context =
      context;

  JS_SetContextOpaque(
      context,
      &engine);

  installHubApi(
      context);

  JSValue evalResult =
      JS_Eval(
          context,
          source.c_str(),
          source.length(),
          "<sandbox>",
          JS_EVAL_TYPE_GLOBAL);

  String error;

  bool executionFailed =
      JS_IsException(
          evalResult);

  if (executionFailed) {
    error =
        exceptionText(
            context);
  }

  JS_FreeValue(
      context,
      evalResult);

  while (
      !executionFailed &&
      !_stopRequested &&
      !_abortRequested
  ) {
    if (!cooperativeCheckpoint()) {
      break;
    }

    if (
        !processDueTimers(
            engine,
            error)
    ) {
      executionFailed =
          true;

      break;
    }

    if (
        !executePendingJobs(
            engine,
            error)
    ) {
      executionFailed =
          true;

      break;
    }

    if (
        engine.timers.empty() &&
        !JS_IsJobPending(
            runtime)
    ) {
      break;
    }

    vTaskDelay(
        pdMS_TO_TICKS(1));
  }

  freeAllTimers(
      engine);

  JS_RunGC(
      runtime);

  JS_FreeContext(
      context);

  JS_FreeRuntime(
      runtime);

  JsSandboxState finalState =
      JsSandboxState::Completed;

  if (_abortRequested) {
    finalState =
        JsSandboxState::Aborted;
  } else if (_stopRequested) {
    finalState =
        JsSandboxState::Stopped;
  } else if (executionFailed) {
    finalState =
        JsSandboxState::Error;
  } else if (
      engine
          .unhandledRejectionCount >
      0
  ) {
    finalState =
        JsSandboxState::Error;

    error =
        engine
            .lastUnhandledRejection
            .isEmpty()
            ? "Unhandled Promise rejection"
            : engine
                  .lastUnhandledRejection;
  }

  if (lock()) {
    _lastError =
        finalState ==
                JsSandboxState::Error
            ? error
            : "";

    _finishedAtMs =
        millis();

    _state =
        finalState;

    _pauseRequested = false;
    _stopRequested = false;
    _abortRequested = false;

    unlock();
  }

  switch (finalState) {
    case JsSandboxState::Completed:
      appendLog(
          "Sandbox completed");
      break;

    case JsSandboxState::Stopped:
      appendLog(
          "Sandbox stopped");
      break;

    case JsSandboxState::Aborted:
      appendLog(
          "Sandbox aborted");
      break;

    case JsSandboxState::Error:
      appendLog(
          "ERROR: " +
          error);
      break;

    default:
      break;
  }
}

bool JsSandbox::lock(
    TickType_t timeout) {
  return
      _mutex &&
      xSemaphoreTake(
          _mutex,
          timeout) == pdTRUE;
}

void JsSandbox::unlock() {
  if (_mutex) {
    xSemaphoreGive(
        _mutex);
  }
}

void JsSandbox::setState(
    JsSandboxState state) {
  _state =
      state;
}

const char* JsSandbox::stateText(
    JsSandboxState state) {
  switch (state) {
    case JsSandboxState::Idle:
      return "idle";
    case JsSandboxState::Running:
      return "running";
    case JsSandboxState::Paused:
      return "paused";
    case JsSandboxState::Stopping:
      return "stopping";
    case JsSandboxState::Aborting:
      return "aborting";
    case JsSandboxState::Completed:
      return "completed";
    case JsSandboxState::Stopped:
      return "stopped";
    case JsSandboxState::Aborted:
      return "aborted";
    case JsSandboxState::Error:
      return "error";
    default:
      return "unknown";
  }
}

#endif
