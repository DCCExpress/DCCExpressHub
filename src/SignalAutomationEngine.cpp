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

  const long rawId =
      row["id"] |
      0L;

  const long rawAddress =
      row["address"] |
      0L;

  uint16_t signalId =
      (
          rawId > 0 &&
          rawId <= 0xffff
      )
          ? static_cast<uint16_t>(
                rawId)
          : 0;

  const uint16_t signalAddress =
      (
          rawAddress > 0 &&
          rawAddress <= 0xffff
      )
          ? static_cast<uint16_t>(
                rawAddress)
          : 0;

  // Validate/rebind the target against the live layout runtime. The DCC
  // address is the durable fallback when layout IDs have been migrated.
  RuntimeAccessory* target =
      signalId != 0
          ? _runtime.findAccessoryById(
                RuntimeAccessoryKind::Signal,
                signalId,
                0)
          : nullptr;

  if (
      target &&
      signalAddress != 0 &&
      target->address !=
          signalAddress
  ) {
    target =
        nullptr;
  }

  if (
      !target &&
      signalAddress != 0
  ) {
    target =
        _runtime.findAccessory(
            RuntimeAccessoryKind::Signal,
            signalAddress);

    if (target) {
      signalId =
          target->id;
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

  const bool extended =
      strcmp(
          mode,
          "extended") ==
      0;

  if (
      !extended &&
      strcmp(
          mode,
          "basic") !=
          0
  ) {
    Logger::warn(
        "SignalAutomation: signal id " +
        String(signalId) +
        " has unsupported mode \"" +
        String(mode) +
        "\" and was skipped");

    return false;
  }

  int outputs =
      row["outputs"] |
      1;

  outputs =
      constrain(
          outputs,
          1,
          16);

  const long defaultValue =
      row["default"] |
      0L;

  if (
      !valueFitsSignal(
          extended,
          static_cast<uint8_t>(
              outputs),
          defaultValue)
  ) {
    Logger::warn(
        "SignalAutomation: signal id " +
        String(signalId) +
        " has invalid default value " +
        String(defaultValue) +
        " and was skipped");

    return false;
  }

  const JsonArrayConst rawRules =
      row["rules"]
          .as<JsonArrayConst>();

  if (rawRules.isNull()) {
    Logger::warn(
        "SignalAutomation: signal id " +
        String(signalId) +
        " has no rules array and was skipped");

    return false;
  }

  SignalRuleSet signal;

  signal.signalId =
      signalId;

  signal.signalAddress =
      signalAddress;

  signal.extended =
      extended;

  signal.outputs =
      static_cast<uint8_t>(
          outputs);

  signal.defaultValue =
      static_cast<int32_t>(
          defaultValue);

  size_t ruleIndex =
      0;

  for (
      JsonVariantConst rawRuleVariant :
      rawRules
  ) {
    ++ruleIndex;

    const JsonObjectConst rawRule =
        rawRuleVariant
            .as<JsonObjectConst>();

    if (rawRule.isNull()) {
      Logger::warn(
          "SignalAutomation: signal id " +
          String(signalId) +
          " rule " +
          String(ruleIndex) +
          " is not an object and was skipped");

      continue;
    }

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
          String(signalId) +
          " rule " +
          String(ruleIndex) +
          " has invalid value and was skipped");

      continue;
    }

    const JsonArrayConst rawConditions =
        rawRule["conditions"]
            .as<JsonArrayConst>();

    if (
        rawConditions.isNull() ||
        rawConditions.size() ==
            0
    ) {
      Logger::warn(
          "SignalAutomation: signal id " +
          String(signalId) +
          " rule " +
          String(ruleIndex) +
          " has no conditions and was skipped");

      continue;
    }

    Rule rule;

    rule.value =
        static_cast<int32_t>(
            rawValue);

    bool validRule =
        true;

    size_t conditionIndex =
        0;

    for (
        JsonVariantConst rawConditionVariant :
        rawConditions
    ) {
      ++conditionIndex;

      const JsonArrayConst rawCondition =
          rawConditionVariant
              .as<JsonArrayConst>();

      if (
          rawCondition.isNull() ||
          (
              rawCondition.size() !=
                  4 &&
              rawCondition.size() !=
                  3
          )
      ) {
        Logger::warn(
            "SignalAutomation: signal id " +
            String(signalId) +
            " rule " +
            String(ruleIndex) +
            " condition " +
            String(conditionIndex) +
            " has invalid shape; rule skipped");

        validRule =
            false;

        break;
      }

      const char* source =
          rawCondition[0] |
          "";

      Condition condition;

      if (
          rawCondition.size() ==
          4
      ) {
        // Current ID-based format:
        // [source, layoutId, channel, logicalValue]
        const long conditionId =
            rawCondition[1] |
            0L;

        const int channel =
            rawCondition[2] |
            0;

        const int value =
            rawCondition[3] |
            -1;

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
          validRule =
              false;

          break;
        }

        condition.id =
            static_cast<uint16_t>(
                conditionId);

        condition.channel =
            static_cast<uint8_t>(
                channel);

        condition.value =
            value != 0;

        if (
            strcmp(
                source,
                "turnout") ==
            0
        ) {
          condition.source =
              Condition::Source::Turnout;

          if (
              !_runtime.findAccessoryById(
                  RuntimeAccessoryKind::Turnout,
                  condition.id,
                  condition.channel)
          ) {
            Logger::warn(
                "SignalAutomation: turnout condition id=" +
                String(condition.id) +
                " ch=" +
                String(condition.channel) +
                " not found; rule skipped");

            validRule =
                false;

            break;
          }
        } else if (
            strcmp(
                source,
                "sensor") ==
            0
        ) {
          condition.source =
              Condition::Source::Sensor;

          condition.channel =
              0;

          if (
              !_runtime.findSensorById(
                  condition.id)
          ) {
            Logger::warn(
                "SignalAutomation: sensor condition id=" +
                String(condition.id) +
                " not found; rule skipped");

            validRule =
                false;

            break;
          }
        } else {
          validRule =
              false;

          break;
        }
      } else {
        // Legacy/address-based format:
        // [source, dccAddress, physicalValue]
        const long address =
            rawCondition[1] |
            0L;

        const int physical =
            rawCondition[2] |
            -1;

        if (
            address <= 0 ||
            address > 0xffff ||
            (
                physical != 0 &&
                physical != 1
            )
        ) {
          validRule =
              false;

          break;
        }

        if (
            strcmp(
                source,
                "turnout") ==
            0
        ) {
          RuntimeAccessory* turnout =
              _runtime.findAccessory(
                  RuntimeAccessoryKind::Turnout,
                  static_cast<uint16_t>(
                      address));

          if (!turnout) {
            validRule =
                false;

            break;
          }

          condition.source =
              Condition::Source::Turnout;

          condition.id =
              turnout->id;

          condition.channel =
              turnout->channel;

          condition.value =
              (
                  physical !=
                  0
              ) ==
              turnout->closedValue;
        } else if (
            strcmp(
                source,
                "sensor") ==
            0
        ) {
          RuntimeSensor* sensor =
              _runtime.findSensor(
                  static_cast<uint16_t>(
                      address));

          if (!sensor) {
            validRule =
                false;

            break;
          }

          condition.source =
              Condition::Source::Sensor;

          condition.id =
              sensor->id;

          condition.channel =
              0;

          condition.value =
              physical !=
              0;
        } else {
          validRule =
              false;

          break;
        }
      }

      rule.conditions
          .push_back(
              std::move(
                  condition));
    }

    if (
        !validRule ||
        rule.conditions.size() !=
            rawConditions.size()
    ) {
      Logger::warn(
          "SignalAutomation: signal id " +
          String(signalId) +
          " rule " +
          String(ruleIndex) +
          " could not be resolved and was skipped");

      continue;
    }

    signal.rules
        .push_back(
            std::move(
                rule));
  }

  // Critical safety rule: an automation entry without a valid rule must not
  // drive the signal to its default aspect. That would overwrite manual
  // signal control (typically to STOP) even though no automation rule exists.
  if (signal.rules.empty()) {
    Logger::warn(
        "SignalAutomation: signal id " +
        String(signal.signalId) +
        " has zero valid rules; automation for this signal is disabled");

    return false;
  }

  Logger::info(
      "SignalAutomation: signal id=" +
      String(signal.signalId) +
      " address=" +
      String(signal.signalAddress) +
      " rules=" +
      String(signal.rules.size()));

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
          String(signal.signalId) +
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
          !object["version"]
               .isNull()
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

  size_t totalRules =
      0;

  for (
      const auto& signal :
      _signals
  ) {
    totalRules +=
        signal.rules.size();
  }

  Logger::info(
      "SignalAutomation: loaded " +
      String(_signals.size()) +
      " signal(s), " +
      String(totalRules) +
      " rule(s); enabled=" +
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

    if (!sensor) {
      Logger::warn(
          "SignalAutomation: sensor id=" +
          String(condition.id) +
          " disappeared from runtime");

      return false;
    }

    return
        sensor->on ==
        condition.value;
  }

  const RuntimeAccessory* turnout =
      _runtime.findAccessoryById(
          RuntimeAccessoryKind::Turnout,
          condition.id,
          condition.channel);

  if (!turnout) {
    Logger::warn(
        "SignalAutomation: turnout id=" +
        String(condition.id) +
        " ch=" +
        String(condition.channel) +
        " disappeared from runtime");

    return false;
  }

  return
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

  if (
      target &&
      signal.signalAddress != 0 &&
      target->address !=
          signal.signalAddress
  ) {
    Logger::warn(
        "SignalAutomation: signal id " +
        String(signal.signalId) +
        " resolved to wrong address " +
        String(target->address) +
        "; expected " +
        String(signal.signalAddress) +
        ", rebinding by address");

    target =
        nullptr;
  }

  if (
      !target &&
      signal.signalAddress != 0
  ) {
    target =
        _runtime.findAccessory(
            RuntimeAccessoryKind::Signal,
            signal.signalAddress);

    if (target) {
      Logger::warn(
          "SignalAutomation: apply target rebound by address " +
          String(signal.signalAddress) +
          " from rule id " +
          String(signal.signalId) +
          " to runtime id " +
          String(target->id));

      signal.signalId =
          target->id;
    }
  }

  if (!target) {
    Logger::warn(
        "SignalAutomation: target not found id=" +
        String(signal.signalId) +
        " address=" +
        String(signal.signalAddress));

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
        value > 255
    ) {
      Logger::warn(
          "SignalAutomation: invalid extended value " +
          String(value) +
          " for signal address " +
          String(target->address));

      return;
    }

    Logger::info(
        "SignalAutomation: applying extended signal id=" +
        String(signal.signalId) +
        " address=" +
        String(target->address) +
        " aspect=" +
        String(value));

    if (
        !_commandCenter
             .setSignalAspect(
                 target->address,
                 static_cast<int16_t>(
                     value))
    ) {
      Logger::warn(
          "SignalAutomation: command-center rejected extended signal address " +
          String(target->address) +
          " aspect=" +
          String(value));

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

    Logger::info(
        "SignalAutomation: applying basic signal id=" +
        String(signal.signalId) +
        " address=" +
        String(target->address) +
        " outputs=" +
        String(signal.outputs) +
        " bits=" +
        String(bits));

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
        Logger::warn(
            "SignalAutomation: command-center rejected basic output address " +
            String(
                target->address +
                index) +
            " active=" +
            String(
                active
                    ? 1
                    : 0));

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
