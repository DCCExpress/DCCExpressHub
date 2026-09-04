#include "SignalAutomationEngine.h"

#include "Logger.h"

SignalAutomationEngine::SignalAutomationEngine(
    DccExBridge& dcc,
    LayoutRuntime& runtime,
    AsyncWebSocket& ws)
    : _dcc(dcc),
      _runtime(runtime),
      _ws(ws) {}

bool SignalAutomationEngine::begin(
    fs::FS& fs,
    const char* path) {
  _fs = &fs;
  _path = path;

  _runtime.onChange(
      [this](
          RuntimeChangeKind kind,
          uint16_t id,
          uint8_t channel) {
        handleRuntimeChange(
            kind,
            id,
            channel);
      });

  const bool loaded = reload();

  if (loaded) {
    evaluate();
  }

  return loaded;
}

bool SignalAutomationEngine::parseMeta(
    JsonObjectConst row) {
  const int version =
      row["version"] | 0;

  if (version != 2) {
    Logger::warn(
        "SignalAutomation: only compiled version 2 is supported");
    return false;
  }

  _enabled =
      row["enabled"] | false;

  return true;
}

bool SignalAutomationEngine::parseSignal(
    JsonObjectConst row) {
  const long rawId =
      row["id"] | 0L;

  if (rawId <= 0 ||
      rawId > 0xffff) {
    return false;
  }

  const char* mode =
      row["mode"] | "";

  if (strcmp(mode, "extended") != 0 &&
      strcmp(mode, "basic") != 0) {
    return false;
  }

  SignalRuleSet signal;
  signal.signalId =
      static_cast<uint16_t>(rawId);

  signal.extended =
      strcmp(mode, "extended") == 0;

  signal.outputs =
      constrain(
          row["outputs"] | 1,
          1,
          16);

  signal.defaultValue =
      row["default"] | 0;

  const JsonArrayConst rules =
      row["rules"].as<JsonArrayConst>();

  for (JsonObjectConst rawRule : rules) {
    Rule rule;
    rule.value =
        rawRule["value"] | 0;

    const JsonArrayConst conditions =
        rawRule["conditions"]
            .as<JsonArrayConst>();

    for (JsonArrayConst rawCondition :
         conditions) {
      if (rawCondition.size() != 4) {
        return false;
      }

      const char* source =
          rawCondition[0] | "";

      const long conditionId =
          rawCondition[1] | 0L;

      const int channel =
          rawCondition[2] | 0;

      const int value =
          rawCondition[3] | 0;

      if (conditionId <= 0 ||
          conditionId > 0xffff ||
          channel < 0 ||
          channel > 1 ||
          (value != 0 && value != 1)) {
        return false;
      }

      Condition condition;

      if (strcmp(source, "turnout") == 0) {
        condition.source =
            Condition::Source::Turnout;
      } else if (
          strcmp(source, "sensor") == 0) {
        condition.source =
            Condition::Source::Sensor;
      } else {
        return false;
      }

      condition.id =
          static_cast<uint16_t>(
              conditionId);

      condition.channel =
          static_cast<uint8_t>(
              channel);

      condition.value =
          value != 0;

      rule.conditions.push_back(
          std::move(condition));
    }

    signal.rules.push_back(
        std::move(rule));
  }

  _signals.push_back(
      std::move(signal));

  return true;
}

bool SignalAutomationEngine::reload() {
  if (!_fs) {
    return false;
  }

  File file =
      _fs->open(
          _path,
          "r");

  if (!file) {
    _enabled = false;
    _signals.clear();

    Logger::info(
        "SignalAutomation: no rule file");

    return true;
  }

  std::vector<SignalRuleSet> parsedSignals;
  bool parsedEnabled = false;
  bool metaSeen = false;
  bool valid = true;

  while (file.available()) {
    String line =
        file.readStringUntil('\n');

    line.trim();

    if (line.length() == 0) {
      continue;
    }

    JsonDocument row;

    const DeserializationError error =
        deserializeJson(
            row,
            line);

    if (error ||
        !row.is<JsonObject>()) {
      valid = false;
      break;
    }

    const JsonObjectConst object =
        row.as<JsonObjectConst>();

    const char* kind =
        object["kind"] | "";

    if (strcmp(kind, "meta") == 0) {
      if (metaSeen) {
        valid = false;
        break;
      }

      const int version =
          object["version"] | 0;

      if (version != 2) {
        valid = false;
        break;
      }

      parsedEnabled =
          object["enabled"] | false;

      metaSeen = true;
      continue;
    }

    if (!metaSeen ||
        strcmp(kind, "signal") != 0) {
      valid = false;
      break;
    }

    // Parse into this instance temporarily, then move back.
    const size_t oldSize =
        _signals.size();

    if (!parseSignal(object)) {
      valid = false;
      break;
    }

    parsedSignals.push_back(
        std::move(_signals.back()));

    _signals.resize(oldSize);
  }

  file.close();

  if (!valid ||
      !metaSeen) {
    Logger::error(
        "SignalAutomation: invalid NDJSON");
    return false;
  }

  _enabled = parsedEnabled;
  _signals =
      std::move(parsedSignals);

  Logger::info(
      "SignalAutomation: loaded " +
      String(_signals.size()) +
      " signal rule sets; enabled=" +
      String(_enabled ? "true" : "false"));

  return true;
}

