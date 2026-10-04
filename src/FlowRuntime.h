#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>

#include <vector>

#include "AutomationScriptRuntime.h"

class FlowRuntime {
public:
  explicit FlowRuntime(
      AutomationScriptRuntime& scripts);

  bool begin();
  void loop();

  bool runPage(
      const String& pageId,
      const String& inputNodeId,
      JsonVariantConst payload,
      String& error);

  size_t abortPage(
      const String& pageId);

  size_t abortAll();

  void appendSnapshot(
      JsonObject out);

  bool takeChanged();

private:
  static constexpr const char* AUTOMATIONS_PATH =
      "/config/automations.json";

  struct PageDef {
    String id;
    String name;
    bool enabled = true;
  };

  struct NodeDef {
    String id;
    String pageId;
    String kind;
    String dataJson;
  };

  struct EdgeDef {
    String source;
    String target;
  };

  struct ExecutionDef {
    String executionId;
    String pageId;
    String inputNodeId;
  };

  AutomationScriptRuntime& _scripts;

  std::vector<ExecutionDef> _executions;
  uint32_t _manualSequence = 0;
  uint32_t _lastIntervalTick = 0;
  bool _changed = true;

  bool loadDocument(
      std::vector<PageDef>& pages,
      std::vector<NodeDef>& nodes,
      std::vector<EdgeDef>& edges,
      String& error);

  bool runInput(
      const std::vector<PageDef>& pages,
      const std::vector<NodeDef>& nodes,
      const std::vector<EdgeDef>& edges,
      const PageDef& page,
      const NodeDef& input,
      JsonVariantConst payload,
      bool manual,
      const String& reason,
      String& error);

  String buildBranchSource(
      const std::vector<NodeDef>& nodes,
      const std::vector<EdgeDef>& edges,
      const NodeDef& input,
      JsonVariantConst payload);

  String statement(
      const NodeDef& node);

  static bool inputKind(
      const String& kind);

  static String jsonString(
      const String& value);

  static int intValue(
      JsonObjectConst data,
      const char* key,
      int fallback = 0);

  static bool boolValue(
      JsonObjectConst data,
      const char* key,
      bool fallback = false);

  static String stringValue(
      JsonObjectConst data,
      const char* key,
      const String& fallback = "");

  const NodeDef* findNode(
      const std::vector<NodeDef>& nodes,
      const String& id) const;

  String firstTarget(
      const std::vector<EdgeDef>& edges,
      const String& source) const;

  void cleanupExecutions();
  void tickIntervals();
};
