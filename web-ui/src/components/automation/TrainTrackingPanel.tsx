import {
  Badge,
  Button,
  Group,
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
              !controlStationActive
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
              !state.active
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
                    "Clear",
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

      <Text
        size="xs"
        c="dimmed"
      >
        {
          i18next.t(
            "ui.trainTrackingDescription",
            {
              defaultValue:
                "When a block occupancy sensor turns ON, the Hub uses the saved route graph, live turnout states and locomotive direction to identify a unique moving locomotive. Ambiguous matches are logged and never assigned automatically.",
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
