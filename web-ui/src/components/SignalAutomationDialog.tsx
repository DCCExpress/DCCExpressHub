import { useTranslation } from "react-i18next";
import i18next from "i18next";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  ScrollArea,
  Select,
  Stack,
  TextInput,
  Table,
  Text,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconDeviceFloppy,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import {
  loadSignalLogicRulesWs,
  saveSignalLogicRulesWs,
} from "@/api/signalLogicWsApi";
import AppModal from "@/components/common/AppModal";
import { generateId } from "@/helpers";
import {
  isTurnoutElement,
  type LayoutView,
} from "@/models/editor/core/LayoutView";
import { TrackElement } from "../models/editor/core/TrackElement";
import { TrackLevelCrossingElement } from "../models/editor/elements/TrackLevelCrossingElement";
import { TrackSignalElement } from "../models/editor/elements/TrackSignalElement";
import TrackTurnoutDoubleElement from "../models/editor/elements/TrackTurnoutDoubleElement";
import { TrackTurnoutThreeWayElement } from "../models/editor/elements/TrackTurnoutThreeWayElement";
import type { LayoutElementId } from "@domain/layout/layoutDto";
import type {
  SignalLogicConditionDto,
  SignalLogicDocumentDto,
  SignalLogicKnownSignal,
  SignalLogicRuleDto,
  SignalLogicRuleGroupDto,
  SignalLogicValidationIssue,
} from "@domain/signalLogic";
import {
  migrateSignalLogicReferences,
  validateSignalLogicDocument,
} from "@domain/signalLogic";

type SignalAutomationDialogProps = {
  opened: boolean;
  onClose: () => void;
  layout: LayoutView;
  signalId: LayoutElementId;
};

type Option = { value: string; label: string };

function optionalUserElementName(
  name: string | undefined
): string {
  const value = (name ?? "").trim();

  if (
    !value ||
    value === "element" ||
    value.toLowerCase().startsWith("trackturnout")
  ) {
    return "";
  }

  return ` · ${value}`;
}

type SignalOption = Option & {
  id: LayoutElementId;
  address: number;
  kind: "signal" | "level-crossing";
  states: NonNullable<SignalLogicKnownSignal["states"]>;
};

type TurnoutOption = Option & {
  id: LayoutElementId;
  address: number;
  channel: 0 | 1;
};

type TurnoutLogicalState = {
  value: string;
  label: string;
  first: boolean;
  second?: boolean;
};

type TurnoutLogicalOption = Option & {
  id: LayoutElementId;
  kind: "single" | "double" | "threeway";
  address1: number;
  address2?: number;
  states: TurnoutLogicalState[];
};

type SensorOption = Option & {
  id: LayoutElementId;
  address: number;
};


function parseLayoutId(value: string | null): LayoutElementId {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 0xffff
    ? parsed
    : 0;
}

function newLogicalTurnoutConditions(
  option: TurnoutLogicalOption
): SignalLogicConditionDto[] {
  const state = option.states[0];

  if (!state) {
    return [];
  }

  const first: SignalLogicConditionDto = {
    id: generateId(),
    type: "turnout",
    turnoutId: option.id,
    turnoutChannel: 0,
    turnoutAddress: option.address1,
    closed: state.first,
  };

  if (
    option.kind === "single" ||
    option.address2 === undefined ||
    state.second === undefined
  ) {
    return [first];
  }

  return [
    first,
    {
      id: generateId(),
      type: "turnout",
      turnoutId: option.id,
      turnoutChannel: 1,
      turnoutAddress: option.address2,
      closed: state.second,
    },
  ];
}

function logicalStateValue(
  option: TurnoutLogicalOption,
  conditions: SignalLogicConditionDto[]
): string {
  const first = conditions.find(
    condition =>
      condition.type === "turnout" &&
      condition.turnoutId === option.id &&
      (condition.turnoutChannel ?? 0) === 0
  );

  const second = conditions.find(
    condition =>
      condition.type === "turnout" &&
      condition.turnoutId === option.id &&
      (condition.turnoutChannel ?? 0) === 1
  );

  const state = option.states.find(item =>
    item.first ===
      (first?.type === "turnout" ? first.closed : false) &&
    (
      item.second === undefined ||
      item.second ===
        (second?.type === "turnout" ? second.closed : false)
    )
  );

  return state?.value ?? option.states[0]?.value ?? "";
}

