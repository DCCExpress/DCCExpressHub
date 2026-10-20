#include "AutomationScriptRuntime.h"

#include "Logger.h"
#include "FileStore.h"

AutomationScriptRuntime::AutomationScriptRuntime(
    ICommandCenter& commandCenter,
    LayoutRuntime& runtime)
    : _commandCenter(commandCenter),
      _runtime(runtime) {}

bool AutomationScriptRuntime::begin() {
  _changed = true;

  Logger::info(
      "AutomationScriptRuntime: ready");

  return true;
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

bool AutomationScriptRuntime::isActive(
    const Execution& execution) const {
  switch (
      execution.lastState
  ) {
    case JsSandboxState::Running:
    case JsSandboxState::Paused:
    case JsSandboxState::Stopping:
    case JsSandboxState::Aborting:
      return true;

    default:
      return false;
  }
}

AutomationScriptRuntime::Execution*
AutomationScriptRuntime::findExecution(
    const String& executionId) {
  for (
      auto& execution :
      _executions
  ) {
    if (
        execution &&
        execution->executionId ==
            executionId
    ) {
      return
          execution.get();
    }
  }

  return nullptr;
}

const AutomationScriptRuntime::Execution*
AutomationScriptRuntime::findExecution(
    const String& executionId) const {
  for (
      const auto& execution :
      _executions
  ) {
    if (
        execution &&
        execution->executionId ==
            executionId
    ) {
      return
          execution.get();
    }
  }

  return nullptr;
}

void AutomationScriptRuntime::loop() {
  for (
      auto& execution :
      _executions
  ) {
    if (!execution) {
      continue;
    }

    const JsSandboxSnapshot snapshot =
        execution->sandbox.snapshot();

    if (
        snapshot.state !=
            execution->lastState ||
        snapshot.lastError !=
            execution->lastError ||
        snapshot.log !=
            execution->lastLog
    ) {
      execution->lastState =
          snapshot.state;
      execution->lastError =
          snapshot.lastError;
      execution->lastLog =
          snapshot.log;
      _changed =
          true;
    }
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

bool AutomationScriptRuntime::ensureCapacity(
    const String& executionId,
    String& error) {
  Execution* existing =
      findExecution(
          executionId);

  if (existing) {
    const JsSandboxSnapshot snapshot =
        existing->sandbox.snapshot();

    existing->lastState =
        snapshot.state;

    if (isActive(
            *existing)) {
      error =
          "script_already_running";
      return false;
    }

    for (
        auto iterator =
            _executions.begin();
        iterator !=
            _executions.end();
        ++iterator
    ) {
      if (
          iterator->get() ==
          existing
      ) {
        _executions.erase(
            iterator);
        break;
      }
    }
  }

  size_t activeCount =
      0;

  for (
      auto& execution :
      _executions
  ) {
    if (!execution) {
      continue;
    }

    const JsSandboxSnapshot snapshot =
        execution->sandbox.snapshot();

    execution->lastState =
        snapshot.state;

    if (isActive(
            *execution)) {
      ++activeCount;
    }
  }

  if (
      activeCount >=
      MAX_CONCURRENT_EXECUTIONS
  ) {
    error =
        "script_runtime_capacity";
    return false;
  }

  return true;
}

bool AutomationScriptRuntime::startSource(
    const String& requestedExecutionId,
    const String& name,
    const String& executionType,
    const String& source,
    String& error) {
  if (_finishing) {
    error =
        "script_runtime_finishing";
    return false;
  }

  const String executionId =
      requestedExecutionId.isEmpty()
          ? nextExecutionId("")
          : requestedExecutionId;

  if (!ensureCapacity(
          executionId,
          error)) {
    return false;
  }

  std::unique_ptr<Execution> execution(
      new Execution(
          _commandCenter,
          _runtime));

  if (!execution) {
    error =
        "script_runtime_allocation_failed";
    return false;
  }

  if (!execution->sandbox.begin()) {
    error =
        "script_sandbox_unavailable";
    return false;
  }

  execution->executionId =
      executionId;
  execution->name =
      name.isEmpty()
          ? "Script"
          : name;
  execution->executionType =
      executionType.isEmpty()
          ? "script"
          : executionType;

  if (!execution->sandbox.start(
          source,
          error)) {
    return false;
  }

  const JsSandboxSnapshot snapshot =
      execution->sandbox.snapshot();

  execution->lastState =
      snapshot.state;
  execution->lastError =
      snapshot.lastError;
  execution->lastLog =
      snapshot.log;

  _executions.push_back(
      std::move(
          execution));

  _changed =
      true;

  return true;
}

bool AutomationScriptRuntime::loadSavedScripts(
    std::vector<SavedScript>& scripts,
    String& error) {
  scripts.clear();

  FileStore files(
      LittleFS);

  if (
      !files.exists(
          AUTOMATIONS_PATH)
  ) {
    return true;
  }

  File file =
      LittleFS.open(
          AUTOMATIONS_PATH,
          "r");

  if (!file) {
    error =
        "automation_storage_open_failed";
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

  JsonArrayConst sourceScripts =
      document["scripts"]
          .as<JsonArrayConst>();

  for (
      JsonObjectConst source :
      sourceScripts
  ) {
    SavedScript script;

    script.id =
        source["id"] |
        "";
    script.name =
        source["name"] |
        "Script";
    script.source =
        source["script"] |
        "";
    script.startWithAll =
        source["includeWithStartAll"] |
        false;

    if (
        script.id.isEmpty() ||
        script.source.isEmpty()
    ) {
      continue;
    }

    scripts.push_back(
        std::move(
            script));
  }

  return true;
}

bool AutomationScriptRuntime::loadSavedScript(
    const String& scriptId,
    SavedScript& script,
    String& error) {
  std::vector<SavedScript> scripts;

  if (!loadSavedScripts(
          scripts,
          error)) {
    return false;
  }

  for (
      auto& candidate :
      scripts
  ) {
    if (
        candidate.id ==
        scriptId
    ) {
      script =
          std::move(
              candidate);
      return true;
    }
  }

  error =
      "script_not_found";
  return false;
}

bool AutomationScriptRuntime::startSaved(
    const String& scriptId,
    const String& requestedExecutionId,
    const String& executionType,
    String& error) {
  if (scriptId.isEmpty()) {
    error =
        "script_id_required";
    return false;
  }

  SavedScript script;

  if (!loadSavedScript(
          scriptId,
          script,
          error)) {
    return false;
  }

  const String executionId =
      requestedExecutionId.isEmpty()
          ? nextExecutionId(
                scriptId)
          : requestedExecutionId;

  if (!startSource(
          executionId,
          script.name,
          executionType.isEmpty()
              ? String("saved")
              : executionType,
          script.source,
          error)) {
    return false;
  }

  Execution* execution =
      findExecution(
          executionId);

  if (execution) {
    execution->scriptId =
        scriptId;
  }

  _changed =
      true;

  return true;
}

bool AutomationScriptRuntime::pause(
    const String& executionId,
    String& error) {
  Execution* execution =
      findExecution(
          executionId);

  if (!execution) {
    error =
        "script_not_running";
    return false;
  }

  const bool ok =
      execution->sandbox.pause(
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
  Execution* execution =
      findExecution(
          executionId);

  if (!execution) {
    error =
        "script_not_paused";
    return false;
  }

  const bool ok =
      execution->sandbox.resume(
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
  Execution* execution =
      findExecution(
          executionId);

  if (!execution) {
    error =
        "script_not_running";
    return false;
  }

  const bool ok =
      execution->sandbox.abort(
          error);

  if (ok) {
    _changed =
        true;
  }

  return ok;
}

size_t AutomationScriptRuntime::pauseAll() {
  size_t count =
      0;

  for (
      auto& execution :
      _executions
  ) {
    if (!execution) {
      continue;
    }

    String error;

    if (execution->sandbox.pause(
            error)) {
      ++count;
    }
  }

  if (count > 0) {
    _changed =
        true;
  }

  return count;
}

size_t AutomationScriptRuntime::resumeAll() {
  size_t count =
      0;

  for (
      auto& execution :
      _executions
  ) {
    if (!execution) {
      continue;
    }

    String error;

    if (execution->sandbox.resume(
            error)) {
      ++count;
    }
  }

  if (count > 0) {
    _changed =
        true;
  }

  return count;
}

size_t AutomationScriptRuntime::abortAll() {
  size_t count =
      0;

  for (
      auto& execution :
      _executions
  ) {
    if (!execution) {
      continue;
    }

    String error;

    if (execution->sandbox.abort(
            error)) {
      ++count;
    }
  }

  if (count > 0) {
    _changed =
        true;
  }

  return count;
}

size_t AutomationScriptRuntime::startAllSaved() {
  if (_finishing) {
    return 0;
  }

  std::vector<SavedScript> scripts;
  String error;

  if (!loadSavedScripts(
          scripts,
          error)) {
    Logger::warn(
        "Start All scripts failed: " +
        error);
    return 0;
  }

  size_t count =
      0;

  for (
      const auto& script :
      scripts
  ) {
    if (!script.startWithAll) {
      continue;
    }

    const String executionId =
        "automation:" +
        script.id;

    String startError;

    if (startSource(
            executionId,
            script.name,
            "automation",
            script.source,
            startError)) {
      Execution* execution =
          findExecution(
              executionId);

      if (execution) {
        execution->scriptId =
            script.id;
      }

      ++count;
    } else if (
        startError !=
        "script_already_running"
    ) {
      Logger::warn(
          "Start All skipped " +
          script.id +
          ": " +
          startError);
    }
  }

  return count;
}

size_t AutomationScriptRuntime::pauseAllSaved() {
  size_t count =
      0;

  for (
      auto& execution :
      _executions
  ) {
    if (
        !execution ||
        execution->executionType !=
            "automation"
    ) {
      continue;
    }

    String error;

    if (execution->sandbox.pause(
            error)) {
      ++count;
    }
  }

  if (count > 0) {
    _changed =
        true;
  }

  return count;
}

size_t AutomationScriptRuntime::resumeAllSaved() {
  size_t count =
      0;

  for (
      auto& execution :
      _executions
  ) {
    if (
        !execution ||
        execution->executionType !=
            "automation"
    ) {
      continue;
    }

    String error;

    if (execution->sandbox.resume(
            error)) {
      ++count;
    }
  }

  if (count > 0) {
    _changed =
        true;
  }

  return count;
}

size_t AutomationScriptRuntime::abortAllSaved() {
  size_t count =
      0;

  for (
      auto& execution :
      _executions
  ) {
    if (
        !execution ||
        execution->executionType !=
            "automation"
    ) {
      continue;
    }

    String error;

    if (execution->sandbox.abort(
            error)) {
      ++count;
    }
  }

  if (count > 0) {
    _changed =
        true;
  }

  return count;
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
    const String& executionId,
    JsonObject out) {
  Execution* execution =
      findExecution(
          executionId);

  if (!execution) {
    return;
  }

  const JsSandboxSnapshot snapshot =
      execution->sandbox.snapshot();

  execution->lastState =
      snapshot.state;

  out["executionId"] =
      execution->executionId;

  if (execution->scriptId.isEmpty()) {
    out["scriptId"] =
        nullptr;
  } else {
    out["scriptId"] =
        execution->scriptId;
  }

  out["name"] =
      execution->name;
  out["type"] =
      execution->executionType;
  out["status"] =
      normalizeState(
          snapshot.state);

  out["startedAt"] =
      snapshot.startedAtMs > 0
          ? snapshot.startedAtMs
          : 0;

  out["stoppedAt"] =
      snapshot.finishedAtMs > 0
          ? snapshot.finishedAtMs
          : 0;

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

  for (
      auto& execution :
      _executions
  ) {
    if (!execution) {
      continue;
    }

    appendState(
        execution->executionId,
        states.add<JsonObject>());
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
