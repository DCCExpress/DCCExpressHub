#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <vector>

#include "DccExBridge.h"
#include "LayoutRuntime.h"

class SignalAutomationEngine {
public:
  SignalAutomationEngine(
      DccExBridge& dcc,
      LayoutRuntime& runtime,
      AsyncWebSocket& ws);

  bool begin(
      fs::FS& fs,
      const char* path =
          "/config/signal-logic.ndjson");

  bool reload();
  void evaluate();

private:
  struct Condition {
    enum class Source : uint8_t {
      Turnout,
      Sensor
    };

    Source source = Source::Turnout;
    uint16_t id = 0;
    uint8_t channel = 0;
    bool value = false;
  };

  struct Rule {
    int16_t value = 0;
    std::vector<Condition> conditions;
  };

  struct SignalRuleSet {
    uint16_t signalId = 0;
    bool extended = true;
    uint8_t outputs = 1;
    int16_t defaultValue = 0;
    std::vector<Rule> rules;
    bool hasAppliedValue = false;
    int16_t appliedValue = 0;
  };

  DccExBridge& _dcc;
  LayoutRuntime& _runtime;
  AsyncWebSocket& _ws;

  fs::FS* _fs = nullptr;
  String _path =
      "/config/signal-logic.ndjson";

  bool _enabled = false;
  bool _evaluating = false;

  std::vector<SignalRuleSet> _signals;

  bool parseMeta(JsonObjectConst row);
  bool parseSignal(JsonObjectConst row);

  bool conditionMatches(
      const Condition& condition) const;

  int16_t desiredValue(
      const SignalRuleSet& signal) const;

  void applySignal(
      SignalRuleSet& signal,
      int16_t value);

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
