import {
  Accordion,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Table,
  ScrollArea,
  Stack,
  Switch,
  Text,
} from "@mantine/core";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import i18next from "i18next";

import type {
  Loco,
} from "../../domain/domainTypes";

import LocoImage from "../loco/LocoImage";
import { BlockElement } from "../../models/editor/elements/BlockElement";
import type { LayoutView } from "../../models/editor/core/LayoutView";
import {
  getRailComLocomotives,
  subscribeRailComSensorChanges,
} from "../../services/railComSensorRuntime";

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
  locos: Loco[];
  layout: LayoutView;
};

function timeText(
  timestamp: number
): string {
  return new Date(
    timestamp
  ).toLocaleTimeString();
}

export default function TrainTrackingPanel({
  locos,
  layout,
}: Props) {
  const [
    state,
    setState,
  ] =
    useState<TrainTrackingState>(
      getTrainTrackingState
    );

  // Only redraw the table when the read-only RailCom presence cache changes.
  // This does not assign locomotives or alter Dispatcher/Train Tracking state.
  const [, setRailComRevision] = useState(0);
  useEffect(
    () => subscribeRailComSensorChanges(
      () => setRailComRevision(value => value + 1)
    ),
    []
  );

  const railComBlocks = layout.getAllElements().filter(
    (element): element is BlockElement =>
      element instanceof BlockElement &&
      element.railCom &&
      element.sensorAddress > 0
  );

  // Read-only reconciliation. First sighting or change is intentionally
  // Pending for 2 s: occupancy, Tracking and RailCom arrive independently.
  // This never changes block assignment, speed, Dispatcher or E-STOP state.
  const reconciliation = useRef(new Map<number, { signature: string; since: number }>());
  const [verificationNow, setVerificationNow] = useState(() => Date.now());

  useEffect(() => {
    if (!state.enabled || !state.active) {
      reconciliation.current.clear();
      return;
    }
    const timer = window.setInterval(() => setVerificationNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state.enabled, state.active]);

  const railComVerification = (locoAddress: number, currentBlockId: number | null) => {
    if (!state.enabled || !state.active) return "Disabled";
    const block = railComBlocks.find(item => item.id === currentBlockId);
    if (!block) return "Unverified";
    const identities = getRailComLocomotives(block.sensorAddress);
    const signature = currentBlockId + ":" + identities.join(",");
    const previous = reconciliation.current.get(locoAddress);
    if (!previous || previous.signature !== signature) {
      reconciliation.current.set(locoAddress, { signature, since: verificationNow });
      return "Pending";
    }
    if (verificationNow - previous.since < 2000) return "Pending";
    if (identities.length === 0) return "Unverified";
    if (identities.length !== 1) return "Unverified";
    return identities[0] === locoAddress ? "Verified" : "Mismatch";
  };

  const railComBlockLabel = (locoAddress: number): string => {
    const names = railComBlocks
      .filter(block => getRailComLocomotives(block.sensorAddress).includes(locoAddress))
      .map(block => {
        const name = block.name.trim();
        return name && name !== "element" ? name : "#" + block.id;
      });
    return names.length ? [...new Set(names)].join(", ") : "-";
  };

  const [
    pathLocoAddress,
    setPathLocoAddress,
  ] =
    useState<number | null>(
      null
    );

  const pathLoco =
    pathLocoAddress ===
      null
      ? null
      : state.locos.find(
          loco =>
            loco.locoAddress ===
              pathLocoAddress
        ) ??
        null;

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


      {
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
                      RailCom block
                    </Table.Th>

                    <Table.Th>
                      Verification
                    </Table.Th>

                    <Table.Th>
                      {
                        i18next.t(
                          "ui.trainTrackingNextBlock",
                          {
                            defaultValue:
                              "Next block",
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
                          "ui.trainTrackingSectionParts",
                          {
                            defaultValue:
                              "Section parts",
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
                          <Table.Td>
                            {
                              (() => {
                                const configured =
                                  locos.find(
                                    item =>
                                      item.address ===
                                        loco.locoAddress
                                  );

                                return (
                                  <Stack
                                    gap={2}
                                    align="center"
                                  >
                                    <LocoImage
                                      locoId={
                                        configured?.id ??
                                        String(
                                          loco.locoAddress
                                        )
                                      }
                                      image={
                                        configured?.image
                                      }
                                      name={
                                        configured?.name ??
                                        `#${loco.locoAddress}`
                                      }
                                      width={64}
                                      height={34}
                                    />

                                    <Text
                                      size="xs"
                                      fw={700}
                                      ff="monospace"
                                      ta="center"
                                    >
                                      {
                                        `#${loco.locoAddress}`
                                      }
                                    </Text>
                                  </Stack>
                                );
                              })()
                            }
                          </Table.Td>

                          <Table.Td>
                            {
                              loco.currentBlockName ??
                              "-"
                            }
                          </Table.Td>

                          <Table.Td>
                            {
                              railComBlockLabel(loco.locoAddress)
                            }
                          </Table.Td>

                          <Table.Td>
                            {(() => {
                              const result = railComVerification(loco.locoAddress, loco.currentBlockId);
                              return <Badge size="xs" variant="light"
                                color={result === "Verified" ? "green"
                                  : result === "Mismatch" ? "red"
                                  : result === "Pending" ? "yellow" : "gray"}>
                                {result}
                              </Badge>;
                            })()}
                          </Table.Td>

                          <Table.Td>
                            {
                              loco.predictedNextBlockName ??
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
                            c="dimmed"
                          >
                            {
                              loco.currentSectionParts.length >
                                0
                                ? loco.currentSectionParts.join(
                                    ", "
                                  )
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

                          <Table.Td>
                            {
                              loco.recentSensorPath.length >
                                0
                                ? (
                                  <Button
                                    size="compact-xs"
                                    variant="subtle"
                                    color="gray"
                                    ff="monospace"
                                    onClick={
                                      () =>
                                        setPathLocoAddress(
                                          loco.locoAddress
                                        )
                                    }
                                    styles={{
                                      label: {
                                        maxWidth:
                                          180,
                                        overflow:
                                          "hidden",
                                        textOverflow:
                                          "ellipsis",
                                        whiteSpace:
                                          "nowrap",
                                      },
                                    }}
                                  >
                                    {
                                      (
                                        loco.recentSensorPath.length >
                                          4
                                          ? "… → "
                                          : ""
                                      ) +
                                      loco.recentSensorPath
                                        .slice(
                                          -4
                                        )
                                        .map(
                                          sensor =>
                                            `#${sensor}`
                                        )
                                        .join(
                                          " → "
                                        )
                                    }
                                  </Button>
                                )
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

      <Modal
        opened={
          pathLoco !==
            null
        }
        onClose={
          () =>
            setPathLocoAddress(
              null
            )
        }
        title={
          pathLoco
            ? i18next.t(
                "ui.trainTrackingPathDialogTitle",
                {
                  defaultValue:
                    "Sensor path — locomotive #{{address}}",
                  address:
                    pathLoco.locoAddress,
                }
              )
            : ""
        }
        centered
        size="lg"
      >
        <Stack gap="xs">
          <Text
            size="xs"
            c="dimmed"
          >
            {
              i18next.t(
                "ui.trainTrackingPathDialogDescription",
                {
                  defaultValue:
                    "Recent sensors retained by Train Tracking.",
                }
              )
            }
          </Text>

          <Text
            ff="monospace"
            size="sm"
            style={{
              whiteSpace:
                "normal",
              overflowWrap:
                "anywhere",
            }}
          >
            {
              pathLoco &&
              pathLoco.recentSensorPath.length >
                0
                ? pathLoco.recentSensorPath
                    .map(
                      sensor =>
                        `#${sensor}`
                    )
                    .join(
                      " → "
                    )
                : "-"
            }
          </Text>
        </Stack>
      </Modal>
    </Stack>
  );
}
