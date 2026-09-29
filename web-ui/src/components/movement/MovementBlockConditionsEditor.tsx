import {
  useState,
} from "react";

import {
  ActionIcon,
  Badge,
  Button,
  Collapse,
  Group,
  Select,
  Stack,
  Switch,
  Text,
} from "@mantine/core";

import {
  IconChevronDown,
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

import {
  useMovementTranslation,
} from "./movementI18n";

type ConditionField =
  | "approachWhen"
  | "arrivedWhen"
  | "departWhen"
  | "leaveWhen";

type Props = {
  blockId: number;
  isSource: boolean;
  isDestination: boolean;
  rule:
    MovementBlockRule | null;
  defaultRule?:
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
    approachWhen: [],
    arrivedWhen: [],
    departWhen: [],
    leaveWhen: [],
  };
}

export default function MovementBlockConditionsEditor({
  blockId,
  isSource,
  isDestination,
  rule,
  defaultRule = null,
  sensorCatalog,
  onChange,
}: Props) {
  const mt =
    useMovementTranslation();

  const [
    collapsedSections,
    setCollapsedSections,
  ] =
    useState<
      Set<ConditionField>
    >(
      () =>
        new Set<
          ConditionField
        >()
    );

  const toggleSection =
    (
      field:
        ConditionField
    ): void => {
      setCollapsedSections(
        current => {
          const next =
            new Set(
              current
            );

          if (
            next.has(
              field
            )
          ) {
            next.delete(
              field
            );
          } else {
            next.add(
              field
            );
          }

          return next;
        }
      );
    };

  const current =
    rule ??
    emptyRule(
      blockId
    );

  const sections:
    EventSection[] = [];

  if (
    !isSource
  ) {
    sections.push({
      field:
        "approachWhen",
      title:
        mt("movementApproachWhen"),
      badge:
        mt("movementEventApproach"),
      description:
        mt("movementApproachDefault"),
    });

    sections.push({
      field:
        "arrivedWhen",
      title:
        mt("movementArrivedWhen"),
      badge:
        mt("movementEventArrived"),
      description:
        mt("movementArrivedDefault"),
    });
  }

  if (
    !isDestination
  ) {
    sections.push({
      field:
        "departWhen",
      title:
        mt("movementDepartWhen"),
      badge:
        mt("movementEventDepart"),
      description:
        mt("movementDepartDefault"),
    });

    sections.push({
      field:
        "leaveWhen",
      title:
        mt("movementLeaveWhen"),
      badge:
        mt("movementEventLeave"),
      description:
        mt("movementLeaveDefault"),
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
          conditions.map(
            condition => ({
              ...condition,
              id:
                condition.id.startsWith(
                  "auto-"
                )
                  ? createMovementId(
                      "condition"
                    )
                  : condition.id,
            })
          ),
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
            const configuredConditions =
              current[
                section.field
              ];

            const usingDefault =
              configuredConditions.length ===
              0;

            const conditions =
              usingDefault
                ? defaultRule?.[
                    section.field
                  ] ??
                  []
                : configuredConditions;

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
                className={
                  "movement-inner-step-row movement-condition-step-row" +
                  (
                    sectionIndex ===
                    sections.length - 1
                      ? " is-last"
                      : ""
                  )
                }
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

                    <Badge
                      size="xs"
                      variant="light"
                      color={
                        usingDefault
                          ? "gray"
                          : "blue"
                      }
                    >
                      {
                        usingDefault
                          ? mt("movementDefaultUpper")
                          : mt("movementCustomUpper")
                      }
                    </Badge>
                  </Group>

                  <Group
                    gap={4}
                    wrap="nowrap"
                  >
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    onClick={
                      () =>
                        toggleSection(
                          section.field
                        )
                    }
                  >
                    <IconChevronDown
                      size={15}
                      style={{
                        transform:
                          collapsedSections.has(
                            section.field
                          )
                            ? "rotate(-90deg)"
                            : "rotate(0deg)",
                        transition:
                          "transform 150ms ease",
                      }}
                    />
                  </ActionIcon>

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
                    {mt("movementSensorWord")}
                  </Button>
                  </Group>
                </Group>

                <Collapse
                  expanded={
                    !collapsedSections.has(
                      section.field
                    )
                  }
                >
                <Stack
                  gap={6}
                >
                {
                  conditions.length ===
                    0 && (
                    <Group
                      gap="xs"
                      p={6}
                      className="movement-default-condition-row"
                    >
                      <Badge
                        size="xs"
                        variant="light"
                        color="gray"
                      >
                        {mt("movementDefaultUpper")}
                      </Badge>

                      <Text
                        size="xs"
                        c="dimmed"
                      >
                        {
                          section.description
                        }
                      </Text>
                    </Group>
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
                                        mt("movementMissingSensor", { address: condition.sensor }),
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
                              ? mt("movementOn")
                              : mt("movementOff")
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
                </Collapse>
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
            {mt("movementNoConfiguredSensors")}
          </Text>
        )
      }
    </Stack>
  );
}
