#include "AutomationScriptRuntime.h"

#include "Logger.h"

AutomationScriptRuntime::AutomationScriptRuntime(
    ICommandCenter& commandCenter,
    LayoutRuntime& runtime)
    : _sandbox(
          commandCenter,
          runtime) {}

bool AutomationScriptRuntime::begin() {
  const bool ok =
      _sandbox.begin();

  _lastState =
      _sandbox.snapshot().state;

  _changed = true;

  Logger::info(
      String("AutomationScriptRuntime: ") +
      (ok ? "ready" : "sandbox unavailable"));

  return ok;
}

const char* AutomationScriptRuntime::normalizeState(
    JsSandboxState state) {
  switch (state) {
    case JsSandboxState::Running:
    case JsSandboxState::Stopping:
    case JsSandboxState::Aborting:
      return "running";

    case JsSandboxState::Paused:
      return "paused";

    case JsSandboxState::Error:
      return "error";

    default:
      return "idle";
  }
}

void AutomationScriptRuntime::loop() {
  const JsSandboxSnapshot snapshot =
      _sandbox.snapshot();

  if (
      snapshot.state != _lastState ||
      snapshot.lastError != _lastError ||
      snapshot.log != _lastLog
  ) {
    _lastState =
        snapshot.state;
    _lastError =
        snapshot.lastError;
    _lastLog =
        snapshot.log;
    _changed =
        true;
  }
}

String AutomationScriptRuntime::nextExecutionId(
    const String& scriptId) {
  ++_sequence;

  return
      "esp32-" +
      (scriptId.isEmpty()
           ? String("source")
           : scriptId) +
      "-" +
      String(millis()) +
      "-" +
      String(_sequence);
}

bool AutomationScriptRuntime::startSource(
    const String& executionId,
    const String& name,
    const String& executionType,
    const String& source,
    String& error) {
  if (_finishing) {
    error =
        "script_runtime_finishing";
    return false;
  }

  const JsSandboxSnapshot current =
      _sandbox.snapshot();

  if (
      current.state == JsSandboxState::Running ||
      current.state == JsSandboxState::Paused ||
      current.state == JsSandboxState::Stopping ||
      current.state == JsSandboxState::Aborting
  ) {
    error =
        "script_runtime_busy";
    return false;
  }

  _executionId =
      executionId.isEmpty()
          ? nextExecutionId("")
          : executionId;

  _scriptId = "";
  _name =
      name.isEmpty()
          ? "Script"
          : name;
  _executionType =
      executionType.isEmpty()
          ? "script"
          : executionType;

  if (!_sandbox.start(
          source,
          error)) {
    _executionId = "";
    _name = "";
    _executionType =
        "script";
    _changed =
        true;
    return false;
  }

  _changed =
      true;

  return true;
}

bool AutomationScriptRuntime::loadSavedScript(
    const String& scriptId,
    String& name,
    String& source,
    String& error) {
  File file =
      LittleFS.open(
          AUTOMATIONS_PATH,
          "r");

  if (!file) {
    error =
        "automation_storage_not_found";
    return false;
  }

  JsonDocument document;

  const DeserializationError parseError =
      deserializeJson(
          document,
          file);

  file.close();

  if (parseError) {
    error =
        "automation_storage_invalid";
    return false;
  }

  JsonArrayConst scripts =
      document["scripts"]
          .as<JsonArrayConst>();

  for (
      JsonObjectConst script :
      scripts
  ) {
    const String id =
        script["id"] |
        "";

    if (id != scriptId) {
      continue;
    }

    name =
        script["name"] |
        "Script";

    source =
        script["script"] |
        "";

    if (source.isEmpty()) {
      error =
          "script_source_empty";
      return false;
    }

    return true;
  }

  error =
      "script_not_found";
  return false;
}

bool AutomationScriptRuntime::startSaved(
    const String& scriptId,
    const String& executionId,
    const String& executionType,
    String& error) {
  if (scriptId.isEmpty()) {
    error =
        "script_id_required";
    return false;
  }

  String name;
  String source;

  if (!loadSavedScript(
          scriptId,
          name,
          source,
          error)) {
    return false;
  }

  const String resolvedExecutionId =
      executionId.isEmpty()
          ? nextExecutionId(
                scriptId)
          : executionId;

  if (!startSource(
          resolvedExecutionId,
          name,
          executionType.isEmpty()
              ? String("saved")
              : executionType,
          source,
          error)) {
    return false;
  }

  _scriptId =
      scriptId;
  _changed =
      true;

  return true;
}

bool AutomationScriptRuntime::matchesExecution(
    const String& executionId) const {
  return
      executionId.isEmpty() ||
      executionId ==
          _executionId;
}

bool AutomationScriptRuntime::pause(
    const String& executionId,
    String& error) {
  if (!matchesExecution(
          executionId)) {
    error =
        "script_not_running";
    return false;
  }

  const bool ok =
      _sandbox.pause(
          error);

  if (ok) {
    _changed =
        true;
  }

  return ok;
}

bool AutomationScriptRuntime::resume(
    const String& executionId,
    String& error) {
  if (!matchesExecution(
          executionId)) {
    error =
        "script_not_paused";
    return false;
  }

  const bool ok =
      _sandbox.resume(
          error);

  if (ok) {
    _changed =
        true;
  }

  return ok;
}

bool AutomationScriptRuntime::abort(
    const String& executionId,
    String& error) {
  if (!matchesExecution(
          executionId)) {
    error =
        "script_not_running";
    return false;
  }

  const bool ok =
      _sandbox.abort(
          error);

  if (ok) {
    _changed =
        true;
  }

  return ok;
}

bool AutomationScriptRuntime::setFinishing(
    bool finishing) {
  if (_finishing ==
      finishing) {
    return false;
  }

  _finishing =
      finishing;
  _changed =
      true;

  return true;
}

void AutomationScriptRuntime::appendState(
    JsonObject out) {
  const JsSandboxSnapshot snapshot =
      _sandbox.snapshot();

  out["executionId"] =
      _executionId;
  out["scriptId"] =
      _scriptId.isEmpty()
          ? nullptr
          : _scriptId.c_str();
  out["name"] =
      _name;
  out["type"] =
      _executionType;
  out["status"] =
      normalizeState(
          snapshot.state);

  if (snapshot.startedAtMs > 0) {
    out["startedAt"] =
        snapshot.startedAtMs;
  } else {
    out["startedAt"] =
        nullptr;
  }

  if (snapshot.finishedAtMs > 0) {
    out["stoppedAt"] =
        snapshot.finishedAtMs;
  } else {
    out["stoppedAt"] =
        nullptr;
  }

  out["info"] =
      nullptr;

  if (snapshot.lastError.isEmpty()) {
    out["error"] =
        nullptr;
  } else {
    out["error"] =
        snapshot.lastError;
  }
}

void AutomationScriptRuntime::appendSnapshot(
    JsonObject out) {
  JsonArray states =
      out["states"]
          .to<JsonArray>();

  if (!_executionId.isEmpty()) {
    appendState(
        states
            .add<JsonObject>());
  }

  out["finishing"] =
      _finishing;
}

bool AutomationScriptRuntime::takeChanged() {
  const bool changed =
      _changed;

  _changed =
      false;

  return changed;
}
