#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <vector>

#include "ICommandCenter.h"
#include "LayoutRuntime.h"

class SignalAutomationEngine {
public:
  SignalAutomationEngine(
      ICommandCenter& commandCenter,
      LayoutRuntime& runtime,
      AsyncWebSocket& ws);

  bool begin(
      fs::FS& fs,
      const char* path =
          "/config/signal-logic.ndjson");

  bool reload();

  // Validates a candidate rule file with the exact same parser and semantic
  // rules that reload() uses, without changing the currently active rules.
  bool validateFile(
      const char* path);

  void evaluate();

private:
  struct Condition {
    enum class Source : uint8_t {
      Turnout,
      Sensor
    };

    Source source =
        Source::Turnout;

    uint16_t id = 0;
    uint8_t channel = 0;
    bool value = false;
  };

  struct Rule {
    // int32_t is deliberate: a 16-output basic signal may use 0..65535.
    int32_t value = 0;

    std::vector<Condition>
        conditions;
  };

  struct SignalRuleSet {
    uint16_t signalId = 0;
    bool extended = true;
    uint8_t outputs = 1;

    // int32_t avoids overflow for 16-bit basic output masks.
    int32_t defaultValue = 0;

    std::vector<Rule>
        rules;

    bool hasAppliedValue = false;
    int32_t appliedValue = 0;
  };

  ICommandCenter& _commandCenter;
  LayoutRuntime& _runtime;
  AsyncWebSocket& _ws;

  fs::FS* _fs = nullptr;

  String _path =
      "/config/signal-logic.ndjson";

  bool _enabled = false;
  bool _evaluating = false;

  std::vector<SignalRuleSet>
      _signals;

  bool parseFile(
      const char* path,
      bool& enabled,
      std::vector<SignalRuleSet>& signals) const;

  bool parseSignal(
      JsonObjectConst row,
      std::vector<SignalRuleSet>& signals) const;

  bool conditionMatches(
      const Condition& condition) const;

  int32_t desiredValue(
      const SignalRuleSet& signal) const;

  void applySignal(
      SignalRuleSet& signal,
      int32_t value);

  void broadcastExtended(
      uint16_t address,
      int16_t aspect);

  void broadcastBasic(
      uint16_t address,
      uint8_t outputs,
      uint16_t bits);

  void handleRuntimeChange(
      RuntimeChangeKind kind,
      uint16_t id,
      uint8_t channel);
};
