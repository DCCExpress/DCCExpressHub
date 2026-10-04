#include "FlowRuntime.h"

#include <algorithm>

#include "Logger.h"

FlowRuntime::FlowRuntime(
    AutomationScriptRuntime& scripts)
    : _scripts(scripts) {}

bool FlowRuntime::begin() {
  _lastIntervalTick =
      millis();

  _changed =
      true;

  Logger::info(
      "FlowRuntime: ready");

  return true;
}

int FlowRuntime::intValue(
    JsonObjectConst data,
    const char* key,
    int fallback) {
  JsonVariantConst value =
      data[key];

  if (value.is<int>()) {
    return value.as<int>();
  }

  if (value.is<const char*>()) {
    return
        String(
            value.as<const char*>())
            .toInt();
  }

  return fallback;
}

bool FlowRuntime::boolValue(
    JsonObjectConst data,
    const char* key,
    bool fallback) {
  JsonVariantConst value =
      data[key];

  if (value.is<bool>()) {
    return value.as<bool>();
  }

  return fallback;
}

String FlowRuntime::stringValue(
    JsonObjectConst data,
    const char* key,
    const String& fallback) {
  const char* value =
      data[key] |
      nullptr;

  return value
      ? String(value)
      : fallback;
}

String FlowRuntime::jsonString(
    const String& value) {
  JsonDocument document;

  document.set(
      value);

  String result;

  serializeJson(
      document,
      result);

  return result;
}

bool FlowRuntime::inputKind(
    const String& kind) {
  return
      kind == "trigger" ||
      kind == "sensorInput" ||
      kind == "blockInput" ||
      kind == "turnoutInput" ||
      kind == "basicAccessoryInput" ||
      kind == "extendedAccessoryInput" ||
      kind == "locoInput" ||
      kind == "trainEventInput";
}

