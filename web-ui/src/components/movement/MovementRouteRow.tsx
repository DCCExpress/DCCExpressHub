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
  MovementBlockRule,
} from "../../domain/movement";

import {
  createMovementId,
} from "../../domain/movement";

import type {
  AutomationBlockOption,
} from "../../services/automationBlockCatalog";

import type {
  AutomationSensorOption,
} from "../../services/automationSensorCatalog";

type Props = {
  block:
    AutomationBlockOption;
  index: number;
  isSource: boolean;
  isDestination: boolean;
  rule:
    MovementBlockRule | null;
  sensorCatalog:
    AutomationSensorOption[];
  onRuleChange: (
    rule:
      MovementBlockRule
  ) => void;
};

export default function MovementRouteRow({
  block,
  index,
  isSource,
  isDestination,
  rule,
  sensorCatalog,
  onRuleChange,
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
        <Group
          justify="space-between"
          align="center"
          wrap="wrap"
        >
          <div>
            <Group
              gap="xs"
            >
              <Text
                fw={700}
              >
                {
                  block.name
                }
              </Text>

              <Badge
                size="sm"
                variant="light"
                color={
                  isSource
                    ? "blue"
                    : isDestination
                      ? "green"
                      : "violet"
                }
              >
                {
                  isSource
                    ? "FROM"
                    : isDestination
                      ? "TO"
                      : "VIA"
                }
              </Badge>
            </Group>

            <Text
              size="xs"
              c="dimmed"
            >
              Block ID #{block.id}
            </Text>
          </div>

          <Badge
            variant="outline"
            color={
              conditions.length >
                0
                ? "teal"
                : "gray"
            }
          >
            {
              isSource
                ? "Source ownership"
                : `${conditions.length} arrival condition${conditions.length === 1 ? "" : "s"}`
            }
          </Badge>
        </Group>
      </Card>

      <Card
        withBorder
        p="sm"
        className="movement-route-condition"
      >
        {
          isSource
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
                  The dispatcher will require a locomotive in the source block before movement starts.
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
                          null
                        ) {
                          return;
                        }

                        onRuleChange({
                          blockId:
                            block.id,
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
                      No explicit condition yet. The movement engine can later fall back to the block occupancy transition.
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

                              onRuleChange({
                                blockId:
                                  block.id,
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
                              onRuleChange({
                                blockId:
                                  block.id,
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
                              onRuleChange({
                                blockId:
                                  block.id,
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
        <Stack
          gap={4}
        >
          <Text
            size="sm"
            fw={600}
          >
            Actions
          </Text>

          <Text
            size="xs"
            c="dimmed"
          >
            Horn, delay, random delay, speed and audio actions will attach here in the next layer.
          </Text>
        </Stack>
      </Card>
    </div>
  );
}