function normalizeRuleConditions(
  rule: SignalLogicRuleDto
): SignalLogicRuleDto {
  const seen = new Set<string>();
  const conditions: SignalLogicConditionDto[] = [];

  for (const condition of rule.conditions) {
    const key =
      condition.type === "sensor"
        ? `sensor:${condition.sensorId}`
        : `turnout:${condition.turnoutId}:${condition.turnoutChannel ?? 0}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    conditions.push(condition);
  }

  return {
    ...rule,
    conditions,
  };
}

function newSensorCondition(option: SensorOption): SignalLogicConditionDto {
  return {
    id: generateId(),
    type: "sensor",
    sensorId: option.id,
    sensorAddress: option.address,
    active: true,
  };
}

function stateOptions(signal: SignalOption | undefined): Option[] {
  return signal?.states.map(state => ({
    value: state.id,
    label: state.label,
  })) ?? [];
}

export default function SignalAutomationDialog({
  opened,
  onClose,
  layout,
  signalId,
}: SignalAutomationDialogProps) {
  useTranslation();
  const [document, setDocument] =
    useState<SignalLogicDocumentDto | null>(null);

  const [group, setGroup] =
    useState<SignalLogicRuleGroupDto | null>(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] =
    useState<string | null>(null);
  const [error, setError] =
    useState<string | null>(null);
  const [migrationIssues, setMigrationIssues] =
    useState<SignalLogicValidationIssue[]>([]);

  const signalOptions = useMemo<SignalOption[]>(
    () =>
      layout
        .getAllElements()
        .filter(
          (element): element is TrackSignalElement =>
            element instanceof TrackSignalElement &&
            element.signalOutput.address > 0
        )
        .map(signal => ({
          value: String(signal.id),
          label: `${
            signal instanceof TrackLevelCrossingElement
              ? "Level crossing"
              : "Signal"
          } #${signal.signalOutput.address}${
            signal.name && signal.name !== "element"
              ? ` · ${signal.name}`
              : ""
          }`,
          id: signal.id,
          address: signal.signalOutput.address,
          kind:
            signal instanceof TrackLevelCrossingElement
              ? ("level-crossing" as const)
              : ("signal" as const),
          states: signal.signalOutput.states.map(state => ({
            id: state.id,
            label: state.label,
          })),
        }))
        .sort((a, b) => a.address - b.address),
    [layout, opened]
  );

  const turnoutOptions = useMemo<TurnoutOption[]>(() => {
    const result: TurnoutOption[] = [];

    for (const turnout of layout.getAllElements()) {
      if (
        turnout instanceof TrackTurnoutDoubleElement ||
        turnout instanceof TrackTurnoutThreeWayElement
      ) {
        const turnoutKind =
          turnout instanceof TrackTurnoutThreeWayElement
            ? "W turnout"
            : "Double turnout";

        if (turnout.turnout1Address > 0) {
          result.push({
            value: `${turnout.id}:0`,
            label: i18next.t("ui.motor1", { value1: turnoutKind, value2: turnout.turnout1Address, value3: optionalUserElementName(turnout.name) }),
            id: turnout.id,
            address: turnout.turnout1Address,
            channel: 0,
          });
        }

        if (turnout.turnout2Address > 0) {
          result.push({
            value: `${turnout.id}:1`,
            label: i18next.t("ui.motor2", { value1: turnoutKind, value2: turnout.turnout2Address, value3: optionalUserElementName(turnout.name) }),
            id: turnout.id,
            address: turnout.turnout2Address,
            channel: 1,
          });
        }
      } else if (
        isTurnoutElement(turnout) &&
        turnout.turnoutAddress > 0
      ) {
        result.push({
          value: `${turnout.id}:0`,
          label: i18next.t("ui.turnout", { value1: turnout.turnoutAddress, value2: optionalUserElementName(turnout.name) }),
          id: turnout.id,
          address: turnout.turnoutAddress,
          channel: 0,
        });
      }
    }

    return result.sort((a, b) => a.address - b.address);
  }, [i18next.resolvedLanguage, layout, opened]);


  const turnoutLogicalOptions = useMemo<TurnoutLogicalOption[]>(() => {
    const result: TurnoutLogicalOption[] = [];

    for (const turnout of layout.getAllElements()) {
      if (turnout instanceof TrackTurnoutThreeWayElement) {
        if (turnout.turnout1Address <= 0 || turnout.turnout2Address <= 0) {
          continue;
        }

        const state = (
          value: "left" | "straight" | "right",
          label: string
        ): TurnoutLogicalState => {
          const bits = turnout.getBitsForPosition(value);
          return {
            value,
            label,
            // getBitsForPosition() returns the configured PHYSICAL decoder
            // values. Signal automation conditions are semantic CLOSED/THROWN,
            // because LayoutRuntime converts decoder feedback through each
            // motor's Closed Value before condition matching.
            first:
              bits.first === turnout.turnout1ClosedValue,
            second:
              bits.second === turnout.turnout2ClosedValue,
          };
        };

        result.push({
          value: String(turnout.id),
          label: i18next.t("ui.wTurnout", { value1: turnout.turnout1Address, value2: turnout.turnout2Address, value3: optionalUserElementName(turnout.name) }),
          id: turnout.id,
          kind: "threeway",
          address1: turnout.turnout1Address,
          address2: turnout.turnout2Address,
          states: [
            state("left", "Left"),
            state("straight", "Straight"),
            state("right", "Right"),
          ],
        });

        continue;
      }

      if (turnout instanceof TrackTurnoutDoubleElement) {
        if (turnout.turnout1Address <= 0 || turnout.turnout2Address <= 0) {
          continue;
        }

        const state = (
          value: "oo" | "oc" | "co" | "cc",
          label: string,
          firstPhysical: boolean,
          secondPhysical: boolean
        ): TurnoutLogicalState => ({
          value,
          label,
          // Double-turnout position names are based on the configurable
          // PHYSICAL motor table. Automation conditions, however, are stored
          // as semantic CLOSED/THROWN values. Convert both motor values with
          // their configured Closed Value before saving/matching the rule.
          first:
            firstPhysical === turnout.turnout1ClosedValue,
          second:
            secondPhysical === turnout.turnout2ClosedValue,
        });

        result.push({
          value: String(turnout.id),
          label: i18next.t("ui.doubleTurnout", { value1: turnout.turnout1Address, value2: turnout.turnout2Address, value3: optionalUserElementName(turnout.name) }),
          id: turnout.id,
          kind: "double",
          address1: turnout.turnout1Address,
          address2: turnout.turnout2Address,
          states: [
            state(
              "oo",
              "O-O",
              turnout.ooMotor1Value,
              turnout.ooMotor2Value
            ),
            state(
              "oc",
              "O-C",
              turnout.ocMotor1Value,
              turnout.ocMotor2Value
            ),
            state(
              "co",
              "C-O",
              turnout.coMotor1Value,
              turnout.coMotor2Value
            ),
            state(
              "cc",
              "C-C",
              turnout.ccMotor1Value,
              turnout.ccMotor2Value
            ),
          ],
        });

        continue;
      }

      if (
        isTurnoutElement(turnout) &&
        turnout.turnoutAddress > 0
      ) {
        result.push({
          value: String(turnout.id),
          label: i18next.t("ui.turnout", { value1: turnout.turnoutAddress, value2: optionalUserElementName(turnout.name) }),
          id: turnout.id,
          kind: "single",
          address1: turnout.turnoutAddress,
          states: [
            {
              value: "closed",
              label: i18next.t("ui.closed"),
              first: true,
            },
            {
              value: "thrown",
              label: i18next.t("ui.thrown"),
              first: false,
            },
          ],
        });
      }
    }

    return result.sort(
      (a, b) => a.address1 - b.address1
    );
  }, [i18next.resolvedLanguage, layout, opened]);

  const sensorOptions = useMemo<SensorOption[]>(() => {
    // Every TrackElement.address is a digital occupancy/sensor input.
    // A dedicated TrackSensorElement is only a different visual representation
    // of exactly the same kind of ON/OFF input.  Keep one canonical option per
    // physical address so repeated use of the same occupancy detector on
    // several track shapes does not create ambiguous automation entries.
    const byAddress = new Map<number, SensorOption>();

    for (const element of layout.getAllElements()) {
      if (
        !(element instanceof TrackElement) ||
        (
          element instanceof TrackSignalElement &&
          !(element instanceof TrackLevelCrossingElement)
        ) ||
        !Number.isInteger(element.address) ||
        element.address <= 0 ||
        byAddress.has(element.address)
      ) {
        continue;
      }

      byAddress.set(element.address, {
        value: String(element.id),
        label: i18next.t("ui.sensor", {
          value1: element.address,
          value2: optionalUserElementName(element.name),
        }),
        id: element.id,
        address: element.address,
      });
    }

    return Array.from(byAddress.values())
      .sort((a, b) => a.address - b.address);
  }, [i18next.resolvedLanguage, layout, opened]);

  const targetSignal = useMemo(
    () => signalOptions.find(signal => signal.id === signalId),
    [signalOptions, signalId]
  );

  const knownSignals = useMemo(
    () =>
      signalOptions.map(signal => ({
        id: signal.id,
        address: signal.address,
        states: signal.states,
      })),
    [signalOptions]
  );

  const knownTurnouts = useMemo(
    () =>
      turnoutOptions.map(turnout => ({
        id: turnout.id,
        address: turnout.address,
      })),
    [turnoutOptions]
  );

  const knownSensors = useMemo(
    () =>
      sensorOptions.map(sensor => ({
        id: sensor.id,
        address: sensor.address,
      })),
    [sensorOptions]
  );

  const mergedDocument = useMemo<SignalLogicDocumentDto | null>(() => {
    if (!document || !group) {
      return document;
    }

    const exists = document.groups.some(
      item => item.signalId === signalId
    );

    return {
      ...document,
      groups: exists
        ? document.groups.map(item =>
            item.signalId === signalId ? group : item
          )
        : [...document.groups, group],
    };
  }, [document, group, signalId]);

  const validationIssues = useMemo(
    () =>
      mergedDocument
        ? validateSignalLogicDocument(
            mergedDocument,
            knownSignals,
            knownTurnouts,
            knownSensors
          )
        : [],
    [
      mergedDocument,
      knownSignals,
      knownTurnouts,
      knownSensors,
    ]
  );

  const relevantIssues = useMemo(
    () =>
      [...migrationIssues, ...validationIssues].filter(
        issue =>
          !issue.groupId ||
          issue.groupId === group?.id
      ),
    [migrationIssues, validationIssues, group?.id]
  );

  const hasErrors = relevantIssues.some(
    issue => issue.level === "error"
  );

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const result = await loadSignalLogicRulesWs();

      const migration = migrateSignalLogicReferences(
        result.document,
        knownSignals,
        knownTurnouts,
        knownSensors
      );

      setMigrationIssues(migration.issues);

      let loadedDocument = migration.document;

      if (
        migration.migratedReferences > 0 &&
        !migration.issues.some(
          issue => issue.level === "error"
        )
      ) {
        loadedDocument =
          (
            await saveSignalLogicRulesWs(
              migration.document
            )
          ).document;
      }

      const existing = loadedDocument.groups.find(
        item => item.signalId === signalId
      );

      if (existing) {
        setDocument(loadedDocument);
        setGroup(existing);
      } else {
        const firstState = targetSignal?.states[0];

        if (!targetSignal || !firstState) {
          throw new Error(
            i18next.t("ui.thisSignalHasNoConfiguredAspectThatCanBeUsed")
          );
        }

        setDocument(loadedDocument);
        setGroup({
          id: generateId(),
          signalId,
          signalAddress: targetSignal.address,
          defaultStateId: firstState.id,
          rules: [],
        });
      }

      setMessage(
        result.created
          ? "No automation file exists yet. Save to create it."
          : null
      );
    } catch (loadError) {
      setDocument(null);
      setGroup(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : String(loadError)
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!opened) {
      return;
    }

    void load();

    // Opening is the lifecycle boundary for this editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, signalId]);

  const save = async (): Promise<void> => {
    if (!mergedDocument || !group) {
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const normalizedDocument: SignalLogicDocumentDto = {
        ...mergedDocument,
        groups: mergedDocument.groups.map(currentGroup => ({
          ...currentGroup,
          rules: currentGroup.rules.map(normalizeRuleConditions),
        })),
      };

      const result =
        await saveSignalLogicRulesWs(normalizedDocument);

      setDocument(result.document);

      const savedGroup = result.document.groups.find(
        item => item.signalId === signalId
      );

      if (savedGroup) {
        setGroup(savedGroup);
      }

      setMessage(
        targetSignal?.kind === "level-crossing"
          ? "Level crossing automation saved."
          : "Signal automation saved."
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : String(saveError)
      );
    } finally {
      setSaving(false);
    }
  };

  const updateGroup = (
    update: (
      current: SignalLogicRuleGroupDto
    ) => SignalLogicRuleGroupDto
  ): void => {
    setMessage(null);
    setGroup(current =>
      current ? update(current) : current
    );
  };

  const updateRule = (
    ruleId: string,
    update: (
      rule: SignalLogicRuleDto
    ) => SignalLogicRuleDto
  ): void =>
    updateGroup(current => ({
      ...current,
      rules: current.rules.map(rule =>
        rule.id === ruleId
          ? update(rule)
          : rule
      ),
    }));

  const updateCondition = (
    ruleId: string,
    conditionId: string,
    update: (
      condition: SignalLogicConditionDto
    ) => SignalLogicConditionDto
  ): void =>
    updateRule(ruleId, rule => ({
      ...rule,
      conditions: rule.conditions.map(condition =>
        condition.id === conditionId
          ? update(condition)
          : condition
      ),
    }));


  const replaceTurnoutConditionGroup = (
    ruleId: string,
    conditionId: string,
    option: TurnoutLogicalOption,
    stateValue?: string
  ): void => {
    updateRule(ruleId, rule => {
      const selectedState =
        option.states.find(item => item.value === stateValue) ??
        option.states[0];

      if (!selectedState) {
        return rule;
      }

      const currentIndex = rule.conditions.findIndex(
        item => item.id === conditionId
      );

      const old = rule.conditions[currentIndex];

      if (!old || old.type !== "turnout") {
        return rule;
      }

      const oldTurnoutId = old.turnoutId;

      // Remove both channels of the currently displayed multi-motor turnout.
      const remaining = rule.conditions.filter(item =>
        !(
          item.type === "turnout" &&
          item.turnoutId === oldTurnoutId
        )
      );

      const replacement: SignalLogicConditionDto[] = [
        {
          id: conditionId,
          type: "turnout",
          turnoutId: option.id,
          turnoutChannel: 0,
          turnoutAddress: option.address1,
          closed: selectedState.first,
        },
      ];

      if (
        option.kind !== "single" &&
        option.address2 !== undefined &&
        selectedState.second !== undefined
      ) {
        replacement.push({
          id: generateId(),
          type: "turnout",
          turnoutId: option.id,
          turnoutChannel: 1,
          turnoutAddress: option.address2,
          closed: selectedState.second,
        });
      }

      const insertAt = Math.max(
        0,
        Math.min(currentIndex, remaining.length)
      );

      return {
        ...rule,
        conditions: [
          ...remaining.slice(0, insertAt),
          ...replacement,
          ...remaining.slice(insertAt),
        ],
      };
    });
  };

  const updateLogicalTurnoutState = (
    ruleId: string,
    conditionId: string,
    option: TurnoutLogicalOption,
    stateValue: string
  ): void => {
    const selectedState =
      option.states.find(item => item.value === stateValue);

    if (!selectedState) {
      return;
    }

    updateRule(ruleId, rule => ({
      ...rule,
      conditions: rule.conditions.map(condition => {
        if (
          condition.type !== "turnout" ||
          condition.turnoutId !== option.id
        ) {
          return condition;
        }

        const channel = condition.turnoutChannel ?? 0;

        if (channel === 0) {
          return {
            ...condition,
            closed: selectedState.first,
          };
        }

        if (
          channel === 1 &&
          selectedState.second !== undefined
        ) {
          return {
            ...condition,
            closed: selectedState.second,
          };
        }

        return condition;
      }),
    }));
  };


  const availableSensorOptionsForRule = (
    rule: SignalLogicRuleDto,
    currentConditionId?: string
  ): SensorOption[] => {
    const used = new Set(
      rule.conditions
        .filter(
          condition =>
            condition.type === "sensor" &&
            condition.id !== currentConditionId
        )
        .map(condition =>
          condition.type === "sensor"
            ? condition.sensorId
            : 0
        )
    );

    return sensorOptions.filter(
      option => !used.has(option.id)
    );
  };

  const availableTurnoutOptionsForRule = (
    rule: SignalLogicRuleDto,
    currentConditionId?: string
  ): TurnoutLogicalOption[] => {
    let currentTurnoutId: LayoutElementId | null = null;

    if (currentConditionId) {
      const current = rule.conditions.find(
        condition => condition.id === currentConditionId
      );

      if (current?.type === "turnout") {
        currentTurnoutId = current.turnoutId;
      }
    }

    const used = new Set(
      rule.conditions
        .filter(condition => {
          if (condition.type !== "turnout") {
            return false;
          }

          if (
            currentTurnoutId !== null &&
            condition.turnoutId === currentTurnoutId
          ) {
            return false;
          }

          return true;
        })
        .map(condition =>
          condition.type === "turnout"
            ? condition.turnoutId
            : 0
        )
    );

    return turnoutLogicalOptions.filter(
      option => !used.has(option.id)
    );
  };

  const addRule = (): void => {
    if (!group) {
      return;
    }

    const firstSensor = sensorOptions[0];
    const firstTurnout = turnoutLogicalOptions[0];

    updateGroup(current => ({
      ...current,
      rules: [
        ...current.rules,
        {
          id: generateId(),
          name: `R${current.rules.length + 1}`,
          stateId:
            targetSignal?.states[0]?.id ?? "",
          conditions: firstSensor
            ? [newSensorCondition(firstSensor)]
            : firstTurnout
              ? newLogicalTurnoutConditions(firstTurnout)
              : [],
        },
      ],
    }));
  };

  return (
    <AppModal
      opened={opened}
      onClose={onClose}
      title={
        targetSignal
          ? `${
              targetSignal.kind === "level-crossing"
                ? "Level crossing automation"
                : "Signal automation"
            } · ${targetSignal.label}`
          : i18next.t("ui.signalAutomation")
      }
      size={1050}
      centered
      draggable
    >
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text fw={700}> {i18next.t("ui.automaticSignalStates")} </Text>
            <Text size="sm" c="dimmed"> {i18next.t("ui.firstMatchingRuleWinsIfNoneMatchTheDefaultState")} </Text>
          </div>

          <Group gap="xs">
            <ActionIcon
              variant="light"
              title={i18next.t("ui.refresh")}
              disabled={loading || saving}
              onClick={() => void load()}
            >
              <IconRefresh size={16} />
            </ActionIcon>

            <Button
              size="xs"
              leftSection={
                <IconDeviceFloppy size={16} />
              }
              loading={saving}
              disabled={
                loading ||
                !group ||
                hasErrors
              }
              onClick={() => void save()}
            > {i18next.t("ui.save2")} </Button>
          </Group>
        </Group>

        {loading && (
          <Group>
            <Loader size="sm" />
            <Text size="sm"> {i18next.t("ui.loadingSignalAutomation")} </Text>
          </Group>
        )}

        {error && (
          <Alert
            color="red"
            icon={
              <IconAlertTriangle size={16} />
            }
          >
            {error}
          </Alert>
        )}

        {message && (
          <Alert color="blue">
            {message}
          </Alert>
        )}

        {relevantIssues.map((issue, index) => (
          <Alert
            key={`${issue.groupId ?? "global"}-${
              issue.ruleId ?? ""
            }-${issue.conditionId ?? ""}-${index}`}
            color={
              issue.level === "error"
                ? "red"
                : "yellow"
            }
          >
            {issue.message}
          </Alert>
        ))}

        {group && targetSignal && (
          <>
            <Select
              label={i18next.t("ui.defaultState")}
              data={stateOptions(targetSignal)}
              value={group.defaultStateId}
              onChange={value => {
                if (value === null) {
                  return;
                }

                updateGroup(current => ({
                  ...current,
                  defaultStateId: value,
                }));
              }}
            />

            <Group justify="space-between">
              <Text fw={700}>{i18next.t("ui.rules")}</Text>

              <Button
                size="xs"
                variant="light"
                leftSection={
                  <IconPlus size={14} />
                }
                disabled={
                  stateOptions(targetSignal).length === 0
                }
                onClick={addRule}
              > {i18next.t("ui.addRule")} </Button>
            </Group>

            <ScrollArea
              h="58vh"
              type="auto"
              offsetScrollbars
              scrollbarSize={8}
            >
              <Box miw={1160}>
                <Table
                  striped
                  highlightOnHover
                  withTableBorder
                  withColumnBorders
                >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={72}> {i18next.t("ui.rule")} </Table.Th>
                  <Table.Th w={180}>Name</Table.Th>
                  <Table.Th w={210}> {i18next.t("ui.result")} </Table.Th>
                  <Table.Th> {i18next.t("ui.conditions")} </Table.Th>
                  <Table.Th w={60} />
                </Table.Tr>
              </Table.Thead>

              <Table.Tbody>
                {group.rules.map(
                  (rule, ruleIndex) => (
                    <Table.Tr key={rule.id}>
                      <Table.Td>
                        <Badge variant="light">
                          #{ruleIndex + 1}
                        </Badge>
                      </Table.Td>

                      <Table.Td>
                        <TextInput
                          size="xs"
                          placeholder={`R${ruleIndex + 1}`}
                          value={rule.name ?? ""}
                          onChange={event => {
                            const name = event.currentTarget.value;

                            updateRule(
                              rule.id,
                              current => ({
                                ...current,
                                name,
                              })
                            );
                          }}
                        />
                      </Table.Td>

                      <Table.Td>
                        <Select
                          size="xs"
                          data={stateOptions(
                            targetSignal
                          )}
                          value={rule.stateId}
                          onChange={value => {
                            if (value === null) {
                              return;
                            }

                            updateRule(
                              rule.id,
                              current => ({
                                ...current,
                                stateId: value,
                              })
                            );
                          }}
                        />
                      </Table.Td>

                      <Table.Td>
                        <Stack gap={6}>
                          {rule.conditions.map(
                            (
                              condition,
                              conditionIndex
                            ) => {
                              const isSensor =
                                condition.type ===
                                "sensor";

                              const logicalTurnout =
                                !isSensor
                                  ? turnoutLogicalOptions.find(
                                      option =>
                                        option.id ===
                                        condition.turnoutId
                                    )
                                  : undefined;


                              const availableSensors =
                                availableSensorOptionsForRule(
                                  rule,
                                  condition.id
                                );

                              const availableTurnouts =
                                availableTurnoutOptionsForRule(
                                  rule,
                                  condition.id
                                );

                              // Multi-motor turnouts are rendered once. Channel 1
                              // remains in the persisted rule but is edited
                              // together with channel 0 through the logical state.
                              if (
                                !isSensor &&
                                logicalTurnout &&
                                logicalTurnout.kind !== "single" &&
                                (condition.turnoutChannel ?? 0) === 1
                              ) {
                                return null;
                              }

                              const conditionValue =
                                isSensor
                                  ? String(
                                      condition.sensorId
                                    )
                                  : String(
                                      condition.turnoutId
                                    );

                              return (
                                <Box
                                  key={
                                    condition.id
                                  }
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns:
                                      "72px 120px minmax(180px, 1fr) 118px 28px",
                                    gap: 6,
                                    alignItems:
                                      "center",
                                  }}
                                >
                                  <Text
                                    size="xs"
                                    c="dimmed"
                                  > {i18next.t("ui.cond")}{" "}
                                    {conditionIndex +
                                      1}
                                  </Text>

                                  <Select
                                    size="xs"
                                    data={[
                                      {
                                        value:
                                          "turnout",
                                        label:
                                          i18next.t("ui.turnout2"),
                                      },
                                      {
                                        value:
                                          "sensor",
                                        label:
                                          i18next.t("ui.sensor2"),
                                      },
                                    ]}
                                    value={
                                      condition.type
                                    }
                                    onChange={type => {
                                      if (
                                        type === "sensor" &&
                                        (availableSensors[0] ?? sensorOptions[0])
                                      ) {
                                        const option =
                                          availableSensors[0] ?? sensorOptions[0]!;

                                        updateRule(
                                          rule.id,
                                          current => {
                                            const currentIndex =
                                              current.conditions.findIndex(
                                                item => item.id === condition.id
                                              );

                                            const old =
                                              current.conditions[currentIndex];

                                            if (!old) {
                                              return current;
                                            }

                                            const remaining =
                                              old.type === "turnout"
                                                ? current.conditions.filter(
                                                    item =>
                                                      !(
                                                        item.type === "turnout" &&
                                                        item.turnoutId === old.turnoutId
                                                      )
                                                  )
                                                : current.conditions.filter(
                                                    item => item.id !== condition.id
                                                  );

                                            const replacement = {
                                              ...newSensorCondition(option),
                                              id: condition.id,
                                            };

                                            const insertAt = Math.max(
                                              0,
                                              Math.min(
                                                currentIndex,
                                                remaining.length
                                              )
                                            );

                                            return {
                                              ...current,
                                              conditions: [
                                                ...remaining.slice(0, insertAt),
                                                replacement,
                                                ...remaining.slice(insertAt),
                                              ],
                                            };
                                          }
                                        );
                                      } else if (
                                        type === "turnout" &&
                                        (availableTurnouts[0] ?? turnoutLogicalOptions[0])
                                      ) {
                                        const option =
                                          availableTurnouts[0] ?? turnoutLogicalOptions[0]!;

                                        updateRule(
                                          rule.id,
                                          current => {
                                            const replacement =
                                              newLogicalTurnoutConditions(
                                                option
                                              );

                                            if (replacement[0]) {
                                              replacement[0] = {
                                                ...replacement[0],
                                                id: condition.id,
                                              };
                                            }

                                            return {
                                              ...current,
                                              conditions:
                                                current.conditions.flatMap(
                                                  item =>
                                                    item.id === condition.id
                                                      ? replacement
                                                      : [item]
                                                ),
                                            };
                                          }
                                        );
                                      }
                                    }}
                                  />

                                  <Select
                                    size="xs"
                                    data={
                                      isSensor
                                        ? sensorOptions
                                        : turnoutLogicalOptions
                                    }
                                    value={
                                      conditionValue
                                    }
                                    searchable
                                    onChange={value => {
                                      if (isSensor) {
                                        const id =
                                          parseLayoutId(
                                            value
                                          );

                                        const option =
                                          sensorOptions.find(
                                            item =>
                                              item.id ===
                                              id
                                          );

                                        if (option) {
                                          updateCondition(
                                            rule.id,
                                            condition.id,
                                            current =>
                                              current.type ===
                                              "sensor"
                                                ? {
                                                    ...current,
                                                    sensorId:
                                                      option.id,
                                                    sensorAddress:
                                                      option.address,
                                                  }
                                                : current
                                          );
                                        }
                                      } else {
                                        const option =
                                          turnoutLogicalOptions.find(
                                            item =>
                                              item.value ===
                                              value
                                          );

                                        if (option) {
                                          replaceTurnoutConditionGroup(
                                            rule.id,
                                            condition.id,
                                            option
                                          );
                                        }
                                      }
                                    }}
                                  />

                                  <Select
                                    size="xs"
                                    data={
                                      isSensor
                                        ? [
                                            {
                                              value: "1",
                                              label: i18next.t("ui.active"),
                                            },
                                            {
                                              value: "0",
                                              label: i18next.t("ui.inactive"),
                                            },
                                          ]
                                        : (
                                            logicalTurnout?.states.map(
                                              state => ({
                                                value: state.value,
                                                label: state.label,
                                              })
                                            ) ?? []
                                          )
                                    }
                                    value={
                                      isSensor
                                        ? (condition.active ? "1" : "0")
                                        : (
                                            logicalTurnout
                                              ? logicalStateValue(
                                                  logicalTurnout,
                                                  rule.conditions
                                                )
                                              : ""
                                          )
                                    }
                                    onChange={value => {
                                      if (value === null) {
                                        return;
                                      }

                                      if (isSensor) {
                                        updateCondition(
                                          rule.id,
                                          condition.id,
                                          current =>
                                            current.type === "sensor"
                                              ? {
                                                  ...current,
                                                  active: value === "1",
                                                }
                                              : current
                                        );
                                        return;
                                      }

                                      if (logicalTurnout) {
                                        updateLogicalTurnoutState(
                                          rule.id,
                                          condition.id,
                                          logicalTurnout,
                                          value
                                        );
                                      }
                                    }}
                                  />

                                  <ActionIcon
                                    size="sm"
                                    color="red"
                                    variant="subtle"
                                    title={i18next.t("ui.deleteCondition")}
                                    onClick={() =>
                                      updateRule(
                                        rule.id,
                                        current => ({
                                          ...current,
                                          conditions:
                                            current.conditions.filter(
                                              item =>
                                                item.id !== condition.id &&
                                                !(
                                                  condition.type === "turnout" &&
                                                  logicalTurnout &&
                                                  logicalTurnout.kind !== "single" &&
                                                  item.type === "turnout" &&
                                                  item.turnoutId === condition.turnoutId
                                                )
                                            ),
                                        })
                                      )
                                    }
                                  >
                                    <IconTrash
                                      size={14}
                                    />
                                  </ActionIcon>
                                </Box>
                              );
                            }
                          )}

                          <Button
                            size="compact-xs"
                            variant="subtle"
                            leftSection={
                              <IconPlus
                                size={13}
                              />
                            }
                            disabled={
                              sensorOptions.length === 0 &&
                              turnoutLogicalOptions.length === 0
                            }
                            onClick={() =>
                              updateRule(
                                rule.id,
                                current => {
                                  const nextSensor =
                                    availableSensorOptionsForRule(
                                      current
                                    )[0] ??
                                    sensorOptions[0];

                                  if (nextSensor) {
                                    return {
                                      ...current,
                                      conditions: [
                                        ...current.conditions,
                                        newSensorCondition(
                                          nextSensor
                                        ),
                                      ],
                                    };
                                  }

                                  const nextTurnout =
                                    availableTurnoutOptionsForRule(
                                      current
                                    )[0] ??
                                    turnoutLogicalOptions[0];

                                  if (nextTurnout) {
                                    return {
                                      ...current,
                                      conditions: [
                                        ...current.conditions,
                                        ...newLogicalTurnoutConditions(
                                          nextTurnout
                                        ),
                                      ],
                                    };
                                  }

                                  return current;
                                }
                              )
                            }
                          > {i18next.t("ui.addCondition")} </Button>
                        </Stack>
                      </Table.Td>

                      <Table.Td>
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          title={i18next.t("ui.deleteRule")}
                          onClick={() =>
                            updateGroup(
                              current => ({
                                ...current,
                                rules:
                                  current.rules.filter(
                                    item =>
                                      item.id !==
                                      rule.id
                                  ),
                              })
                            )
                          }
                        >
                          <IconTrash
                            size={15}
                          />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  )
                )}
                  </Table.Tbody>
                </Table>
              </Box>
            </ScrollArea>
          </>
        )}
      </Stack>
    </AppModal>
  );
}