bool FlowRuntime::loadDocument(
    std::vector<PageDef>& pages,
    std::vector<NodeDef>& nodes,
    std::vector<EdgeDef>& edges,
    String& error) {
  pages.clear();
  nodes.clear();
  edges.clear();

  File file =
      LittleFS.open(
          AUTOMATIONS_PATH,
          "r");

  if (!file) {
    return true;
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

  JsonObjectConst flow =
      document["visualFlow"]
          .as<JsonObjectConst>();

  if (flow.isNull()) {
    return true;
  }

  for (
      JsonObjectConst raw :
      flow["pages"]
          .as<JsonArrayConst>()
  ) {
    PageDef page;

    page.id =
        raw["id"] |
        "";

    if (page.id.isEmpty()) {
      continue;
    }

    page.name =
        raw["name"] |
        page.id;

    page.enabled =
        raw["enabled"] |
        true;

    pages.push_back(
        std::move(
            page));
  }

  for (
      JsonObjectConst raw :
      flow["nodes"]
          .as<JsonArrayConst>()
  ) {
    JsonObjectConst data =
        raw["data"]
            .as<JsonObjectConst>();

    if (data.isNull()) {
      continue;
    }

    NodeDef node;

    node.id =
        raw["id"] |
        "";
    node.pageId =
        data["pageId"] |
        "";
    node.kind =
        data["kind"] |
        "";

    if (
        node.kind ==
        "accessoryInput"
    ) {
      node.kind =
          "basicAccessoryInput";
    }

    if (
        node.kind ==
            "trigger" &&
        stringValue(
            data,
            "triggerMode") ==
            "sensor"
    ) {
      node.kind =
          "sensorInput";
    }

    if (
        node.id.isEmpty() ||
        node.pageId.isEmpty() ||
        node.kind.isEmpty()
    ) {
      continue;
    }

    serializeJson(
        data,
        node.dataJson);

    nodes.push_back(
        std::move(
            node));
  }

  for (
      JsonObjectConst raw :
      flow["edges"]
          .as<JsonArrayConst>()
  ) {
    EdgeDef edge;

    edge.source =
        raw["source"] |
        "";
    edge.target =
        raw["target"] |
        "";

    if (
        edge.source.isEmpty() ||
        edge.target.isEmpty()
    ) {
      continue;
    }

    edges.push_back(
        std::move(
            edge));
  }

  return true;
}

const FlowRuntime::NodeDef*
FlowRuntime::findNode(
    const std::vector<NodeDef>& nodes,
    const String& id) const {
  for (
      const auto& node :
      nodes
  ) {
    if (
        node.id ==
        id
    ) {
      return &node;
    }
  }

  return nullptr;
}

String FlowRuntime::firstTarget(
    const std::vector<EdgeDef>& edges,
    const String& source) const {
  for (
      const auto& edge :
      edges
  ) {
    if (
        edge.source ==
        source
    ) {
      return edge.target;
    }
  }

  return "";
}

String FlowRuntime::statement(
    const NodeDef& node) {
  JsonDocument document;

  if (
      deserializeJson(
          document,
          node.dataJson)
  ) {
    return "";
  }

  JsonObjectConst data =
      document.as<JsonObjectConst>();

  if (
      node.kind ==
      "waitForSensor"
  ) {
    return
        "await dcc.waitForSensor(" +
        String(
            std::max(
                0,
                intValue(
                    data,
                    "sensorAddress"))) +
        ", " +
        (
            boolValue(
                data,
                "sensorState",
                true)
                ? "true"
                : "false"
        ) +
        ");";
  }

  if (
      node.kind ==
      "setTurnout"
  ) {
    JsonArrayConst commands =
        data["turnoutCommands"]
            .as<JsonArrayConst>();

    if (!commands.isNull()) {
      String result;

      for (
          JsonObjectConst command :
          commands
      ) {
        const int address =
            intValue(
                command,
                "address");

        if (
            address < 1 ||
            address > 32767
        ) {
          continue;
        }

        if (!result.isEmpty()) {
          result += "\n";
        }

        result +=
            "await dcc.setTurnout(" +
            String(address) +
            ", " +
            (
                boolValue(
                    command,
                    "closed",
                    true)
                    ? "true"
                    : "false"
            ) +
            ");";
      }

      if (!result.isEmpty()) {
        return result;
      }
    }

    const int address =
        intValue(
            data,
            "turnoutAddress");

    if (
        address < 1 ||
        address > 2048
    ) {
      return
          "throw new Error(\"Set Turnout node has no configured turnout.\");";
    }

    return
        "await dcc.setTurnout(" +
        String(address) +
        ", " +
        (
            boolValue(
                data,
                "turnoutClosed",
                true)
                ? "true"
                : "false"
        ) +
        ");";
  }

  if (
      node.kind ==
      "setLoco"
  ) {
    const int address =
        intValue(
            data,
            "locoAddress");

    const int speed =
        std::max(
            0,
            std::min(
                126,
                intValue(
                    data,
                    "speed",
                    20)));

    const String direction =
        stringValue(
            data,
            "locoDirection") ==
            "reverse"
            ? "reverse"
            : "forward";

    if (
        address >= 1 &&
        address <= 10239
    ) {
      // ESP32 QuickJS binding currently takes a boolean direction.
      return
          "await hub.setLoco(" +
          String(address) +
          ", " +
          String(speed) +
          ", " +
          (
              direction ==
                  "forward"
                  ? "true"
                  : "false"
          ) +
          ");";
    }

    return
        "throw new Error(\"Set Loco requires a configured loco address on ESP32.\");";
  }

  if (
      node.kind ==
      "locoFunction"
  ) {
    const int fn =
        std::max(
            0,
            std::min(
                28,
                intValue(
                    data,
                    "functionNumber",
                    2)));

    const int pulse =
        std::max(
            1,
            std::min(
                600000,
                intValue(
                    data,
                    "pulseMs",
                    700)));

    return
        "{ const locoAddress = Number(payload && typeof payload === \"object\" ? payload.locoAddress : NaN); " 
        "if (!Number.isInteger(locoAddress) || locoAddress < 1 || locoAddress > 10239) throw new Error(\"Loco Function requires payload.locoAddress.\"); "
        "hub.setLocoFunction(locoAddress, " +
        String(fn) +
        ", true); await delay(" +
        String(pulse) +
        "); hub.setLocoFunction(locoAddress, " +
        String(fn) +
        ", false); }";
  }

  if (
      node.kind ==
      "delay"
  ) {
    const int delayMs =
        std::max(
            0,
            std::min(
                600000,
                intValue(
                    data,
                    "delayMs",
                    500)));

    return
        "await delay(" +
        String(delayMs) +
        ");";
  }

  if (
      node.kind ==
      "log"
  ) {
    return
        "log(" +
        jsonString(
            stringValue(
                data,
                "message")) +
        ", \"payload:\", JSON.stringify(payload, null, 2));";
  }

  // These still depend on ScriptRuntime bindings not yet present on ESP32.
  // Keeping them non-runnable is safer than silently issuing wrong commands.
  return "";
}

String FlowRuntime::buildBranchSource(
    const std::vector<NodeDef>& nodes,
    const std::vector<EdgeDef>& edges,
    const NodeDef& input,
    JsonVariantConst payload) {
  String nextId =
      firstTarget(
          edges,
          input.id);

  if (nextId.isEmpty()) {
    return "";
  }

  String source;
  std::vector<String> visited;

  const NodeDef* current =
      findNode(
          nodes,
          nextId);

  while (current) {
    if (
        std::find(
            visited.begin(),
            visited.end(),
            current->id) !=
        visited.end()
    ) {
      break;
    }

    visited.push_back(
        current->id);

    if (!inputKind(
            current->kind)) {
      const String line =
          statement(
              *current);

      if (!line.isEmpty()) {
        if (!source.isEmpty()) {
          source +=
              "\n\n";
        }

        source +=
            line;
      }
    }

    const String target =
        firstTarget(
            edges,
            current->id);

    current =
        target.isEmpty()
            ? nullptr
            : findNode(
                  nodes,
                  target);
  }

  if (source.isEmpty()) {
    return "";
  }

  String payloadJson;

  if (!payload.isNull()) {
    serializeJson(
        payload,
        payloadJson);
  } else {
    payloadJson =
        "null";
  }

  return
      "let payload = " +
      payloadJson +
      ";\n\n" +
      source;
}

bool FlowRuntime::runInput(
    const std::vector<PageDef>& pages,
    const std::vector<NodeDef>& nodes,
    const std::vector<EdgeDef>& edges,
    const PageDef& page,
    const NodeDef& input,
    JsonVariantConst payload,
    bool manual,
    const String& reason,
    String& error) {
  if (
      !page.enabled &&
      !manual
  ) {
    error =
        "flow_page_disabled";
    return false;
  }

  const String source =
      buildBranchSource(
          nodes,
          edges,
          input,
          payload);

  if (source.isEmpty()) {
    error =
        "flow_branch_empty";
    return false;
  }

  const String executionId =
      manual
          ? "visual-flow-" +
                reason +
                ":" +
                page.id +
                ":" +
                String(
                    ++_manualSequence)
          : "visual-flow-runtime:" +
                page.id +
                ":" +
                input.id;

  _executions.push_back(
      {
          executionId,
          page.id,
          input.id
      });

  const bool ok =
      _scripts.startSource(
          executionId,
          "Flow input: " +
              page.name +
              " / " +
              input.kind,
          "visual-flow",
          source,
          error);

  if (!ok) {
    if (
        error !=
        "script_already_running"
    ) {
      _executions.pop_back();
    }

    return false;
  }

  _changed =
      true;

  return true;
}

bool FlowRuntime::runPage(
    const String& pageId,
    const String& inputNodeId,
    JsonVariantConst payload,
    String& error) {
  std::vector<PageDef> pages;
  std::vector<NodeDef> nodes;
  std::vector<EdgeDef> edges;

  if (!loadDocument(
          pages,
          nodes,
          edges,
          error)) {
    return false;
  }

  const PageDef* page =
      nullptr;

  for (
      const auto& candidate :
      pages
  ) {
    if (
        candidate.id ==
        pageId
    ) {
      page =
          &candidate;
      break;
    }
  }

  if (!page) {
    error =
        "flow_page_not_found";
    return false;
  }

  const NodeDef* input =
      nullptr;

  for (
      const auto& candidate :
      nodes
  ) {
    if (
        candidate.pageId !=
        page->id ||
        !inputKind(
            candidate.kind)
    ) {
      continue;
    }

    if (
        inputNodeId.isEmpty() ||
        candidate.id ==
            inputNodeId
    ) {
      input =
          &candidate;
      break;
    }
  }

  if (!input) {
    error =
        "flow_input_not_found";
    return false;
  }

  return
      runInput(
          pages,
          nodes,
          edges,
          *page,
          *input,
          payload,
          true,
          "run",
          error);
}

size_t FlowRuntime::abortPage(
    const String& pageId) {
  size_t count =
      0;

  for (
      const auto& execution :
      _executions
  ) {
    if (
        execution.pageId !=
        pageId
    ) {
      continue;
    }

    String error;

    if (_scripts.abort(
            execution.executionId,
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

size_t FlowRuntime::abortAll() {
  size_t count =
      0;

  for (
      const auto& execution :
      _executions
  ) {
    String error;

    if (_scripts.abort(
            execution.executionId,
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

void FlowRuntime::cleanupExecutions() {
  // ScriptRuntime keeps completed states in its snapshot. Flow ownership only
  // needs to be retained while the execution is still running/paused. A full
  // state query API will replace this lightweight cleanup in the next parity
  // pass; bounded vector growth is maintained here by trimming old entries.
  if (
      _executions.size() >
      32
  ) {
    _executions.erase(
        _executions.begin(),
        _executions.begin() +
            (_executions.size() - 32));

    _changed =
        true;
  }
}

void FlowRuntime::tickIntervals() {
  // Interval inputs are parsed here in the first port, but automatic execution
  // is enabled only after event/state subscriptions are wired. This prevents a
  // newly flashed ESP32 from unexpectedly firing saved flows.
}

void FlowRuntime::loop() {
  cleanupExecutions();

  const uint32_t now =
      millis();

  if (
      static_cast<uint32_t>(
          now -
          _lastIntervalTick) >=
      250U
  ) {
    _lastIntervalTick =
        now;

    tickIntervals();
  }
}

void FlowRuntime::appendSnapshot(
    JsonObject out) {
  std::vector<PageDef> pages;
  std::vector<NodeDef> nodes;
  std::vector<EdgeDef> edges;
  String error;

  JsonArray result =
      out["pages"]
          .to<JsonArray>();

  if (!loadDocument(
          pages,
          nodes,
          edges,
          error)) {
    return;
  }

  for (
      const auto& page :
      pages
  ) {
    JsonObject item =
        result.add<JsonObject>();

    item["pageId"] =
        page.id;
    item["name"] =
        page.name;
    item["enabled"] =
        page.enabled;

    size_t active =
        0;

    for (
        const auto& execution :
        _executions
    ) {
      if (
          execution.pageId ==
          page.id
      ) {
        ++active;
      }
    }

    item["activeExecutions"] =
        active;
  }
}

bool FlowRuntime::takeChanged() {
  const bool changed =
      _changed;

  _changed =
      false;

  return changed;
}