bool SignalAutomationEngine::conditionMatches(
    const Condition& condition) const {
  if (condition.source ==
      Condition::Source::Sensor) {
    const RuntimeSensor* sensor =
        _runtime.findSensorById(
            condition.id);

    return sensor &&
           sensor->on ==
               condition.value;
  }

  const RuntimeAccessory* turnout =
      _runtime.findAccessoryById(
          RuntimeAccessoryKind::Turnout,
          condition.id,
          condition.channel);

  return turnout &&
         turnout->closed ==
             condition.value;
}

int16_t SignalAutomationEngine::desiredValue(
    const SignalRuleSet& signal) const {
  for (const auto& rule :
       signal.rules) {
    bool matches = true;

    for (const auto& condition :
         rule.conditions) {
      if (!conditionMatches(
              condition)) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return rule.value;
    }
  }

  return signal.defaultValue;
}

void SignalAutomationEngine::broadcastExtended(
    uint16_t address,
    int16_t aspect) {
  JsonDocument data;
  data["address"] = address;
  data["aspect"] = aspect;

  JsonDocument message;
  message["type"] =
      "signalAspectChanged";
  message["data"].set(
      data.as<JsonVariantConst>());

  String body;
  serializeJson(
      message,
      body);

  _ws.textAll(body);
}

void SignalAutomationEngine::broadcastBasic(
    uint16_t address,
    uint8_t outputs,
    uint16_t bits) {
  for (uint8_t i = 0;
       i < outputs;
       ++i) {
    const bool active =
        ((bits >> i) & 1U) != 0;

    JsonDocument data;
    data["address"] =
        address + i;
    data["active"] =
        active;

    JsonDocument message;
    message["type"] =
        "accessoryChanged";
    message["data"].set(
        data.as<JsonVariantConst>());

    String body;
    serializeJson(
        message,
        body);

    _ws.textAll(body);
  }
}

void SignalAutomationEngine::applySignal(
    SignalRuleSet& signal,
    int16_t value) {
  RuntimeAccessory* target =
      _runtime.findAccessoryById(
          RuntimeAccessoryKind::Signal,
          signal.signalId,
          0);

  if (!target) {
    Logger::warn(
        "SignalAutomation: signal id " +
        String(signal.signalId) +
        " not found in layout runtime");
    return;
  }

  if (signal.hasAppliedValue &&
      signal.appliedValue == value) {
    return;
  }

  if (signal.extended) {
    if (!_dcc.sendCommand(
            "<A " +
            String(target->address) +
            " " +
            String(value) +
            ">")) {
      return;
    }

    _runtime.setSignal(
        target->address,
        value);

    broadcastExtended(
        target->address,
        value);

    Logger::info(
        "SignalAutomation: <A " +
        String(target->address) +
        " " +
        String(value) +
        ">");
  } else {
    const uint16_t bits =
        static_cast<uint16_t>(
            value);

    for (uint8_t i = 0;
         i < signal.outputs;
         ++i) {
      const bool active =
          ((bits >> i) & 1U) != 0;

      if (!_dcc.sendCommand(
              "<a " +
              String(target->address + i) +
              " " +
              String(active ? 1 : 0) +
              ">")) {
        return;
      }
    }

    _runtime.setSignal(
        target->address,
        value);

    broadcastBasic(
        target->address,
        signal.outputs,
        bits);

    Logger::info(
        "SignalAutomation: basic signal id " +
        String(signal.signalId) +
        " value=" +
        String(value));
  }

  signal.appliedValue = value;
  signal.hasAppliedValue = true;
}

void SignalAutomationEngine::evaluate() {
  if (_evaluating ||
      !_enabled) {
    return;
  }

  _evaluating = true;

  for (auto& signal :
       _signals) {
    applySignal(
        signal,
        desiredValue(signal));
  }

  _evaluating = false;
}

void SignalAutomationEngine::handleRuntimeChange(
    RuntimeChangeKind kind,
    uint16_t,
    uint8_t) {
  if (kind != RuntimeChangeKind::Turnout &&
      kind != RuntimeChangeKind::Sensor) {
    return;
  }

  // Reload only on a relevant state event. This makes saved rule changes
  // visible without continuously polling the filesystem.
  if (!reload()) {
    return;
  }

  evaluate();
}
