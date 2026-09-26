import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Select,
  Stack,
  Switch,
  Text,
} from "@mantine/core";

import {
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";

import {
  createMovementId,
  type MovementBlockRule,
  type MovementSensorCondition,
} from "../../domain/movement";

import type {
  AutomationSensorOption,
} from "../../services/automationSensorCatalog";

type ConditionField =
  | "departWhen"
  | "leaveWhen"
  | "arrivedWhen";

type Props = {
  blockId: number;
  isSource: boolean;
  isDestination: boolean;
  rule:
    MovementBlockRule | null;
  sensorCatalog:
    AutomationSensorOption[];
  onChange: (
    rule:
      MovementBlockRule
  ) => void;
};

type EventSection = {
  field:
    ConditionField;
  title: string;
  badge: string;
  description: string;
};

function emptyRule(
  blockId: number
): MovementBlockRule {
  return {
    blockId,
    departWhen: [],
    leaveWhen: [],
    arrivedWhen: [],
  };
}

export default function MovementBlockConditionsEditor({
  blockId,
  isSource,
  isDestination,
  rule,
  sensorCatalog,
  onChange,
}: Props) {
  const current =
    rule ??
    emptyRule(
      blockId
    );

  const sections:
    EventSection[] = [];

  if (
    !isDestination
  ) {
    sections.push({
      field:
        "departWhen",
      title:
        "Depart when",
      badge:
        "DEPART",
      description:
        "Default: depart as soon as route authority is available.",
    });

    sections.push({
      field:
        "leaveWhen",
      title:
        "Leave when",
      badge:
        "LEAVE",
      description:
        "Default: source block occupancy sensor OFF; without one, runtime block release is used.",
    });
  }

  if (
    !isSource
  ) {
    sections.push({
      field:
        "arrivedWhen",
      title:
        "Arrived when",
      badge:
        "ARRIVED",
      description:
        "Default: destination occupancy ON and previous block occupancy OFF when both sensors exist.",
    });
  }

  const updateField =
    (
      field:
        ConditionField,
      conditions:
        MovementSensorCondition[]
    ): void => {
      onChange({
        ...current,
        blockId,
        [field]:
          conditions,
      });
    };

  return (
    <Stack
      gap="sm"
    >
      {
        sections.map(
          (
            section,
            sectionIndex
          ) => {
            const conditions =
              current[
                section.field
              ];

            const used =
              new Set(
                conditions.map(
                  condition =>
                    condition.sensor
                )
              );

            const nextSensor =
              sensorCatalog.find(
                sensor =>
                  !used.has(
                    sensor.address
                  )
              ) ??
              null;

            return (
              <div
                key={
                  section.field
                }
                className="movement-inner-step-row movement-condition-step-row"
              >
                <div
                  className="movement-inner-step-spine"
                >
                  <div
                    className="movement-inner-step-dot movement-condition-step-dot"
                  >
                    {
                      sectionIndex + 1
                    }
                  </div>

                  <div
                    className="movement-inner-step-line"
                  />
                </div>

                <Stack
                  gap={6}
                  p="xs"
                  className="movement-block-event-condition"
                >
                <Group
                  justify="space-between"
                  align="center"
                  wrap="nowrap"
                  className="movement-block-event-condition-header"
                >
                  <Group
                    gap="xs"
                    wrap="nowrap"
                  >
                    <Text
                      size="sm"
                      fw={600}
                    >
                      {
                        section.title
                      }
                    </Text>

                    <Badge
                      size="xs"
                      variant="light"
                      color="gray"
                    >
                      {
                        section.badge
                      }
                    </Badge>
                  </Group>

                  <Button
                    size="compact-xs"
                    variant="light"
                    leftSection={
                      <IconPlus
                        size={13}
                      />
                    }
                    disabled={
                      nextSensor ===
                      null
                    }
                    onClick={
                      () => {
                        if (
                          nextSensor ===
                          null
                        ) {
                          return;
                        }

                        updateField(
                          section.field,
                          [
                            ...conditions,
                            {
                              id:
                                createMovementId(
                                  "condition"
                                ),
                              sensor:
                                nextSensor.address,
                              state:
                                true,
                            },
                          ]
                        );
                      }
                    }
                  >
                    Sensor
                  </Button>
                </Group>

                {
                  conditions.length ===
                    0 && (
                    <Text
                      size="xs"
                      c="dimmed"
                    >
                      {
                        section.description
                      }
                    </Text>
                  )
                }

                {
                  conditions.map(
                    condition => (
                      <Group
                        key={
                          condition.id
                        }
                        gap="xs"
                        wrap="nowrap"
                      >
                        <Select
                          size="xs"
                          value={
                            String(
                              condition.sensor
                            )
                          }
                          data={
                            (
                              sensorCatalog.some(
                                sensor =>
                                  sensor.address ===
                                  condition.sensor
                              )
                                ? sensorCatalog
                                : [
                                    {
                                      id:
                                        0,
                                      address:
                                        condition.sensor,
                                      name:
                                        "",
                                      label:
                                        `Sensor ${condition.sensor} · missing from layout`,
                                    },
                                    ...sensorCatalog,
                                  ]
                            )
                              .filter(
                                sensor =>
                                  sensor.address ===
                                    condition.sensor ||
                                  !conditions.some(
                                    other =>
                                      other.id !==
                                        condition.id &&
                                      other.sensor ===
                                        sensor.address
                                  )
                              )
                              .map(
                                sensor => ({
                                  value:
                                    String(
                                      sensor.address
                                    ),
                                  label:
                                    sensor.label,
                                  disabled:
                                    sensor.id ===
                                    0,
                                })
                              )
                          }
                          allowDeselect={
                            false
                          }
                          searchable={
                            false
                          }
                          onChange={
                            value => {
                              if (
                                value ===
                                null
                              ) {
                                return;
                              }

                              const sensor =
                                Number(
                                  value
                                );

                              if (
                                !sensorCatalog.some(
                                  option =>
                                    option.address ===
                                    sensor
                                )
                              ) {
                                return;
                              }

                              updateField(
                                section.field,
                                conditions.map(
                                  currentCondition =>
                                    currentCondition.id ===
                                    condition.id
                                      ? {
                                          ...currentCondition,
                                          sensor,
                                        }
                                      : currentCondition
                                )
                              );
                            }
                          }
                          style={{
                            flex: 1,
                          }}
                        />

                        <Switch
                          size="sm"
                          checked={
                            condition.state
                          }
                          label={
                            condition.state
                              ? "ON"
                              : "OFF"
                          }
                          onChange={
                            event =>
                              updateField(
                                section.field,
                                conditions.map(
                                  currentCondition =>
                                    currentCondition.id ===
                                    condition.id
                                      ? {
                                          ...currentCondition,
                                          state:
                                            event.currentTarget.checked,
                                        }
                                      : currentCondition
                                )
                              )
                          }
                        />

                        <ActionIcon
                          size="sm"
                          variant="light"
                          color="red"
                          onClick={
                            () =>
                              updateField(
                                section.field,
                                conditions.filter(
                                  currentCondition =>
                                    currentCondition.id !==
                                    condition.id
                                )
                              )
                          }
                        >
                          <IconTrash
                            size={14}
                          />
                        </ActionIcon>
                      </Group>
                    )
                  )
                }
                </Stack>
              </div>
            );
          }
        )
      }

      {
        sensorCatalog.length ===
          0 && (
          <Text
            size="xs"
            c="orange"
          >
            No configured sensors are available in the layout.
          </Text>
        )
      }
    </Stack>
  );
}
