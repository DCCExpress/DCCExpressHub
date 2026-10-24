import { useTranslation } from "react-i18next";
import i18next from "i18next";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
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
import { TrackSensorElement } from "../models/editor/elements/TrackSensorElement";
import { TrackSignalElement } from "../models/editor/elements/TrackSignalElement";
import TrackTurnoutDoubleElement from "../models/editor/elements/TrackTurnoutDoubleElement";
import type { LayoutElementId } from "@domain/layout/layoutDto";
import type {
  SignalLogicConditionDto,
  SignalLogicDocumentDto,
  SignalLogicKnownSignal,
  SignalLogicRuleDto,
  SignalLogicRuleGroupDto,
  SignalLogicRuntimeStateDto,
  SignalLogicValidationIssue,
} from "@domain/signalLogic";
import {
  migrateSignalLogicReferences,
  validateSignalLogicDocument,
} from "@domain/signalLogic";

type SignalLogicDialogProps = {
  opened: boolean;
  onClose: () => void;
  layout: LayoutView;
  /**
   * When set, the existing Signal Logic editor is scoped to this one signal.
   * When omitted, opening the component acts as the global automation ON/OFF
   * command used by the Layout toolbar.
   */
  signalId?: LayoutElementId;
};

type Option = { value: string; label: string };
type SignalOption = Option & {
  id: LayoutElementId;
  address: number;
  states: NonNullable<SignalLogicKnownSignal["states"]>;
};
type TurnoutOption = Option & {
  id: LayoutElementId;
  address: number;
  channel: 0 | 1;
};
type SensorOption = Option & {
  id: LayoutElementId;
  address: number;
};

const MAX_GROUPS = 24;
const MAX_RULES = 6;
const MAX_CONDITIONS = 6;

function parseLayoutId(value: string | null): LayoutElementId {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 0xffff
    ? parsed
    : 0;
}

