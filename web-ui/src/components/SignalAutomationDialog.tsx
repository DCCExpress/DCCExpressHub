import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Select,
  Stack,
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
import { TrackSensorElementView } from "@/models/editor/elements/TrackSensorElementView";
import { TrackSignalElementView } from "@/models/editor/elements/TrackSignalElementView";
import TrackTurnoutDoubleElementView from "@/models/editor/elements/TrackTurnoutDoubleElementView";
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
          (element): element is TrackSignalElementView =>
            element instanceof TrackSignalElementView &&
            element.signalOutput.address > 0
        )
        .map(signal => ({
          value: String(signal.id),
          label: `Signal #${signal.signalOutput.address}${
            signal.name && signal.name !== "element"
              ? ` · ${signal.name}`
              : ""
          }`,
          id: signal.id,
          address: signal.signalOutput.address,
          states: signal.signalOutput.states.map(state => ({
            id: state.id,
            label: state.label,
          })),
        }))
        .sort((a, b) => a.address - b.address),
    [layout]
  );

  const turnoutOptions = useMemo<TurnoutOption[]>(() => {
    const result: TurnoutOption[] = [];

    for (const turnout of layout.getAllElements()) {
      if (turnout instanceof TrackTurnoutDoubleElementView) {
        if (turnout.turnout1Address > 0) {
          result.push({
            value: `${turnout.id}:0`,
            label: `Turnout #${turnout.turnout1Address} · ch1${
              turnout.name && turnout.name !== "element"
                ? ` · ${turnout.name}`
                : ""
            }`,
            id: turnout.id,
            address: turnout.turnout1Address,
            channel: 0,
          });
        }

        if (turnout.turnout2Address > 0) {
          result.push({
            value: `${turnout.id}:1`,
            label: `Turnout #${turnout.turnout2Address} · ch2${
              turnout.name && turnout.name !== "element"
                ? ` · ${turnout.name}`
                : ""
            }`,
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
          label: `Turnout #${turnout.turnoutAddress}${
            turnout.name && turnout.name !== "element"
              ? ` · ${turnout.name}`
              : ""
          }`,
          id: turnout.id,
          address: turnout.turnoutAddress,
          channel: 0,
        });
      }
    }

    return result.sort((a, b) => a.address - b.address);
  }, [layout]);

  const sensorOptions = useMemo<SensorOption[]>(
    () =>
      layout
        .getAllElements()
        .filter(
          (element): element is TrackSensorElementView =>
            element instanceof TrackSensorElementView &&
            element.address > 0
        )
        .map(sensor => ({
          value: String(sensor.id),
          label: `Sensor #${sensor.address}${
            sensor.name && sensor.name !== "element"
              ? ` · ${sensor.name}`
              : ""
          }`,
          id: sensor.id,
          address: sensor.address,
        }))
        .sort((a, b) => a.address - b.address),
    [layout]
  );

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
            "This signal has no configured aspect that can be used as a default state."
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
          : result.message ?? "Signal automation loaded."
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
      const result =
        await saveSignalLogicRulesWs(mergedDocument);

      setDocument(result.document);

      const savedGroup = result.document.groups.find(
        item => item.signalId === signalId
      );

      if (savedGroup) {
        setGroup(savedGroup);
      }

      setMessage("Signal automation saved.");
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

  const addRule = (): void => {
    if (!group || group.rules.length >= MAX_RULES) {
      return;
    }

    const firstTurnout = turnoutOptions[0];
    const firstSensor = sensorOptions[0];

    updateGroup(current => ({
      ...current,
      rules: [
        ...current.rules,
        {
          id: generateId(),
          stateId:
            targetSignal?.states[0]?.id ?? "",
          conditions: firstTurnout
            ? [newTurnoutCondition(firstTurnout)]
            : firstSensor
              ? [newSensorCondition(firstSensor)]
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
          ? `Signal automation · ${targetSignal.label}`
          : "Signal automation"
      }
      size={1050}
      centered
      draggable
    >
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text fw={700}>
              Automatic signal states
            </Text>
            <Text size="sm" c="dimmed">
              First matching rule wins. If none match,
              the default state is used.
            </Text>
          </div>

          <Group gap="xs">
            <ActionIcon
              variant="light"
              title="Refresh"
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
            >
              Save
            </Button>
          </Group>
        </Group>

        {loading && (
          <Group>
            <Loader size="sm" />
            <Text size="sm">
              Loading signal automation…
            </Text>
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
              label="Default state"
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
              <Text fw={700}>Rules</Text>

              <Button
                size="xs"
                variant="light"
                leftSection={
                  <IconPlus size={14} />
                }
                disabled={
                  group.rules.length >= MAX_RULES
                }
                onClick={addRule}
              >
                Add rule
              </Button>
            </Group>

            <Table
              striped
              highlightOnHover
              withTableBorder
              withColumnBorders
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={72}>
                    Rule
                  </Table.Th>
                  <Table.Th w={210}>
                    Result
                  </Table.Th>
                  <Table.Th>
                    Conditions
                  </Table.Th>
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

                              const conditionValue =
                                isSensor
                                  ? String(
                                      condition.sensorId
                                    )
                                  : `${
                                      condition.turnoutId
                                    }:${
                                      condition.turnoutChannel ??
                                      0
                                    }`;

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
                                  >
                                    Cond{" "}
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
                                          "Turnout",
                                      },
                                      {
                                        value:
                                          "sensor",
                                        label:
                                          "Sensor",
                                      },
                                    ]}
                                    value={
                                      condition.type
                                    }
                                    onChange={type => {
                                      if (
                                        type ===
                                          "sensor" &&
                                        sensorOptions[0]
                                      ) {
                                        updateCondition(
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
                                        type ===
                                          "turnout" &&
                                        turnoutOptions[0]
                                      ) {
                                        updateCondition(
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
                                      isSensor
                                        ? sensorOptions
                                        : turnoutOptions
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
                                          turnoutOptions.find(
                                            item =>
                                              item.value ===
                                              value
                                          );

                                        if (option) {
                                          updateCondition(
                                            rule.id,
                                            condition.id,
                                            current =>
                                              current.type ===
                                              "turnout"
                                                ? {
                                                    ...current,
                                                    turnoutId:
                                                      option.id,
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
                                      isSensor
                                        ? [
                                            {
                                              value:
                                                "1",
                                              label:
                                                "Active",
                                            },
                                            {
                                              value:
                                                "0",
                                              label:
                                                "Inactive",
                                            },
                                          ]
                                        : [
                                            {
                                              value:
                                                "1",
                                              label:
                                                "Closed",
                                            },
                                            {
                                              value:
                                                "0",
                                              label:
                                                "Thrown",
                                            },
                                          ]
                                    }
                                    value={
                                      (
                                        isSensor
                                          ? condition.active
                                          : condition.closed
                                      )
                                        ? "1"
                                        : "0"
                                    }
                                    onChange={value =>
                                      updateCondition(
                                        rule.id,
                                        condition.id,
                                        current => {
                                          const active =
                                            value ===
                                            "1";

                                          return current.type ===
                                            "sensor"
                                            ? {
                                                ...current,
                                                active,
                                              }
                                            : {
                                                ...current,
                                                closed:
                                                  active,
                                              };
                                        }
                                      )
                                    }
                                  />

                                  <ActionIcon
                                    size="sm"
                                    color="red"
                                    variant="subtle"
                                    title="Delete condition"
                                    onClick={() =>
                                      updateRule(
                                        rule.id,
                                        current => ({
                                          ...current,
                                          conditions:
                                            current.conditions.filter(
                                              item =>
                                                item.id !==
                                                condition.id
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
                              rule.conditions
                                .length >=
                                MAX_CONDITIONS ||
                              (turnoutOptions.length ===
                                0 &&
                                sensorOptions.length ===
                                  0)
                            }
                            onClick={() =>
                              updateRule(
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
                          >
                            Add condition
                          </Button>
                        </Stack>
                      </Table.Td>

                      <Table.Td>
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          title="Delete rule"
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
          </>
        )}
      </Stack>
    </AppModal>
  );
}
