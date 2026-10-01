import {
  Accordion,
  Badge,
  Button,
  Card,
  Group,
  Table,
  ScrollArea,
  Stack,
  Switch,
  Text,
} from "@mantine/core";

import {
  useEffect,
  useState,
} from "react";

import i18next from "i18next";

import {
  clearTrainTrackingLogs,
  getTrainTrackingState,
  installTrainTrackingRuntime,
  refreshTrainTracking,
  resetTrainTrackingState,
  setTrainTrackingEnabled,
  subscribeTrainTrackingState,
  type TrainTrackingState,
} from "../../services/trainTrackingRuntime";

type Props = {
  controlStationActive: boolean;
};

function timeText(
  timestamp: number
): string {
  return new Date(
    timestamp
  ).toLocaleTimeString();
}

export default function TrainTrackingPanel({
  controlStationActive,
}: Props) {
  const [
    state,
    setState,
  ] =
    useState<TrainTrackingState>(
      getTrainTrackingState
    );

  useEffect(
    () => {
      installTrainTrackingRuntime();

      return subscribeTrainTrackingState(
        setState
      );
    },
    []
  );

  return (
    <Stack
      h="100%"
      gap="sm"
    >
      <Group
        justify="space-between"
        align="center"
      >
        <Group gap="sm">
          <Switch
            checked={
              state.enabled
            }
            disabled={
              !controlStationActive ||
              !state.ready
            }
            label={
              i18next.t(
                "ui.trainTrackingEnabled",
                {
                  defaultValue:
                    "Enable train tracking",
                }
              )
            }
            onChange={
              event =>
                setTrainTrackingEnabled(
                  event.currentTarget.checked
                )
            }
          />

          <Badge
            color={
              state.active
                ? "green"
                : "gray"
            }
            variant="light"
          >
            {
              state.active
                ? i18next.t(
                    "ui.trainTrackingActive",
                    {
                      defaultValue:
                        "Active",
                    }
                  )
                : i18next.t(
                    "ui.trainTrackingInactive",
                    {
                      defaultValue:
                        "Inactive",
                    }
                  )
            }
          </Badge>

          <Badge
            color={
              state.ready
                ? "blue"
                : "yellow"
            }
            variant="light"
          >
            {
              state.ready
                ? i18next.t(
                    "ui.trainTrackingReady",
                    {
                      defaultValue:
                        "Graph ready",
                    }
                  )
                : i18next.t(
                    "ui.trainTrackingNotReady",
                    {
                      defaultValue:
                        "Graph not ready",
                    }
                  )
            }
          </Badge>
        </Group>

        <Group gap="xs">
          <Button
            size="xs"
            variant="light"
            disabled={
              !controlStationActive
            }
            onClick={
              refreshTrainTracking
            }
          >
            {
              i18next.t(
                "ui.refresh",
                {
                  defaultValue:
                    "Refresh",
                }
              )
            }
          </Button>

          <Button
            size="xs"
            variant="light"
            color="orange"
            disabled={
              !state.active
            }
            onClick={
              resetTrainTrackingState
            }
          >
            {
              i18next.t(
                "ui.trainTrackingReset",
                {
                  defaultValue:
                    "Reset tracking",
                }
              )
            }
          </Button>

          <Button
            size="xs"
            variant="subtle"
            color="gray"
            onClick={
              clearTrainTrackingLogs
            }
          >
            {
              i18next.t(
                "ui.clear",
                {
                  defaultValue:
                    "Clear log",
                }
              )
            }
          </Button>
        </Group>
      </Group>

      {!controlStationActive && (
        <Text
          size="xs"
          c="dimmed"
        >
          {
            i18next.t(
              "ui.trainTrackingControlStationOnly",
              {
                defaultValue:
                  "Train tracking runs only on the active Control Station.",
              }
            )
          }
        </Text>
      )}

      {
        controlStationActive &&
        !state.ready &&
        state.readinessIssues.length > 0 &&
        (
          <Card
            withBorder
            p="xs"
            radius="sm"
          >
            <Stack gap={3}>
              <Text
                size="xs"
                fw={700}
                c="orange"
              >
                {
                  i18next.t(
                    "ui.trainTrackingRequirementsMissing",
                    {
                      defaultValue:
                        "Tracking cannot be enabled yet:",
                    }
                  )
                }
              </Text>

              {
                state.readinessIssues.map(
                  issue => (
                    <Text
                      key={
                        issue
                      }
                      size="xs"
                      ff="monospace"
                    >
                      • {issue}
                    </Text>
                  )
                )
              }
            </Stack>
          </Card>
        )
      }

      {
        controlStationActive &&
        state.readinessWarnings.length > 0 &&
        (
          <Accordion
            variant="contained"
            radius="sm"
          >
            <Accordion.Item value="tracking-recommendations">
              <Accordion.Control>
                <Group
                  gap="xs"
                  wrap="nowrap"
                >
                  <Text
                    size="xs"
                    fw={700}
                  >
                    {
                      i18next.t(
                        "ui.trainTrackingRecommendations",
                        {
                          defaultValue:
                            "Recommendations",
                        }
                      )
                    }
                  </Text>

                  <Badge
                    size="xs"
                    variant="light"
                    color="yellow"
                  >
                    {
                      state.readinessWarnings.length
                    }
                  </Badge>
                </Group>
              </Accordion.Control>

              <Accordion.Panel>
                <Stack gap={3}>
                  {
                    state.readinessWarnings.map(
                      warning => (
                        <Text
                          key={
                            warning
                          }
                          size="xs"
                          ff="monospace"
                        >
                          • {warning}
                        </Text>
                      )
                    )
                  }
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        )
      }

      <Text
        size="xs"
        c="dimmed"
      >
        {
          i18next.t(
            "ui.trainTrackingDescription",
            {
              defaultValue:
                "The Hub tracks each locomotive through route sensors using the saved graph, live turnout states and locomotive direction. A block assignment anchors the locomotive to that block's occupancy sensor. Ambiguous matches are logged and never assigned automatically.",
            }
          )
        }
      </Text>

      <Stack gap={4}>
        <Text
          size="sm"
          fw={700}
        >
          {
            i18next.t(
              "ui.trainTrackingLocomotives",
              {
                defaultValue:
                  "Tracked locomotives",
              }
            )
          }
        </Text>

        {
          state.locos.length ===
            0
            ? (
              <Text
                size="xs"
                c="dimmed"
              >
                {
                  i18next.t(
                    "ui.trainTrackingNoLocomotives",
                    {
                      defaultValue:
                        "No locomotives are anchored for tracking.",
                    }
                  )
                }
              </Text>
            )
            : (
              <Table
                withTableBorder
                withColumnBorders
                verticalSpacing={3}
                horizontalSpacing="xs"
                fz="xs"
                striped
                highlightOnHover
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>
                      Loco
                    </Table.Th>

                    <Table.Th>
                      {
                        i18next.t(
                          "ui.trainTrackingBlock",
                          {
                            defaultValue:
                              "Block",
                          }
                        )
                      }
                    </Table.Th>

                    <Table.Th>
                      {
                        i18next.t(
                          "ui.trainTrackingActiveSensors",
                          {
                            defaultValue:
                              "Active sensors",
                          }
                        )
                      }
                    </Table.Th>

                    <Table.Th>
                      {
                        i18next.t(
                          "ui.trainTrackingLastSensor",
                          {
                            defaultValue:
                              "Last sensor",
                          }
                        )
                      }
                    </Table.Th>

                    <Table.Th>
                      Confidence
                    </Table.Th>

                    <Table.Th>
                      Path
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>

                <Table.Tbody>
                  {
                    state.locos.map(
                      loco => (
                        <Table.Tr
                          key={
                            loco.locoAddress
                          }
                        >
                          <Table.Td
                            fw={700}
                            ff="monospace"
                          >
                            {
                              `#${loco.locoAddress}`
                            }
                          </Table.Td>

                          <Table.Td>
                            {
                              loco.currentBlockName ??
                              "-"
                            }
                          </Table.Td>

                          <Table.Td
                            ff="monospace"
                          >
                            {
                              loco.currentSensors.length >
                                0
                                ? loco.currentSensors
                                    .map(
                                      sensor =>
                                        `#${sensor}`
                                    )
                                    .join(", ")
                                : "-"
                            }
                          </Table.Td>

                          <Table.Td
                            ff="monospace"
                          >
                            {
                              loco.lastSensor ===
                                null
                                ? "-"
                                : `#${loco.lastSensor}`
                            }
                          </Table.Td>

                          <Table.Td>
                            <Badge
                              size="xs"
                              variant="light"
                              color={
                                loco.confidence ===
                                  "certain"
                                  ? "green"
                                  : loco.confidence ===
                                      "likely"
                                    ? "blue"
                                    : "yellow"
                              }
                            >
                              {
                                loco.confidence
                              }
                            </Badge>
                          </Table.Td>

                          <Table.Td
                            ff="monospace"
                            c="dimmed"
                          >
                            {
                              loco.recentSensorPath.length >
                                0
                                ? loco.recentSensorPath
                                    .map(
                                      sensor =>
                                        `#${sensor}`
                                    )
                                    .join(" → ")
                                : "-"
                            }
                          </Table.Td>
                        </Table.Tr>
                      )
                    )
                  }
                </Table.Tbody>
              </Table>
            )
        }
      </Stack>

      <Text
        size="sm"
        fw={700}
      >
        {
          i18next.t(
            "ui.trainTrackingLog",
            {
              defaultValue:
                "Tracking log",
            }
          )
        }
      </Text>

      <ScrollArea
        style={{
          flex: 1,
          minHeight: 0,
        }}
        type="auto"
      >
        <Stack gap={4}>
          {
            state.logs.length ===
              0
              ? (
                <Text
                  size="xs"
                  c="dimmed"
                >
                  {
                    i18next.t(
                      "ui.trainTrackingNoLog",
                      {
                        defaultValue:
                          "No tracking events yet.",
                      }
                    )
                  }
                </Text>
              )
              : state.logs
                  .slice()
                  .reverse()
                  .map(
                    entry => (
                      <Group
                        key={
                          entry.id
                        }
                        gap="xs"
                        align="flex-start"
                        wrap="nowrap"
                      >
                        <Text
                          size="xs"
                          ff="monospace"
                          c="dimmed"
                          style={{
                            minWidth:
                              72,
                          }}
                        >
                          {
                            timeText(
                              entry.timestamp
                            )
                          }
                        </Text>

                        <Badge
                          size="xs"
                          variant="light"
                          color={
                            entry.level ===
                              "match"
                              ? "green"
                              : entry.level ===
                                  "warn"
                                ? "yellow"
                                : entry.level ===
                                    "error"
                                  ? "red"
                                  : "blue"
                          }
                        >
                          {
                            entry.level
                          }
                        </Badge>

                        <Text
                          size="xs"
                          ff="monospace"
                          style={{
                            whiteSpace:
                              "pre-wrap",
                            overflowWrap:
                              "anywhere",
                          }}
                        >
                          {
                            entry.message
                          }
                        </Text>
                      </Group>
                    )
                  )
          }
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