function newTurnoutCondition(option: TurnoutOption): SignalLogicConditionDto {
  return {
    id: generateId(),
    type: "turnout",
    turnoutId: option.id,
    turnoutChannel: option.channel,
    turnoutAddress: option.address,
    closed: true,
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
  return signal?.states.map(state => ({ value: state.id, label: state.label })) ?? [];
}

export default function SignalLogicDialog({
  opened,
  onClose,
  layout,
  signalId,
}: SignalLogicDialogProps) {
  useTranslation();
  const [groups, setGroups] = useState<SignalLogicRuleGroupDto[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<SignalLogicRuntimeStateDto>({
    running: false,
    enabled: false,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toolbarActionLoading, setToolbarActionLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [migrationIssues, setMigrationIssues] =
    useState<SignalLogicValidationIssue[]>([]);


  const isSignalScoped = signalId !== undefined;

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
          label: i18next.t("ui.signal", { value1: signal.signalOutput.address, value2: signal.name && signal.name !== "element" ? ` · ${signal.name}` : "" }),
          id: signal.id,
          address: signal.signalOutput.address,
          states: signal.signalOutput.states.map(state => ({
            id: state.id,
            label: state.label,
          })),
        }))
        .sort((a, b) => a.address - b.address),
    [i18next.resolvedLanguage, layout]
  );

  const turnoutOptions = useMemo<TurnoutOption[]>(() => {
    const result: TurnoutOption[] = [];

    for (const turnout of layout.getAllElements()) {
      if (turnout instanceof TrackTurnoutDoubleElement) {
        if (turnout.turnout1Address > 0) {
          result.push({
            value: `${turnout.id}:0`,
            label: i18next.t("ui.turnoutCh1", { value1: turnout.turnout1Address, value2: turnout.name && turnout.name !== "element" ? ` · ${turnout.name}` : "" }),
            id: turnout.id,
            address: turnout.turnout1Address,
            channel: 0,
          });
        }

        if (turnout.turnout2Address > 0) {
          result.push({
            value: `${turnout.id}:1`,
            label: i18next.t("ui.turnoutCh2", { value1: turnout.turnout2Address, value2: turnout.name && turnout.name !== "element" ? ` · ${turnout.name}` : "" }),
            id: turnout.id,
            address: turnout.turnout2Address,
            channel: 1,
          });
        }
      } else if (isTurnoutElement(turnout) && turnout.turnoutAddress > 0) {
        result.push({
          value: `${turnout.id}:0`,
          label: i18next.t("ui.turnout", { value1: turnout.turnoutAddress, value2: turnout.name && turnout.name !== "element" ? ` · ${turnout.name}` : "" }),
          id: turnout.id,
          address: turnout.turnoutAddress,
          channel: 0,
        });
      }
    }

    return result.sort((a, b) => a.address - b.address);
  }, [i18next.resolvedLanguage, layout]);

  const sensorOptions = useMemo<SensorOption[]>(
    () =>
      layout
        .getAllElements()
        .filter(
          (element): element is TrackSensorElement =>
            element instanceof TrackSensorElement && element.address > 0
        )
        .map(sensor => ({
          value: String(sensor.id),
          label: i18next.t("ui.sensor", { value1: sensor.address, value2: sensor.name && sensor.name !== "element" ? ` · ${sensor.name}` : "" }),
          id: sensor.id,
          address: sensor.address,
        }))
        .sort((a, b) => a.address - b.address),
    [i18next.resolvedLanguage, layout]
  );

  const document = useMemo<SignalLogicDocumentDto>(
    () => ({
      version: 3,
      enabled: runtime.enabled,
      groups,
    }),
    [groups, runtime.enabled]
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

  const issues = useMemo(
    () =>
      validateSignalLogicDocument(
        document,
        knownSignals,
        knownTurnouts,
        knownSensors
      ),
    [document, knownSignals, knownTurnouts, knownSensors]
  );

  const allIssues = [...migrationIssues, ...issues];
  const hasErrors = allIssues.some(issue => issue.level === "error");

  const visibleGroups = useMemo(
    () =>
      isSignalScoped
        ? groups.filter(group => group.signalId === signalId)
        : groups,
    [groups, isSignalScoped, signalId]
  );

  const selectedGroup =
    visibleGroups.find(group => group.id === selectedGroupId) ??
    visibleGroups[0] ??
    null;

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
        !migration.issues.some(issue => issue.level === "error")
      ) {
        loadedDocument = (await saveSignalLogicRulesWs(migration.document)).document;
      }

      setGroups(loadedDocument.groups);

      const initialGroup = isSignalScoped
        ? loadedDocument.groups.find(group => group.signalId === signalId)
        : loadedDocument.groups[0];

      setSelectedGroupId(initialGroup?.id ?? null);
      setRuntime(result.state);
      setMessage(
        result.message ??
          (migration.migratedReferences > 0
            ? `${migration.migratedReferences} legacy reference(s) migrated to numeric layout IDs.`
            : "Signal logic loaded.")
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  };

  const setGlobalAutomation = async (enabled: boolean): Promise<void> => {
    setToolbarActionLoading(true);

    try {
      const result = await loadSignalLogicRulesWs();
      const saved = await saveSignalLogicRulesWs({
        ...result.document,
        enabled,
      });

      setRuntime(saved.state);

      showNotification({
        color: enabled ? "green" : "gray",
        title: i18next.t("ui.signalAutomation"),
        message: enabled ? "Automation enabled." : "Automation disabled.",
      });

      onClose();
    } catch (toggleError) {
      showNotification({
        color: "red",
        title: i18next.t("ui.signalAutomation"),
        message:
          toggleError instanceof Error
            ? toggleError.message
            : String(toggleError),
      });
    } finally {
      setToolbarActionLoading(false);
    }
  };

  useEffect(() => {
    if (!opened || !isSignalScoped) {
      return;
    }

    void load();

    // The load function intentionally uses the option catalogues from
    // the current render. Opening is the lifecycle boundary for this dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, isSignalScoped, signalId]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const result = await saveSignalLogicRulesWs(document);
      setGroups(result.document.groups);
      setRuntime(result.state);
      setMessage(
        result.state.running
          ? "Rules saved. Signal logic is running."
          : "Rules saved. Signal logic is disabled."
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const updateGroup = (
    groupId: string,
    update: (group: SignalLogicRuleGroupDto) => SignalLogicRuleGroupDto
  ): void => {
    setMessage(null);
    setGroups(current =>
      current.map(group => (group.id === groupId ? update(group) : group))
    );
  };

  const updateRule = (
    groupId: string,
    ruleId: string,
    update: (rule: SignalLogicRuleDto) => SignalLogicRuleDto
  ): void =>
    updateGroup(groupId, group => ({
      ...group,
      rules: group.rules.map(rule => (rule.id === ruleId ? update(rule) : rule)),
    }));

  const updateCondition = (
    groupId: string,
    ruleId: string,
    conditionId: string,
    update: (condition: SignalLogicConditionDto) => SignalLogicConditionDto
  ): void =>
    updateRule(groupId, ruleId, rule => ({
      ...rule,
      conditions: rule.conditions.map(condition =>
        condition.id === conditionId ? update(condition) : condition
      ),
    }));

  const addGroup = (): void => {
    if (groups.length >= MAX_GROUPS) {
      return;
    }

    const used = new Set(groups.map(group => group.signalId));

    const signal = isSignalScoped
      ? signalOptions.find(item => item.id === signalId && !used.has(item.id))
      : signalOptions.find(item => !used.has(item.id));

    const firstState = signal?.states[0];

    if (!signal || !firstState) {
      return;
    }

    const group: SignalLogicRuleGroupDto = {
      id: generateId(),
      signalId: signal.id,
      defaultStateId: firstState.id,
      rules: [],
    };

    setGroups(current => [...current, group]);
    setSelectedGroupId(group.id);
  };

  const addRule = (group: SignalLogicRuleGroupDto): void => {
    if (group.rules.length >= MAX_RULES) {
      return;
    }

    const signal = signalOptions.find(item => item.id === group.signalId);
    const firstTurnout = turnoutOptions[0];

    updateGroup(group.id, current => ({
      ...current,
      rules: [
        ...current.rules,
        {
          id: generateId(),
          stateId: signal?.states[0]?.id ?? "",
          conditions: firstTurnout ? [newTurnoutCondition(firstTurnout)] : [],
        },
      ],
    }));
  };

  const deleteGroup = (groupId: string): void =>
    setGroups(current => {
      const next = current.filter(group => group.id !== groupId);

      const nextVisible = isSignalScoped
        ? next.filter(group => group.signalId === signalId)
        : next;

      setSelectedGroupId(nextVisible[0]?.id ?? null);
      return next;
    });

  const signalForGroup = selectedGroup
    ? signalOptions.find(signal => signal.id === selectedGroup.signalId)
    : undefined;

  const availableSignals = isSignalScoped
    ? signalOptions.filter(option => option.id === signalId)
    : signalOptions.filter(
        option =>
          !groups.some(
            group =>
              group.id !== selectedGroup?.id &&
              group.signalId === option.id
          )
      );

  const scopedSignal = isSignalScoped
    ? signalOptions.find(option => option.id === signalId)
    : undefined;

  if (!isSignalScoped) {
    return (
      <AppModal
        opened={opened}
        onClose={onClose}
        title={i18next.t("ui.signalAutomation")}
        size="sm"
        centered
        draggable
      >
        <Stack gap="md">
          <Text> {i18next.t("ui.whatDoYouWantToDoWithAutomaticSignalControl")} </Text>

          <Group grow>
            <Button
              color="green"
              loading={toolbarActionLoading}
              disabled={toolbarActionLoading}
              onClick={() => void setGlobalAutomation(true)}
            > {i18next.t("ui.enableAutomation")} </Button>

            <Button
              color="red"
              variant="light"
              loading={toolbarActionLoading}
              disabled={toolbarActionLoading}
              onClick={() => void setGlobalAutomation(false)}
            > {i18next.t("ui.disableAutomation")} </Button>
          </Group>

          <Button
            variant="subtle"
            color="gray"
            disabled={toolbarActionLoading}
            onClick={onClose}
          > {i18next.t("ui.cancel")} </Button>
        </Stack>
      </AppModal>
    );
  }

  return (
    <AppModal
      opened={opened}
      onClose={onClose}
      title={
        scopedSignal
          ? i18next.t("ui.signalAutomation2", { value1: scopedSignal.label })
          : i18next.t("ui.signalAutomation")
      }
      size={1150}
      centered
      draggable
    >
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text fw={700}>{i18next.t("ui.automaticSignalStates")}</Text>
            <Text size="sm" c="dimmed"> {i18next.t("ui.firstMatchingRuleWinsIfNoneMatchTheConfiguredDefault")} </Text>
          </div>

          <Group gap="xs">
            <Badge
              color={runtime.running ? "green" : "gray"}
              variant="light"
            >
              {runtime.running ? i18next.t("ui.running") : i18next.t("ui.stopped")}
            </Badge>

            <Switch
              checked={runtime.enabled}
              label={i18next.t("ui.enabled")}
              onChange={event => {
                const { checked } = event.currentTarget;
                setRuntime(current => ({
                  ...current,
                  enabled: checked,
                }));
              }}
            />

            <ActionIcon
              variant="light"
              title={i18next.t("ui.reload")}
              onClick={() => void load()}
            >
              <IconRefresh size={16} />
            </ActionIcon>

            <Button
              size="xs"
              leftSection={<IconDeviceFloppy size={16} />}
              loading={saving}
              disabled={hasErrors}
              onClick={() => void save()}
            > {i18next.t("ui.save2")} </Button>
          </Group>
        </Group>

        {loading && (
          <Group>
            <Loader size="sm" />
            <Text size="sm">{i18next.t("ui.loadingSignalRules")}</Text>
          </Group>
        )}

        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />}>
            {error}
          </Alert>
        )}

        {message && <Alert color="blue">{message}</Alert>}

        {allIssues.map((issue, index) => (
          <Alert
            key={`${issue.groupId ?? "global"}-${issue.ruleId ?? ""}-${
              issue.conditionId ?? ""
            }-${index}`}
            color={issue.level === "error" ? "red" : "yellow"}
          >
            {issue.message}
          </Alert>
        ))}

        <Group align="flex-start" wrap="nowrap">
          <Stack w={300} gap="xs">
            <Group justify="space-between">
              <Title order={5}>{i18next.t("ui.signals")}</Title>
              <ActionIcon
                variant="light"
                disabled={
                  groups.length >= MAX_GROUPS ||
                  !scopedSignal ||
                  visibleGroups.length > 0
                }
                onClick={addGroup}
                title={i18next.t("ui.addAutomationForThisSignal")}
              >
                <IconPlus size={16} />
              </ActionIcon>
            </Group>

            <ScrollArea h={520}>
              <Stack gap="xs">
                {visibleGroups.map(group => {
                  const signal = signalOptions.find(
                    option => option.id === group.signalId
                  );
                  const selected = group.id === selectedGroup?.id;
                  const selectedCardProps = selected
                    ? {
                        bg: "lime.0" as const,
                        style: {
                          cursor: "pointer",
                          borderColor: "var(--mantine-color-lime-6)",
                        },
                      }
                    : {
                        style: { cursor: "pointer" },
                      };

                  return (
                    <Card
                      key={group.id}
                      withBorder
                      p="sm"
                      {...selectedCardProps}
                      onClick={() => setSelectedGroupId(group.id)}
                    >
                      <Group justify="space-between" wrap="nowrap">
                        <Text fw={selected ? 700 : 400}>
                          {signal?.label ??
                            i18next.t("ui.missingSignalId", { value1: group.signalId })}
                        </Text>

                        <ActionIcon
                          color="red"
                          variant="subtle"
                          onClick={event => {
                            event.stopPropagation();
                            deleteGroup(group.id);
                          }}
                          title={i18next.t("ui.removeAutomationForThisSignal")}
                        >
                          <IconTrash size={15} />
                        </ActionIcon>
                      </Group>
                    </Card>
                  );
                })}
              </Stack>
            </ScrollArea>
          </Stack>

          <Stack style={{ flex: 1 }} gap="sm">
            {!selectedGroup ? (
              <Text c="dimmed"> {i18next.t("ui.addAnAutomationRuleGroupForThisSignal")} </Text>
            ) : (
              <>
                <Select
                  label={i18next.t("ui.signal2")}
                  data={availableSignals}
                  value={String(selectedGroup.signalId)}
                  disabled
                  onChange={value => {
                    const id = parseLayoutId(value);
                    const selected = signalOptions.find(
                      option => option.id === id
                    );

                    if (!selected) {
                      return;
                    }

                    updateGroup(selectedGroup.id, group => ({
                      ...group,
                      signalId: id,
                      defaultStateId: selected.states[0]?.id ?? "",
                      rules: group.rules.map(rule => ({
                        ...rule,
                        stateId: selected.states[0]?.id ?? "",
                      })),
                    }));
                  }}
                />

                <Select
                  label={i18next.t("ui.defaultState")}
                  data={stateOptions(signalForGroup)}
                  value={selectedGroup.defaultStateId}
                  onChange={value =>
                    value !== null &&
                    updateGroup(selectedGroup.id, group => ({
                      ...group,
                      defaultStateId: value,
                    }))
                  }
                />

                <Group justify="space-between">
                  <Title order={5}>{i18next.t("ui.rules")}</Title>
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconPlus size={14} />}
                    disabled={selectedGroup.rules.length >= MAX_RULES}
                    onClick={() => addRule(selectedGroup)}
                  > {i18next.t("ui.addRule")} </Button>
                </Group>

                <Table
                  striped
                  highlightOnHover
                  withTableBorder
                  withColumnBorders
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={72}>{i18next.t("ui.rule")}</Table.Th>
                      <Table.Th w={210}>{i18next.t("ui.result")}</Table.Th>
                      <Table.Th>{i18next.t("ui.conditions")}</Table.Th>
                      <Table.Th w={92} />
                    </Table.Tr>
                  </Table.Thead>

                  <Table.Tbody>
                    {selectedGroup.rules.map((rule, ruleIndex) => (
                      <Table.Tr key={rule.id}>
                        <Table.Td>
                          <Badge variant="light">#{ruleIndex + 1}</Badge>
                        </Table.Td>

                        <Table.Td>
                          <Select
                            size="xs"
                            data={stateOptions(signalForGroup)}
                            value={rule.stateId}
                            onChange={value =>
                              value !== null &&
                              updateRule(
                                selectedGroup.id,
                                rule.id,
                                current => ({
                                  ...current,
                                  stateId: value,
                                })
                              )
                            }
                          />
                        </Table.Td>

                        <Table.Td>
                          <Stack gap={6}>
                            {rule.conditions.map(
                              (condition, conditionIndex) => {
                                const isSensorCondition =
                                  condition.type === "sensor";

                                const conditionValue = isSensorCondition
                                  ? String(condition.sensorId)
                                  : `${condition.turnoutId}:${
                                      condition.turnoutChannel ?? 0
                                    }`;

                                return (
                                  <Box
                                    key={condition.id}
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns:
                                        "72px 120px minmax(180px, 1fr) 118px 28px",
                                      gap: 6,
                                      alignItems: "center",
                                    }}
                                  >
                                    <Text size="xs" c="dimmed"> {i18next.t("ui.cond")} {conditionIndex + 1}
                                    </Text>

                                    <Select
                                      size="xs"
                                      data={[
                                        {
                                          value: "turnout",
                                          label: i18next.t("ui.turnout2"),
                                        },
                                        {
                                          value: "sensor",
                                          label: i18next.t("ui.sensor2"),
                                        },
                                      ]}
                                      value={condition.type}
                                      onChange={type => {
                                        if (
                                          type === "sensor" &&
                                          sensorOptions[0]
                                        ) {
                                          updateCondition(
                                            selectedGroup.id,
                                            rule.id,
                                            condition.id,
                                            () => ({
                                              ...newSensorCondition(
                                                sensorOptions[0]!
                                              ),
                                              id: condition.id,
                                            })
                                          );
                                        } else if (
                                          type === "turnout" &&
                                          turnoutOptions[0]
                                        ) {
                                          updateCondition(
                                            selectedGroup.id,
                                            rule.id,
                                            condition.id,
                                            () => ({
                                              ...newTurnoutCondition(
                                                turnoutOptions[0]!
                                              ),
                                              id: condition.id,
                                            })
                                          );
                                        }
                                      }}
                                    />

                                    <Select
                                      size="xs"
                                      data={
                                        isSensorCondition
                                          ? sensorOptions
                                          : turnoutOptions
                                      }
                                      value={conditionValue}
                                      searchable
                                      onChange={value => {
                                        if (isSensorCondition) {
                                          const id = parseLayoutId(value);
                                          const option = sensorOptions.find(
                                            item => item.id === id
                                          );

                                          if (option) {
                                            updateCondition(
                                              selectedGroup.id,
                                              rule.id,
                                              condition.id,
                                              current =>
                                                current.type === "sensor"
                                                  ? {
                                                      ...current,
                                                      sensorId: option.id,
                                                      sensorAddress:
                                                        option.address,
                                                    }
                                                  : current
                                            );
                                          }
                                        } else {
                                          const option =
                                            turnoutOptions.find(
                                              item => item.value === value
                                            );

                                          if (option) {
                                            updateCondition(
                                              selectedGroup.id,
                                              rule.id,
                                              condition.id,
                                              current =>
                                                current.type === "turnout"
                                                  ? {
                                                      ...current,
                                                      turnoutId: option.id,
                                                      turnoutChannel:
                                                        option.channel,
                                                      turnoutAddress:
                                                        option.address,
                                                    }
                                                  : current
                                            );
                                          }
                                        }
                                      }}
                                    />

                                    <Select
                                      size="xs"
                                      data={
                                        isSensorCondition
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
                                          : [
                                              {
                                                value: "1",
                                                label: i18next.t("ui.closed"),
                                              },
                                              {
                                                value: "0",
                                                label: i18next.t("ui.thrown"),
                                              },
                                            ]
                                      }
                                      value={
                                        (
                                          isSensorCondition
                                            ? condition.active
                                            : condition.closed
                                        )
                                          ? "1"
                                          : "0"
                                      }
                                      onChange={value =>
                                        updateCondition(
                                          selectedGroup.id,
                                          rule.id,
                                          condition.id,
                                          current => {
                                            const active = value === "1";

                                            return current.type === "sensor"
                                              ? { ...current, active }
                                              : {
                                                  ...current,
                                                  closed: active,
                                                };
                                          }
                                        )
                                      }
                                    />

                                    <ActionIcon
                                      size="sm"
                                      color="red"
                                      variant="subtle"
                                      onClick={() =>
                                        updateRule(
                                          selectedGroup.id,
                                          rule.id,
                                          current => ({
                                            ...current,
                                            conditions:
                                              current.conditions.filter(
                                                item =>
                                                  item.id !== condition.id
                                              ),
                                          })
                                        )
                                      }
                                    >
                                      <IconTrash size={14} />
                                    </ActionIcon>
                                  </Box>
                                );
                              }
                            )}

                            <Button
                              size="compact-xs"
                              variant="subtle"
                              leftSection={<IconPlus size={13} />}
                              disabled={
                                rule.conditions.length >= MAX_CONDITIONS ||
                                (turnoutOptions.length === 0 &&
                                  sensorOptions.length === 0)
                              }
                              onClick={() =>
                                updateRule(
                                  selectedGroup.id,
                                  rule.id,
                                  current => ({
                                    ...current,
                                    conditions: [
                                      ...current.conditions,
                                      turnoutOptions[0]
                                        ? newTurnoutCondition(
                                            turnoutOptions[0]
                                          )
                                        : newSensorCondition(
                                            sensorOptions[0]!
                                          ),
                                    ],
                                  })
                                )
                              }
                            > {i18next.t("ui.addCondition")} </Button>
                          </Stack>
                        </Table.Td>

                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            onClick={() =>
                              updateGroup(
                                selectedGroup.id,
                                group => ({
                                  ...group,
                                  rules: group.rules.filter(
                                    item => item.id !== rule.id
                                  ),
                                })
                              )
                            }
                          >
                            <IconTrash size={15} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </>
            )}
          </Stack>
        </Group>
      </Stack>
    </AppModal>
  );
}
