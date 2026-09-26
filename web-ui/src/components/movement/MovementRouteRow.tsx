import {
  ActionIcon,
  Badge,
  Button,
  Card,
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

import type {
  MovementAction,
  MovementBlockRule,
} from "../../domain/movement";

import {
  createMovementId,
} from "../../domain/movement";

import type {
  AutomationSensorOption,
} from "../../services/automationSensorCatalog";

import type {
  MovementPlanResource,
} from "../../services/movementPlan";

import MovementActionEditor from "./MovementActionEditor";

type Props = {
  resource:
    MovementPlanResource;
  index: number;
  isSource: boolean;
  isDestination: boolean;
  rule:
    MovementBlockRule | null;
  sensorCatalog:
    AutomationSensorOption[];
  actions:
    MovementAction[];
  onRuleChange: (
    rule:
      MovementBlockRule
  ) => void;
  onActionsChange: (
    actions:
      MovementAction[]
  ) => void;
};

function resourceColor(
  resource:
    MovementPlanResource,
  isSource: boolean,
  isDestination: boolean
): string {
  if (isSource) {
    return "blue";
  }

  if (isDestination) {
    return "green";
  }

  if (
    resource.kind ===
    "turnout"
  ) {
    return "orange";
  }

  if (
    resource.kind ===
    "segment"
  ) {
    return "cyan";
  }

  return "violet";
}

function resourceBadge(
  resource:
    MovementPlanResource,
  isSource: boolean,
  isDestination: boolean
): string {
  if (isSource) {
    return "FROM";
  }

  if (isDestination) {
    return "TO";
  }

  if (
    resource.kind ===
    "block"
  ) {
    return "BLOCK";
  }

  if (
    resource.kind ===
    "turnout"
  ) {
    return "TURNOUT";
  }

  return "SEGMENT";
}

export default function MovementRouteRow({
  resource,
  index,
  isSource,
  isDestination,
  rule,
  sensorCatalog,
  actions,
  onRuleChange,
  onActionsChange,
}: Props) {
  const conditions =
    rule?.arrivedWhen ??
    [];

  const usedSensorAddresses =
    new Set(
      conditions.map(
        condition =>
          condition.sensor
      )
    );

  const nextAvailableSensor =
    sensorCatalog.find(
      sensor =>
        !usedSensorAddresses.has(
          sensor.address
        )
    ) ??
    null;

  return (
    <div
      className="movement-route-row"
    >
      <div
        className="movement-route-spine"
      >
        <div
          className={
            "movement-route-dot" +
            (
              isSource
                ? " is-source"
                : isDestination
                  ? " is-destination"
                  : ""
            )
          }
        >
          {
            index + 1
          }
        </div>

        <div
          className="movement-route-line"
        />
      </div>

      <Card
        withBorder
        p="sm"
        className="movement-route-resource"
      >
        <Stack
          gap={6}
        >
          <Group
            gap="xs"
            wrap="wrap"
          >
            <Text
              fw={700}
            >
              {
                resource.label
              }
            </Text>

            <Badge
              size="sm"
              variant="light"
              color={
                resourceColor(
                  resource,
                  isSource,
                  isDestination
                )
              }
            >
              {
                resourceBadge(
                  resource,
                  isSource,
                  isDestination
                )
              }
            </Badge>
          </Group>

          {
            resource.kind ===
              "block" && (
              <Text
                size="xs"
                c="dimmed"
              >
                Block ID #{resource.blockId}
                {
                  resource.sensorAddress
                    ? ` · occupancy sensor ${resource.sensorAddress}`
                    : ""
                }
              </Text>
            )
          }

          {
            resource.kind ===
              "segment" && (
              <Text
                size="xs"
                c="dimmed"
              >
                {
                  resource.detectors.length >
                    0
                    ? `Detectors: ${resource.detectors.join(", ")}`
                    : "No detector in this segment"
                }
              </Text>
            )
          }

          {
            resource.kind ===
              "turnout" && (
              <Text
                size="xs"
                c="dimmed"
              >
                {
                  resource.turnoutStates.length >
                    0
                    ? resource.turnoutStates
                        .map(
                          state =>
                            `#${state.address} ${state.closed ? "CLOSED" : "THROWN"}`
                        )
                        .join(" · ")
                    : "Physical turnout passage"
                }
              </Text>
            )
          }
        </Stack>
      </Card>

      <Card
        withBorder
        p="sm"
        className="movement-route-condition"
      >
        {
          resource.kind !==
            "block"
            ? (
              <Stack
                gap={4}
              >
                <Text
                  size="sm"
                  fw={600}
                >
                  Runtime event source
                </Text>

                <Text
                  size="xs"
                  c="dimmed"
                >
                  {
                    resource.kind ===
                    "segment"
                      ? "Segment ENTER / LEAVE actions are tied to this physical route section."
                      : "Turnout APPROACH / LEAVE actions never change the turnout state."
                  }
                </Text>
              </Stack>
            )
            : isSource
              ? (
                <Stack
                  gap={4}
                >
                  <Text
                    size="sm"
                    fw={600}
                  >
                    Departure authority
                  </Text>

                  <Text
                    size="xs"
                    c="dimmed"
                  >
                    Movement starts with the locomotive assigned to this block.
                  </Text>
                </Stack>
              )
              : (
                <Stack
                  gap="xs"
                >
                  <Group
                    justify="space-between"
                    align="center"
                  >
                    <Text
                      size="sm"
                      fw={600}
                    >
                      Block arrived when
                    </Text>

                    <Button
                      size="compact-xs"
                      variant="light"
                      leftSection={
                        <IconPlus
                          size={13}
                        />
                      }
                      disabled={
                        nextAvailableSensor ===
                        null
                      }
                      onClick={
                        () => {
                          if (
                            nextAvailableSensor ===
                            null ||
                            resource.blockId ===
                            null
                          ) {
                            return;
                          }

                          onRuleChange({
                            blockId:
                              resource.blockId,
                            arrivedWhen: [
                              ...conditions,
                              {
                                id:
                                  createMovementId(
                                    "condition"
                                  ),
                                sensor:
                                  nextAvailableSensor.address,
                                state: true,
                              },
                            ],
                          });
                        }
                      }
                    >
                      Sensor
                    </Button>
                  </Group>

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

                  {
                    conditions.length ===
                      0 && (
                      <Text
                        size="xs"
                        c="dimmed"
                      >
                        Default: destination occupancy ON and previous block occupancy OFF when both sensors exist.
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
                                  null ||
                                  resource.blockId ===
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

                                onRuleChange({
                                  blockId:
                                    resource.blockId,
                                  arrivedWhen:
                                    conditions.map(
                                      current =>
                                        current.id ===
                                        condition.id
                                          ? {
                                              ...current,
                                              sensor,
                                            }
                                          : current
                                    ),
                                });
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
                              event => {
                                if (
                                  resource.blockId ===
                                  null
                                ) {
                                  return;
                                }

                                onRuleChange({
                                  blockId:
                                    resource.blockId,
                                  arrivedWhen:
                                    conditions.map(
                                      current =>
                                        current.id ===
                                        condition.id
                                          ? {
                                              ...current,
                                              state:
                                                event.currentTarget.checked,
                                            }
                                          : current
                                    ),
                                });
                              }
                            }
                          />

                          <ActionIcon
                            size="sm"
                            variant="light"
                            color="red"
                            onClick={
                              () => {
                                if (
                                  resource.blockId ===
                                  null
                                ) {
                                  return;
                                }

                                onRuleChange({
                                  blockId:
                                    resource.blockId,
                                  arrivedWhen:
                                    conditions.filter(
                                      current =>
                                        current.id !==
                                        condition.id
                                    ),
                                });
                              }
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
              )
        }
      </Card>

      <Card
        withBorder
        p="sm"
        className="movement-route-actions"
      >
        <MovementActionEditor
          resourceKey={
            resource.key
          }
          resourceKind={
            resource.kind
          }
          actions={
            actions
          }
          onChange={
            onActionsChange
          }
        />
      </Card>
    </div>
  );
}
