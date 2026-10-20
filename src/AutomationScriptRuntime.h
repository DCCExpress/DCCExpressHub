#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>

#include <memory>
#include <vector>

#include "ICommandCenter.h"
#include "JsSandbox.h"
#include "LayoutRuntime.h"

class AutomationScriptRuntime {
public:
  AutomationScriptRuntime(
      ICommandCenter& commandCenter,
      LayoutRuntime& runtime);

  bool begin();
  void loop();

  bool startSource(
      const String& executionId,
      const String& name,
      const String& executionType,
      const String& source,
      String& error);

  bool startSaved(
      const String& scriptId,
      const String& executionId,
      const String& executionType,
      String& error);

  bool pause(
      const String& executionId,
      String& error);

  bool resume(
      const String& executionId,
      String& error);

  bool abort(
      const String& executionId,
      String& error);

  size_t startAllSaved();
  size_t pauseAll();
  size_t resumeAll();
  size_t abortAll();
  size_t pauseAllSaved();
  size_t resumeAllSaved();
  size_t abortAllSaved();

  bool setFinishing(
      bool finishing);

  bool finishing() const {
    return _finishing;
  }

  void appendState(
      const String& executionId,
      JsonObject out);

  void appendSnapshot(
      JsonObject out);

  bool takeChanged();

private:
  static constexpr const char* AUTOMATIONS_PATH =
      "/config/automations.json";

  // QuickJS is intentionally bounded on the MCU. The S3 build has PSRAM,
  // but every sandbox also owns a worker stack and VM heap.
  static constexpr size_t MAX_CONCURRENT_EXECUTIONS = 4;

  struct Execution {
    Execution(
        ICommandCenter& commandCenter,
        LayoutRuntime& runtime)
        : sandbox(
              commandCenter,
              runtime) {}

    JsSandbox sandbox;
    String executionId;
    String scriptId;
    String name;
    String executionType = "script";

    JsSandboxState lastState =
        JsSandboxState::Idle;

    String lastError;
    String lastLog;
  };

  struct SavedScript {
    String id;
    String name;
    String source;
    bool startWithAll = false;
  };

  ICommandCenter& _commandCenter;
  LayoutRuntime& _runtime;

  std::vector<
      std::unique_ptr<Execution>>
      _executions;

  bool _finishing = false;
  bool _changed = true;
  uint32_t _sequence = 0;

  String nextExecutionId(
      const String& scriptId);

  Execution* findExecution(
      const String& executionId);

  const Execution* findExecution(
      const String& executionId) const;

  bool isActive(
      const Execution& execution) const;

  bool ensureCapacity(
      const String& executionId,
      String& error);

  bool loadSavedScripts(
      std::vector<SavedScript>& scripts,
      String& error);

  bool loadSavedScript(
      const String& scriptId,
      SavedScript& script,
      String& error);

  static const char* normalizeState(
      JsSandboxState state);
};
