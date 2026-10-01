import {
  ActionIcon,
  Badge,
  Button,
  Group,
  ScrollArea,
  Stack,
  Switch,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import i18next from "i18next";

import {
  IconAlertTriangle,
  IconPlayerStop,
  IconPower,
  IconX,
} from "@tabler/icons-react";

import type {
  MovementDocument,
} from "../../domain/movement";

import {
  loadAutomationBlockCatalog,
  type AutomationBlockOption,
} from "../../services/automationBlockCatalog";

import {
  abortAllDispatcherMovements,
  clearDispatcherLog,
  getDispatcherRuntimeSnapshot,
  setDispatcherEnabled,
  stopAllDispatcherMovements,
  subscribeDispatcherRuntime,
  type DispatcherRuntimeSnapshot,
} from "../../services/dispatcherRuntime";

import {
  useCommandCenter,
} from "../../context/CommandCenterContext";

import {
  wsApi,
} from "../../services/wsApi";

type Props = {
  movements:
    MovementDocument;
};

function timeText(
  timestamp:
    number
): string {
  return new Date(
    timestamp
  ).toLocaleTimeString();
}

function blockName(
  id:
    number | null,
  catalog:
    AutomationBlockOption[]
): string {
  if (
    id ===
      null
  ) {
    return "-";
  }

  return (
    catalog.find(
      block =>
        block.id ===
          id
    )?.name ??
    `#${id}`
  );
}

export default function DispatcherPanel({
  movements,
}: Props) {
  const commandCenter =
    useCommandCenter();

  const [
    state,
    setState,
  ] =
    useState<DispatcherRuntimeSnapshot>(
      getDispatcherRuntimeSnapshot
    );

  const [
    catalog,
    setCatalog,
  ] =
    useState<
      AutomationBlockOption[]
    >([]);

  useEffect(
    () =>
      subscribeDispatcherRuntime(
        setState
      ),
    []
  );

  useEffect(
    () => {
      let disposed =
        false;

      void loadAutomationBlockCatalog()
        .then(
          blocks => {
            if (
              !disposed
            ) {
              setCatalog(
                blocks
              );
            }
          }
        )
        .catch(
          () => {
            if (
              !disposed
            ) {
              setCatalog(
                []
              );
            }
          }
        );

      return () => {
        disposed =
          true;
      };
    },
    []
  );

  const rows =
    useMemo(
      () =>
        state.tasks
          .map(
            task => {
              const page =
                movements.pages.find(
                  candidate =>
                    candidate.id ===
                      task.movementId
                );

              return {
                ...task,
                movementName:
                  page?.name ??
                  task.movementName,
              };
            }
          )
          .sort(
            (
              left,
              right
            ) =>
              (
                right.startedAt ??
                0
              ) -
              (
                left.startedAt ??
                0
              )
          ),
      [
        movements.pages,
        state.tasks,
      ]
    );

  return (
    <Stack
      gap="sm"
      h="100%"
    >
      <Group
        justify="space-between"
        align="center"
        wrap="wrap"
      >
        <Group
          gap="xs"
          wrap="wrap"
        >
          <Switch
            size="sm"
            color="green"
            checked={
              state.enabled
            }
            label={
              i18next.t(
                "ui.dispatcherEnabled",
                {
                  defaultValue:
                    "Enabled",
                }
              )
            }
            onChange={
              event =>
                setDispatcherEnabled(
                  event.currentTarget.checked
                )
            }
          />

          <Tooltip
            withArrow
            label={
              i18next.t(
                "ui.dispatcherStopAll",
                {
                  defaultValue:
                    "Stop all Dispatcher trains",
                }
              )
            }
          >
            <ActionIcon
              size="sm"
              variant="light"
              color="yellow"
              disabled={
                !state.tasks.some(
                  task =>
                    task.status ===
                      "running" ||
                    task.status ===
                      "stopping"
                )
              }
              onClick={
                stopAllDispatcherMovements
              }
            >
              <IconPlayerStop
                size={15}
              />
            </ActionIcon>
          </Tooltip>

          <Tooltip
            withArrow
            label={
              i18next.t(
                "ui.dispatcherAbortAll",
                {
                  defaultValue:
                    "Abort all Dispatcher movements",
                }
              )
            }
          >
            <ActionIcon
              size="sm"
              variant="light"
              color="red"
              disabled={
                !state.tasks.some(
                  task =>
                    task.status ===
                      "running" ||
                    task.status ===
                      "stopping"
                )
              }
              onClick={
                () =>
                  abortAllDispatcherMovements(
                    false
                  )
              }
            >
              <IconX
                size={15}
              />
            </ActionIcon>
          </Tooltip>

          <Tooltip
            withArrow
            label={
              commandCenter.powerInfo
                ?.emergencyStop
                ? i18next.t(
                    "ui.dispatcherClearEstop",
                    {
                      defaultValue:
                        "Clear E-Stop",
                    }
                  )
                : i18next.t(
                    "ui.dispatcherEmergencyStop",
                    {
                      defaultValue:
                        "Emergency stop",
                    }
                  )
            }
          >
            <ActionIcon
              size="sm"
              variant={
                commandCenter.powerInfo
                  ?.emergencyStop
                  ? "filled"
                  : "light"
              }
              color="red"
              disabled={
                !commandCenter.alive ||
                !commandCenter.powerInfo
              }
              onClick={
                () =>
                  wsApi.emergencyStop()
              }
            >
              {
                commandCenter.powerInfo
                  ?.emergencyStop
                  ? (
                    <IconPower
                      size={15}
                    />
                  )
                  : (
                    <IconAlertTriangle
                      size={15}
                    />
                  )
              }
            </ActionIcon>
          </Tooltip>

          <Group gap="xs">
          <Text
            fw={700}
            size="sm"
          >
            {
              i18next.t(
                "ui.dispatcherTitle",
                {
                  defaultValue:
                    "Dispatcher",
                }
              )
            }
          </Text>

          <Badge
            size="sm"
            variant="light"
            color={
              rows.some(
                row =>
                  row.status ===
                    "running"
              )
                ? "green"
                : "gray"
            }
          >
            {
              rows.filter(
                row =>
                  row.status ===
                    "running" ||
                  row.status ===
                    "stopping"
              ).length
            }
          </Badge>
          </Group>
        </Group>

        <Button
          size="xs"
          variant="subtle"
          color="gray"
          onClick={
            clearDispatcherLog
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

      <Text
        size="xs"
        c="dimmed"
      >
        {
          i18next.t(
            "ui.dispatcherDescription",
            {
              defaultValue:
                "The Dispatcher executes saved A→B→C movement intents. Train Tracking provides the locomotive position; Dispatcher coordinates execution and safety authority.",
            }
          )
        }
      </Text>

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
              {
                i18next.t(
                  "ui.dispatcherMovement",
                  {
                    defaultValue:
                      "Movement",
                  }
                )
              }
            </Table.Th>

            <Table.Th>
              Loco
            </Table.Th>

            <Table.Th>
              {
                i18next.t(
                  "ui.dispatcherRoute",
                  {
                    defaultValue:
                      "Route",
                  }
                )
              }
            </Table.Th>

            <Table.Th>
              {
                i18next.t(
                  "ui.dispatcherCurrentBlock",
                  {
                    defaultValue:
                      "Current block",
                  }
                )
              }
            </Table.Th>

            <Table.Th>
              {
                i18next.t(
                  "ui.dispatcherNextBlock",
                  {
                    defaultValue:
                      "Next block",
                  }
                )
              }
            </Table.Th>

            <Table.Th>
              Status
            </Table.Th>

            <Table.Th>
              Info
            </Table.Th>
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          {
            rows.length ===
              0
              ? (
                <Table.Tr>
                  <Table.Td
                    colSpan={7}
                  >
                    <Text
                      size="xs"
                      c="dimmed"
                    >
                      {
                        i18next.t(
                          "ui.dispatcherNoTasks",
                          {
                            defaultValue:
                              "No Dispatcher movement has been started yet.",
                          }
                        )
                      }
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )
              : rows.map(
                  row => (
                    <Table.Tr
                      key={
                        row.movementId
                      }
                    >
                      <Table.Td
                        fw={700}
                      >
                        {
                          row.movementName
                        }
                      </Table.Td>

                      <Table.Td
                        ff="monospace"
                      >
                        {
                          `#${row.locoAddress}`
                        }
                      </Table.Td>

                      <Table.Td
                        ff="monospace"
                      >
                        {
                          row.requestedBlocks
                            .map(
                              id =>
                                blockName(
                                  id,
                                  catalog
                                )
                            )
                            .join(
                              " → "
                            )
                        }
                      </Table.Td>

                      <Table.Td>
                        {
                          blockName(
                            row.currentBlockId,
                            catalog
                          )
                        }
                      </Table.Td>

                      <Table.Td>
                        {
                          blockName(
                            row.nextBlockId,
                            catalog
                          )
                        }
                      </Table.Td>

                      <Table.Td>
                        <Badge
                          size="xs"
                          variant="light"
                          color={
                            row.status ===
                              "running"
                              ? "green"
                              : row.status ===
                                  "stopping"
                                ? "yellow"
                                : row.status ===
                                    "error"
                                  ? "red"
                                  : "gray"
                          }
                        >
                          {
                            row.status
                          }
                        </Badge>
                      </Table.Td>

                      <Table.Td>
                        <Text
                          size="xs"
                          c={
                            row.error
                              ? "red"
                              : "dimmed"
                          }
                        >
                          {
                            row.error ??
                            row.info ??
                            "-"
                          }
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )
                )
          }
        </Table.Tbody>
      </Table>

      <Text
        size="sm"
        fw={700}
      >
        {
          i18next.t(
            "ui.dispatcherLog",
            {
              defaultValue:
                "Dispatcher log",
            }
          )
        }
      </Text>

      <ScrollArea
        type="auto"
        style={{
          flex: 1,
          minHeight: 0,
        }}
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
                      "ui.dispatcherNoLog",
                      {
                        defaultValue:
                          "No Dispatcher events yet.",
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
                        wrap="nowrap"
                        align="flex-start"
                      >
                        <Text
                          size="xs"
                          c="dimmed"
                          ff="monospace"
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
