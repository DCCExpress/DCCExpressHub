import {
  Alert,
  Badge,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";

import {
  IconCheck,
  IconMinus,
} from "@tabler/icons-react";

import type {
  MovementSegmentEvent,
} from "../../domain/movement";

import {
  MAX_SEGMENT_EVENT_SENSORS,
} from "../../services/movementSegmentEvents";

type Props = {
  resourceKey: string;
  sensors: number[];
  events:
    MovementSegmentEvent[];
  onChange: (
    events:
      MovementSegmentEvent[]
  ) => void;
};

export default function MovementSegmentEventMatrix({
  resourceKey,
  sensors,
  events,
  onChange,
}: Props) {
  const normalizedSensors =
    [
      ...new Set(
        sensors.filter(
          sensor =>
            Number.isInteger(
              sensor
            ) &&
            sensor >
              0
        )
      ),
    ].sort(
      (
        left,
        right
      ) =>
        left - right
    );

  const rows =
    events.filter(
      event =>
        event.resourceKey ===
        resourceKey
    );

  const duplicateNames =
    new Set<string>();

  const firstByName =
    new Map<
      string,
      string
    >();

  for (const row of rows) {
    const name =
      row.name.trim();

    if (!name) {
      continue;
    }

    const folded =
      name.toLocaleLowerCase();

    const first =
      firstByName.get(
        folded
      );

    if (first) {
      duplicateNames.add(
        first
      );

      duplicateNames.add(
        row.id
      );
    } else {
      firstByName.set(
        folded,
        row.id
      );
    }
  }

  if (
    normalizedSensors.length ===
      0
  ) {
    return (
      <Alert
        color="gray"
        variant="light"
      >
        This segment has no sensors, so no state-event matrix can be generated.
      </Alert>
    );
  }

  if (
    normalizedSensors.length >
      MAX_SEGMENT_EVENT_SENSORS
  ) {
    return (
      <Alert
        color="orange"
        variant="light"
      >
        The segment has {
          normalizedSensors.length
        } sensors. A full matrix would contain {
          2 ** normalizedSensors.length
        } rows, so automatic matrix generation is limited to {
          MAX_SEGMENT_EVENT_SENSORS
        } sensors.
      </Alert>
    );
  }

  const updateName =
    (
      eventId: string,
      name: string
    ): void => {
      onChange(
        rows.map(
          row =>
            row.id ===
            eventId
              ? {
                  ...row,
                  name,
                }
              : row
        )
      );
    };

  return (
    <Stack
      gap="sm"
    >
      <Group
        justify="space-between"
        align="flex-end"
        wrap="wrap"
      >
        <Stack
          gap={2}
        >
          <Text
            fw={700}
            size="sm"
          >
            Sensor state event matrix
          </Text>

          <Text
            size="xs"
            c="dimmed"
          >
            Every row is one complete sensor-state combination. Enter a unique event name to expose that row on the Actions tab.
          </Text>
        </Stack>

        <Badge
          variant="light"
          color="blue"
        >
          {
            rows.length
          } states
        </Badge>
      </Group>

      {
        duplicateNames.size >
          0 && (
          <Alert
            color="red"
            variant="light"
          >
            Event names must be unique inside this segment.
          </Alert>
        )
      }

      <ScrollArea
        type="auto"
      >
        <Table
          withTableBorder
          withColumnBorders
          striped
          highlightOnHover
          miw={
            220 +
            normalizedSensors.length *
              92
          }
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th
                w={58}
              >
                State
              </Table.Th>

              {
                normalizedSensors.map(
                  sensor => (
                    <Table.Th
                      key={
                        sensor
                      }
                      ta="center"
                      w={92}
                    >
                      <Stack
                        gap={0}
                        align="center"
                      >
                        <Text
                          size="xs"
                          fw={700}
                        >
                          Sensor
                        </Text>

                        <Text
                          size="xs"
                          ff="monospace"
                        >
                          {
                            sensor
                          }
                        </Text>
                      </Stack>
                    </Table.Th>
                  )
                )
              }

              <Table.Th
                miw={220}
              >
                Event name
              </Table.Th>
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {
              rows.map(
                (
                  row,
                  rowIndex
                ) => {
                  const bySensor =
                    new Map(
                      row.conditions.map(
                        condition => [
                          condition.sensor,
                          condition.state,
                        ]
                      )
                    );

                  const duplicate =
                    duplicateNames.has(
                      row.id
                    );

                  return (
                    <Table.Tr
                      key={
                        row.id
                      }
                    >
                      <Table.Td>
                        <Text
                          size="xs"
                          c="dimmed"
                          ff="monospace"
                        >
                          {
                            rowIndex
                          }
                        </Text>
                      </Table.Td>

                      {
                        normalizedSensors.map(
                          sensor => {
                            const active =
                              bySensor.get(
                                sensor
                              ) ===
                                true;

                            return (
                              <Table.Td
                                key={
                                  sensor
                                }
                                ta="center"
                              >
                                <ThemeIcon
                                  size="sm"
                                  radius="xl"
                                  variant={
                                    active
                                      ? "filled"
                                      : "light"
                                  }
                                  color={
                                    active
                                      ? "blue"
                                      : "gray"
                                  }
                                >
                                  {
                                    active
                                      ? (
                                        <IconCheck
                                          size={14}
                                        />
                                      )
                                      : (
                                        <IconMinus
                                          size={12}
                                        />
                                      )
                                  }
                                </ThemeIcon>
                              </Table.Td>
                            );
                          }
                        )
                      }

                      <Table.Td>
                        <TextInput
                          size="xs"
                          placeholder="No event"
                          value={
                            row.name
                          }
                          error={
                            duplicate
                              ? "Duplicate name"
                              : undefined
                          }
                          onChange={
                            event =>
                              updateName(
                                row.id,
                                event.currentTarget.value
                              )
                          }
                        />
                      </Table.Td>
                    </Table.Tr>
                  );
                }
              )
            }
          </Table.Tbody>
        </Table>
      </ScrollArea>

      <Text
        size="xs"
        c="dimmed"
      >
        Default: all sensors OFF = LEAVE, first sensor ON with the others OFF = ENTER. You can rename or clear either event.
      </Text>
    </Stack>
  );
}
