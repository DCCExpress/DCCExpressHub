#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>

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

  bool setFinishing(
      bool finishing);

  bool finishing() const {
    return _finishing;
  }

  void appendState(
      JsonObject out);

  void appendSnapshot(
      JsonObject out);

  bool takeChanged();

private:
  static constexpr const char* AUTOMATIONS_PATH =
      "/config/automations.json";

  JsSandbox _sandbox;

  String _executionId;
  String _scriptId;
  String _name;
  String _executionType = "script";

  bool _finishing = false;
  bool _changed = true;

  JsSandboxState _lastState =
      JsSandboxState::Idle;

  String _lastError;
  String _lastLog;

  uint32_t _sequence = 0;

  String nextExecutionId(
      const String& scriptId);

  bool loadSavedScript(
      const String& scriptId,
      String& name,
      String& source,
      String& error);

  static const char* normalizeState(
      JsSandboxState state);

  bool matchesExecution(
      const String& executionId) const;
};
