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
  type MovementConditionMatch,
  type MovementResourceEventName,
  type MovementResourceEventRule,
  type MovementSensorCondition,
} from "../../domain/movement";

import type {
  AutomationSensorOption,
} from "../../services/automationSensorCatalog";

import {
  effectiveMovementResourceEventRule,
  materializeMovementResourceEventRule,
  resourceEventNames,
} from "../../services/movementResourceEvents";

import type {
  MovementPlanResource,
} from "../../services/movementPlan";

type Props = {
  resource:
    MovementPlanResource;
  rules:
    MovementResourceEventRule[];
  sensorCatalog:
    AutomationSensorOption[];
  onChange: (
    rules:
      MovementResourceEventRule[]
  ) => void;
};

function eventLabel(
  event:
    MovementResourceEventName
): string {
  return event.toUpperCase();
}

function eventDescription(
  resource:
    MovementPlanResource,
  event:
    MovementResourceEventName
): string {
  if (
    event ===
      "leave"
  ) {
    return resource.detectors.length >
      1
      ? "Default: ALL assigned sensors are OFF."
      : "Default: assigned sensor is OFF.";
  }

  return resource.detectors.length >
    1
    ? "Default: ANY assigned sensor is ON."
    : "Default: assigned sensor is ON.";
}

export default function MovementResourceEventConditionsEditor({
  resource,
  rules,
  sensorCatalog,
  onChange,
}: Props) {
  const events =
    resourceEventNames(
      resource
    );

  const commitRule =
    (
      next:
        MovementResourceEventRule
    ): void => {
      const materialized =
        materializeMovementResourceEventRule(
          next
        );

      onChange([
        ...rules.filter(
          rule =>
            !(
              rule.resourceKey ===
                materialized.resourceKey &&
              rule.event ===
                materialized.event
            )
        ),
        materialized,
      ]);
    };

  const updateConditions =
    (
      rule:
        MovementResourceEventRule,
      conditions:
        MovementSensorCondition[]
    ): void => {
      commitRule({
        ...rule,
        conditions,
      });
    };

  if (
    events.length ===
      0
  ) {
    return null;
  }

  return (
    <Stack
      gap="sm"
    >
      {
        events.map(
          event => {
            const explicit =
              rules.some(
                rule =>
                  rule.resourceKey ===
                    resource.key &&
                  rule.event ===
                    event
              );

            const rule =
              effectiveMovementResourceEventRule(
                rules,
                resource,
                event
              );

            const used =
              new Set(
                rule.conditions.map(
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
              <Stack
                key={
                  event
                }
                gap={6}
                p="xs"
                className="movement-block-event-condition"
              >
                <Group
                  justify="space-between"
                  align="center"
                  wrap="wrap"
                >
                  <Group
                    gap="xs"
                  >
                    <Text
                      size="sm"
                      fw={700}
                    >
                      {
                        eventLabel(
                          event
                        )
                      }
                    </Text>

                    <Badge
                      size="xs"
                      variant="light"
                      color={
                        explicit
                          ? "blue"
                          : "gray"
                      }
                    >
                      {
                        explicit
                          ? "CUSTOM"
                          : "DEFAULT"
                      }
                    </Badge>
                  </Group>

                  <Group
                    gap={6}
                  >
                    <Select
                      size="xs"
                      w={92}
                      allowDeselect={
                        false
                      }
                      value={
                        rule.match
                      }
                      data={[
                        {
                          value:
                            "all",
                          label:
                            "ALL",
                        },
                        {
                          value:
                            "any",
                          label:
                            "ANY",
                        },
                      ]}
                      onChange={
                        value => {
                          if (
                            value !==
                              "all" &&
                            value !==
                              "any"
                          ) {
                            return;
                          }

                          commitRule({
                            ...rule,
                            match:
                              value as
                                MovementConditionMatch,
                          });
                        }
                      }
                    />

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
                          if (!nextSensor) {
                            return;
                          }

                          updateConditions(
                            rule,
                            [
                              ...rule.conditions,
                              {
                                id:
                                  createMovementId(
                                    "condition"
                                  ),
                                sensor:
                                  nextSensor.address,
                                state:
                                  event !==
                                  "leave",
                              },
                            ]
                          );
                        }
                      }
                    >
                      Sensor
                    </Button>
                  </Group>
                </Group>

                <Text
                  size="xs"
                  c="dimmed"
                >
                  {
                    eventDescription(
                      resource,
                      event
                    )
                  }
                </Text>

                {
                  rule.conditions.length ===
                    0 && (
                    <Text
                      size="xs"
                      c="orange"
                    >
                      No sensor condition. The legacy Movement resource boundary is used.
                    </Text>
                  )
                }

                {
                  rule.conditions.map(
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
                                  !rule.conditions.some(
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
                          onChange={
                            value => {
                              if (!value) {
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

                              updateConditions(
                                rule,
                                rule.conditions.map(
                                  current =>
                                    current.id ===
                                    condition.id
                                      ? {
                                          ...current,
                                          sensor,
                                        }
                                      : current
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
                            e =>
                              updateConditions(
                                rule,
                                rule.conditions.map(
                                  current =>
                                    current.id ===
                                    condition.id
                                      ? {
                                          ...current,
                                          state:
                                            e.currentTarget.checked,
                                        }
                                      : current
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
                              updateConditions(
                                rule,
                                rule.conditions.filter(
                                  current =>
                                    current.id !==
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
            );
          }
        )
      }
    </Stack>
  );
}
