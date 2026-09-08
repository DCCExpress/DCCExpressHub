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

bool keyAllowed(
    const char* key,
    const char* const* allowed,
    size_t count) {
  if (!key) {
    return false;
  }

  for (
      size_t index = 0;
      index < count;
      ++index
  ) {
    if (
        strcmp(
            key,
            allowed[index]) ==
        0
    ) {
      return true;
    }
  }

  return false;
}

void warnUnknownKeys(
    JsonObjectConst object,
    const char* const* allowed,
    size_t count,
    const String& context) {
  for (
      JsonPairConst pair :
      object
  ) {
    const char* key =
        pair.key().c_str();

    if (
        !keyAllowed(
            key,
            allowed,
            count)
    ) {
      Logger::warn(
          "SignalAutomation: " +
          context +
          " unknown field \"" +
          String(key) +
          "\" ignored");
    }
  }
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
  static const char* const SIGNAL_KEYS[] = {
      "kind",
      "id",
      "address",
      "mode",
      "outputs",
      "default",
      "rules"
  };

  warnUnknownKeys(
      row,
      SIGNAL_KEYS,
      sizeof(SIGNAL_KEYS) /
          sizeof(SIGNAL_KEYS[0]),
      "signal");

  uint16_t signalId =
      0;

  const long rawId =
      row["id"] |
      0L;

  if (
      rawId > 0 &&
      rawId <= 0xffff
  ) {
    signalId =
        static_cast<uint16_t>(
            rawId);
  } else {
    const long legacyAddress =
        row["address"] |
        0L;

    if (
        legacyAddress > 0 &&
        legacyAddress <= 0xffff
    ) {
      RuntimeAccessory* runtimeSignal =
          _runtime.findAccessory(
              RuntimeAccessoryKind::Signal,
              static_cast<uint16_t>(
                  legacyAddress));

      if (runtimeSignal) {
        signalId =
            runtimeSignal->id;

        Logger::warn(
            "SignalAutomation: legacy signal address " +
            String(
                legacyAddress) +
            " mapped to layout id " +
            String(
                signalId));
      }
    }
  }

  if (signalId == 0) {
    Logger::warn(
        "SignalAutomation: signal row has no usable id/address and was skipped");

    return false;
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
    Logger::warn(
        "SignalAutomation: signal id " +
        String(
            signalId) +
        " has unsupported mode \"" +
        String(mode) +
        "\" and was skipped");

    return false;
  }

  SignalRuleSet signal;

  signal.signalId =
      signalId;

  signal.extended =
      strcmp(
          mode,
          "extended") ==
      0;

  int rawOutputs =
      row["outputs"] |
      1;

  if (
      rawOutputs < 1 ||
      rawOutputs > 16
  ) {
    Logger::warn(
        "SignalAutomation: signal id " +
        String(
            signalId) +
        " outputs=" +
        String(
            rawOutputs) +
        " clamped to supported range 1..16");

    rawOutputs =
        constrain(
            rawOutputs,
            1,
            16);
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
    Logger::warn(
        "SignalAutomation: signal id " +
        String(
            signalId) +
        " has invalid default value " +
        String(
            defaultValue) +
        " and was skipped");

    return false;
  }

  signal.defaultValue =
      static_cast<int32_t>(
          defaultValue);

  JsonArrayConst rules;

  if (
      row["rules"]
          .is<JsonArray>()
  ) {
    rules =
        row["rules"]
            .as<JsonArrayConst>();
  } else {
    Logger::warn(
        "SignalAutomation: signal id " +
        String(
            signalId) +
        " has no valid rules array; using empty rule list");
  }

  size_t ruleIndex =
      0;

  for (
      JsonVariantConst rawRuleVariant :
      rules
  ) {
    ++ruleIndex;

    if (
        !rawRuleVariant
             .is<JsonObject>()
    ) {
      Logger::warn(
          "SignalAutomation: signal id " +
          String(
              signalId) +
          " rule " +
          String(
              ruleIndex) +
          " is not an object and was skipped");

      continue;
    }

    const JsonObjectConst rawRule =
        rawRuleVariant
            .as<JsonObjectConst>();

    static const char* const RULE_KEYS[] = {
        "value",
        "conditions"
    };

    warnUnknownKeys(
        rawRule,
        RULE_KEYS,
        sizeof(RULE_KEYS) /
            sizeof(RULE_KEYS[0]),
        "signal id " +
            String(signalId) +
            " rule " +
            String(ruleIndex));

    const long rawValue =
        rawRule["value"] |
        0L;

    if (
        !valueFitsSignal(
            signal.extended,
            signal.outputs,
            rawValue)
    ) {
      Logger::warn(
          "SignalAutomation: signal id " +
          String(
              signalId) +
          " rule " +
          String(
              ruleIndex) +
          " has invalid value " +
          String(
              rawValue) +
          " and was skipped");

      continue;
    }

    Rule rule;

    rule.value =
        static_cast<int32_t>(
            rawValue);

    JsonArrayConst conditions;

    if (
        rawRule["conditions"]
            .is<JsonArray>()
    ) {
      conditions =
          rawRule["conditions"]
              .as<JsonArrayConst>();
    } else {
      Logger::warn(
          "SignalAutomation: signal id " +
          String(
              signalId) +
          " rule " +
          String(
              ruleIndex) +
          " has no valid conditions array; treating it as unconditional");
    }

    size_t conditionIndex =
        0;

    for (
        JsonVariantConst rawConditionVariant :
        conditions
    ) {
      ++conditionIndex;

      if (
          !rawConditionVariant
               .is<JsonArray>()
      ) {
        Logger::warn(
            "SignalAutomation: signal id " +
            String(
                signalId) +
            " rule " +
            String(
                ruleIndex) +
            " condition " +
            String(
                conditionIndex) +
            " is not an array and was skipped");

        continue;
      }

      const JsonArrayConst rawCondition =
          rawConditionVariant
              .as<JsonArrayConst>();

      if (
          rawCondition.size() !=
              4 &&
          rawCondition.size() !=
              3
      ) {
        Logger::warn(
            "SignalAutomation: signal id " +
            String(
                signalId) +
            " rule " +
            String(
                ruleIndex) +
            " condition " +
            String(
                conditionIndex) +
            " has unsupported shape and was skipped");

        continue;
      }

      const char* source =
          rawCondition[0] |
          "";

      Condition condition;

      if (
          rawCondition.size() ==
          4
      ) {
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
          Logger::warn(
              "SignalAutomation: signal id " +
              String(
                  signalId) +
              " rule " +
              String(
                  ruleIndex) +
              " condition " +
              String(
                  conditionIndex) +
              " contains invalid values and was skipped");

          continue;
        }

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
          Logger::warn(
              "SignalAutomation: signal id " +
              String(
                  signalId) +
              " rule " +
              String(
                  ruleIndex) +
              " condition " +
              String(
                  conditionIndex) +
              " has unsupported source \"" +
              String(source) +
              "\" and was skipped");

          continue;
        }

        condition.id =
            static_cast<uint16_t>(
                conditionId);

        condition.channel =
            static_cast<uint8_t>(
                channel);

        condition.value =
            value != 0;
      } else {
        const long legacyAddress =
            rawCondition[1] |
            0L;

        const int value =
            rawCondition[2] |
            0;

        if (
            legacyAddress <= 0 ||
            legacyAddress > 0xffff ||
            (
                value != 0 &&
                value != 1
            )
        ) {
          Logger::warn(
              "SignalAutomation: signal id " +
              String(
                  signalId) +
              " rule " +
              String(
                  ruleIndex) +
              " legacy condition " +
              String(
                  conditionIndex) +
              " contains invalid values and was skipped");

          continue;
        }

        if (
            strcmp(
                source,
                "sensor") ==
            0
        ) {
          RuntimeSensor* sensor =
              _runtime.findSensor(
                  static_cast<uint16_t>(
                      legacyAddress));

          if (!sensor) {
            Logger::warn(
                "SignalAutomation: legacy sensor address " +
                String(
                    legacyAddress) +
                " was not found and the condition was skipped");

            continue;
          }

          condition.source =
              Condition::Source::Sensor;

          condition.id =
              sensor->id;

          condition.channel =
              0;

          condition.value =
              value != 0;
        } else if (
            strcmp(
                source,
                "turnout") ==
            0
        ) {
          RuntimeAccessory* turnout =
              _runtime.findAccessory(
                  RuntimeAccessoryKind::Turnout,
                  static_cast<uint16_t>(
                      legacyAddress));

          if (!turnout) {
            Logger::warn(
                "SignalAutomation: legacy turnout address " +
                String(
                    legacyAddress) +
                " was not found and the condition was skipped");

            continue;
          }

          condition.source =
              Condition::Source::Turnout;

          condition.id =
              turnout->id;

          condition.channel =
              turnout->channel;

          const bool physicalValue =
              value != 0;

          condition.value =
              physicalValue ==
              turnout->closedValue;
        } else {
          Logger::warn(
              "SignalAutomation: legacy condition source \"" +
              String(source) +
              "\" is unsupported and was skipped");

          continue;
        }
      }

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

  for (
      auto& existing :
      signals
  ) {
    if (
        existing.signalId ==
        signal.signalId
    ) {
      Logger::warn(
          "SignalAutomation: duplicate signal id " +
          String(
              signal.signalId) +
          "; later definition wins");

      existing =
          std::move(
              signal);

      return true;
    }
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

  bool parsedEnabled =
      false;

  bool recognizedAny =
      false;

  std::vector<SignalRuleSet>
      parsedSignals;

  size_t lineNumber =
      0;

  while (
      file.available()
  ) {
    ++lineNumber;

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
      Logger::warn(
          "SignalAutomation: line " +
          String(
              lineNumber) +
          " is not valid JSON object and was skipped");

      continue;
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
      static const char* const META_KEYS[] = {
          "kind",
          "enabled",
          "version"
      };

      warnUnknownKeys(
          object,
          META_KEYS,
          sizeof(META_KEYS) /
              sizeof(META_KEYS[0]),
          "meta");

      if (
          object.containsKey(
              "version")
      ) {
        Logger::warn(
            "SignalAutomation: legacy meta version field ignored");
      }

      parsedEnabled =
          object["enabled"] |
          false;

      recognizedAny =
          true;

      continue;
    }

    if (
        strcmp(
            kind,
            "signal") ==
        0
    ) {
      if (
          parseSignal(
              object,
              parsedSignals)
      ) {
        recognizedAny =
            true;
      }

      continue;
    }

    Logger::warn(
        "SignalAutomation: line " +
        String(
            lineNumber) +
        " has unknown kind \"" +
        String(kind) +
        "\" and was skipped");
  }

  file.close();

  if (!recognizedAny) {
    Logger::warn(
        "SignalAutomation: no recognized rows found; automation remains disabled");
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
        "SignalAutomation: rule file could not be opened");

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
