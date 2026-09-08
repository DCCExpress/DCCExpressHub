#include "SignalAutomationEngine.h"

#include "FileStore.h"
#include "Logger.h"

namespace {

bool valueFitsSignal(
    bool extended,
    uint8_t outputs,
    int32_t value) {
  if (extended) {
    return
        value >= 0 &&
        value <= 255;
  }

  if (
      value < 0 ||
      value > 65535
  ) {
    return false;
  }

  const uint32_t mask =
      outputs >= 16
          ? 0xffffUL
          : (
                (1UL << outputs) -
                1UL
            );

  return
      static_cast<uint32_t>(
          value) <=
      mask;
}

}

SignalAutomationEngine::SignalAutomationEngine(
    ICommandCenter& commandCenter,
    LayoutRuntime& runtime,
    AsyncWebSocket& ws)
    : _commandCenter(commandCenter),
      _runtime(runtime),
      _ws(ws) {}

bool SignalAutomationEngine::begin(
    fs::FS& fs,
    const char* path) {
  _fs =
      &fs;

  _path =
      path;

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

  const bool loaded =
      reload();

  if (loaded) {
    evaluate();
  }

  return loaded;
}

bool SignalAutomationEngine::parseSignal(
    JsonObjectConst row,
    std::vector<SignalRuleSet>& signals) const {
  const long rawId =
      row["id"] |
      0L;

  if (
      rawId <= 0 ||
      rawId > 0xffff
  ) {
    return false;
  }

  for (
      const auto& existing :
      signals
  ) {
    if (
        existing.signalId ==
        static_cast<uint16_t>(
            rawId)
    ) {
      return false;
    }
  }

  const char* mode =
      row["mode"] |
      "";

  if (
      strcmp(
          mode,
          "extended") != 0 &&
      strcmp(
          mode,
          "basic") != 0
  ) {
    return false;
  }

  SignalRuleSet signal;

  signal.signalId =
      static_cast<uint16_t>(
          rawId);

  signal.extended =
      strcmp(
          mode,
          "extended") ==
      0;

  const int rawOutputs =
      row["outputs"] |
      1;

  if (
      rawOutputs < 1 ||
      rawOutputs > 16
  ) {
    return false;
  }

  signal.outputs =
      static_cast<uint8_t>(
          rawOutputs);

  const long defaultValue =
      row["default"] |
      0L;

  if (
      !valueFitsSignal(
          signal.extended,
          signal.outputs,
          defaultValue)
  ) {
    return false;
  }

  signal.defaultValue =
      static_cast<int32_t>(
          defaultValue);

  if (
      !row["rules"]
           .is<JsonArray>()
  ) {
    return false;
  }

  const JsonArrayConst rules =
      row["rules"]
          .as<JsonArrayConst>();

  for (
      JsonVariantConst rawRuleVariant :
      rules
  ) {
    if (
        !rawRuleVariant
             .is<JsonObject>()
    ) {
      return false;
    }

    const JsonObjectConst rawRule =
        rawRuleVariant
            .as<JsonObjectConst>();

    const long rawValue =
        rawRule["value"] |
        0L;

    if (
        !valueFitsSignal(
            signal.extended,
            signal.outputs,
            rawValue)
    ) {
      return false;
    }

    if (
        !rawRule["conditions"]
             .is<JsonArray>()
    ) {
      return false;
    }

    Rule rule;

    rule.value =
        static_cast<int32_t>(
            rawValue);

    const JsonArrayConst conditions =
        rawRule["conditions"]
            .as<JsonArrayConst>();

    for (
        JsonVariantConst rawConditionVariant :
        conditions
    ) {
      if (
          !rawConditionVariant
               .is<JsonArray>()
      ) {
        return false;
      }

      const JsonArrayConst rawCondition =
          rawConditionVariant
              .as<JsonArrayConst>();

      if (
          rawCondition.size() !=
          4
      ) {
        return false;
      }

      const char* source =
          rawCondition[0] |
          "";

      const long conditionId =
          rawCondition[1] |
          0L;

      const int channel =
          rawCondition[2] |
          0;

      const int value =
          rawCondition[3] |
          0;

      if (
          conditionId <= 0 ||
          conditionId > 0xffff ||
          channel < 0 ||
          channel > 1 ||
          (
              value != 0 &&
              value != 1
          )
      ) {
        return false;
      }

      Condition condition;

      if (
          strcmp(
              source,
              "turnout") ==
          0
      ) {
        condition.source =
            Condition::Source::Turnout;
      } else if (
          strcmp(
              source,
              "sensor") ==
          0
      ) {
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

      rule.conditions
          .push_back(
              std::move(
                  condition));
    }

    signal.rules
        .push_back(
            std::move(
                rule));
  }

  signals.push_back(
      std::move(
          signal));

  return true;
}

bool SignalAutomationEngine::parseFile(
    const char* path,
    bool& enabled,
    std::vector<SignalRuleSet>& signals) const {
  if (
      !_fs ||
      !path ||
      !*path
  ) {
    return false;
  }

  FileStore files(
      *_fs);

  File file =
      files.openRead(
          path);

  if (!file) {
    return false;
  }

  bool metaSeen =
      false;

  bool parsedEnabled =
      false;

  std::vector<SignalRuleSet>
      parsedSignals;

  bool valid =
      true;

  while (
      file.available()
  ) {
    String line =
        file.readStringUntil(
            '\n');

    line.trim();

    if (
        line.isEmpty()
    ) {
      continue;
    }

    JsonDocument row;

    const DeserializationError error =
        deserializeJson(
            row,
            line);

    if (
        error ||
        !row.is<JsonObject>()
    ) {
      valid =
          false;

      break;
    }

    const JsonObjectConst object =
        row.as<JsonObjectConst>();

    const char* kind =
        object["kind"] |
        "";

    if (
        strcmp(
            kind,
            "meta") ==
        0
    ) {
      if (
          metaSeen ||
          (object["version"] | 0) != 2
      ) {
        valid =
            false;

        break;
      }

      parsedEnabled =
          object["enabled"] |
          false;

      metaSeen =
          true;

      continue;
    }

    if (
        !metaSeen ||
        strcmp(
            kind,
            "signal") !=
            0 ||
        !parseSignal(
            object,
            parsedSignals)
    ) {
      valid =
          false;

      break;
    }
  }

  file.close();

  if (
      !valid ||
      !metaSeen
  ) {
    return false;
  }

  enabled =
      parsedEnabled;

  signals =
      std::move(
          parsedSignals);

  return true;
}

bool SignalAutomationEngine::validateFile(
    const char* path) {
  bool enabled =
      false;

  std::vector<SignalRuleSet>
      signals;

  return
      parseFile(
          path,
          enabled,
          signals);
}

bool SignalAutomationEngine::reload() {
  if (!_fs) {
    return false;
  }

  FileStore files(
      *_fs);

  if (
      !files.exists(
          _path.c_str())
  ) {
    _enabled =
        false;

    _signals.clear();

    Logger::info(
        "SignalAutomation: no rule file");

    return true;
  }

  bool parsedEnabled =
      false;

  std::vector<SignalRuleSet>
      parsedSignals;

  if (
      !parseFile(
          _path.c_str(),
          parsedEnabled,
          parsedSignals)
  ) {
    Logger::error(
        "SignalAutomation: invalid NDJSON");

    return false;
  }

  _enabled =
      parsedEnabled;

  _signals =
      std::move(
          parsedSignals);

  Logger::info(
      "SignalAutomation: loaded " +
      String(
          _signals.size()) +
      " signal rule sets; enabled=" +
      String(
          _enabled
              ? "true"
              : "false"));

  return true;
}

bool SignalAutomationEngine::conditionMatches(
    const Condition& condition) const {
  if (
      condition.source ==
      Condition::Source::Sensor
  ) {
    const RuntimeSensor* sensor =
        _runtime.findSensorById(
            condition.id);

    return
        sensor &&
        sensor->on ==
            condition.value;
  }

  const RuntimeAccessory* turnout =
      _runtime.findAccessoryById(
          RuntimeAccessoryKind::Turnout,
          condition.id,
          condition.channel);

  return
      turnout &&
      turnout->closed ==
          condition.value;
}

int32_t SignalAutomationEngine::desiredValue(
    const SignalRuleSet& signal) const {
  for (
      const auto& rule :
      signal.rules
  ) {
    bool matches =
        true;

    for (
        const auto& condition :
        rule.conditions
    ) {
      if (
          !conditionMatches(
              condition)
      ) {
        matches =
            false;

        break;
      }
    }

    if (matches) {
      return
          rule.value;
    }
  }

  return
      signal.defaultValue;
}

void SignalAutomationEngine::broadcastExtended(
    uint16_t address,
    int16_t aspect) {
  JsonDocument data;

  data["address"] =
      address;

  data["aspect"] =
      aspect;

  JsonDocument message;

  message["type"] =
      "signalAspectChanged";

  message["data"].set(
      data.as<JsonVariantConst>());

  String body;

  serializeJson(
      message,
      body);

  _ws.textAll(
      body);
}

void SignalAutomationEngine::broadcastBasic(
    uint16_t address,
    uint8_t outputs,
    uint16_t bits) {
  for (
      uint8_t index = 0;
      index < outputs;
      ++index
  ) {
    const bool active =
        (
            (
                bits >>
                index
            ) &
            1U
        ) !=
        0;

    JsonDocument data;

    data["address"] =
        address +
        index;

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

    _ws.textAll(
        body);
  }
}

void SignalAutomationEngine::applySignal(
    SignalRuleSet& signal,
    int32_t value) {
  RuntimeAccessory* target =
      _runtime.findAccessoryById(
          RuntimeAccessoryKind::Signal,
          signal.signalId,
          0);

  if (!target) {
    Logger::warn(
        "SignalAutomation: signal id " +
        String(
            signal.signalId) +
        " not found in layout runtime");

    return;
  }

  if (
      signal.hasAppliedValue &&
      signal.appliedValue ==
          value
  ) {
    return;
  }

  if (signal.extended) {
    if (
        value < 0 ||
        value > 255 ||
        !_commandCenter
             .setSignalAspect(
                 target->address,
                 static_cast<int16_t>(
                     value))
    ) {
      return;
    }

    _runtime.setSignal(
        target->address,
        static_cast<int>(
            value));

    broadcastExtended(
        target->address,
        static_cast<int16_t>(
            value));

    Logger::info(
        "SignalAutomation: extended signal address " +
        String(
            target->address) +
        " aspect=" +
        String(
            value));
  } else {
    if (
        value < 0 ||
        value > 65535
    ) {
      return;
    }

    const uint16_t bits =
        static_cast<uint16_t>(
            value);

    for (
        uint8_t index = 0;
        index < signal.outputs;
        ++index
    ) {
      const bool active =
          (
              (
                  bits >>
                  index
              ) &
              1U
          ) !=
          0;

      if (
          !_commandCenter
               .setAccessory(
                   target->address +
                       index,
                   active)
      ) {
        return;
      }
    }

    _runtime.setSignal(
        target->address,
        static_cast<int>(
            value));

    broadcastBasic(
        target->address,
        signal.outputs,
        bits);

    Logger::info(
        "SignalAutomation: basic signal id " +
        String(
            signal.signalId) +
        " value=" +
        String(
            value));
  }

  signal.appliedValue =
      value;

  signal.hasAppliedValue =
      true;
}

void SignalAutomationEngine::evaluate() {
  if (
      _evaluating ||
      !_enabled
  ) {
    return;
  }

  _evaluating =
      true;

  for (
      auto& signal :
      _signals
  ) {
    applySignal(
        signal,
        desiredValue(
            signal));
  }

  _evaluating =
      false;
}

void SignalAutomationEngine::handleRuntimeChange(
    RuntimeChangeKind kind,
    uint16_t,
    uint8_t) {
  if (
      kind !=
          RuntimeChangeKind::Turnout &&
      kind !=
          RuntimeChangeKind::Sensor
  ) {
    return;
  }

  evaluate();
}
