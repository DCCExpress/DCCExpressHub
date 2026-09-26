import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  NumberInput,
  ScrollArea,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import {
  IconCalendarTime,
  IconDeviceFloppy,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
} from "@tabler/icons-react";

import {
  pauseFastClock,
  resetFastClock,
  runFastClock,
  setFastClockSpeed,
} from "@/api/fastClockApi";
import {
  enumerateTimetableCronOccurrences,
} from "@/domain/timetableCron";

import type {
  MovementPage,
} from "@/domain/movement";
import {
  loadAutomationTimetable,
  type AutomationScriptDefinition,
  type TimetableEntryDefinition,
} from "@/services/automationApi";
import {
  fastClockStore,
  type FastClockViewState,
} from "@/services/fastClockStore";
import {
  getAutomationFinishing,
  subscribeAutomationFinishing,
} from "@/services/clientScriptRunner";
import {
  timetableScheduler,
  type TimetableActiveRun,
  type TimetableSchedulerState,
} from "@/services/timetableScheduler";

type TimetablePanelProps = {
  scripts: AutomationScriptDefinition[];
  movements: MovementPage[];
  onOpenTimetable: () => void;
  timetableRevision?: number;
};

type ExpandedTimetableRow = {
  key: string;
  time: string;
  absoluteMinute: number;
  dayOffset: number;
  targetName: string;
  targetMissing: boolean;
  targetType:
    "script" |
    "movement";
  isCurrent: boolean;
  activeRun: TimetableActiveRun | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const TIMETABLE_WINDOW_MINUTES = 60;

function normalizeDayTime(value: number): number {
  const normalized = value % DAY_MS;
  return normalized < 0 ? normalized + DAY_MS : normalized;
}

function formatClockTime(timeMs: number): string {
  const totalSeconds = Math.floor(normalizeDayTime(timeMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map(value => String(value).padStart(2, "0"))
    .join(":");
}

function formatTimetableTime(
  hour: number,
  minute: number
): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export default function TimetablePanel({
  scripts,
  movements,
  onOpenTimetable,
  timetableRevision = 0,
}: TimetablePanelProps) {
  const { t } = useTranslation();

  const [clockState, setClockState] = useState<FastClockViewState>(
    () => fastClockStore.getViewState()
  );
  const [speedInput, setSpeedInput] = useState<number>(
    () => fastClockStore.getViewState().snapshot?.speed ?? 1
  );
  const [busy, setBusy] = useState(false);
  const [timetable, setTimetable] = useState<TimetableEntryDefinition[]>([]);
  const [timetableLoading, setTimetableLoading] = useState(true);
  const [timetableError, setTimetableError] = useState<string | null>(null);
  const [schedulerState, setSchedulerState] = useState<TimetableSchedulerState>(
    () => timetableScheduler.getState()
  );
  const [automationFinishing, setAutomationFinishingState] = useState(
    () => getAutomationFinishing()
  );

  useEffect(() => fastClockStore.subscribe(setClockState), []);
  useEffect(() => timetableScheduler.subscribe(setSchedulerState), []);
  useEffect(
    () => subscribeAutomationFinishing(setAutomationFinishingState),
    []
  );

  useEffect(() => {
    if (clockState.snapshot) {
      setSpeedInput(clockState.snapshot.speed);
    }
  }, [clockState.snapshot?.speed]);

  useEffect(() => {
    let cancelled = false;

    setTimetableLoading(true);
    setTimetableError(null);

    void loadAutomationTimetable()
      .then(entries => {
        if (!cancelled) {
          setTimetable(entries);
        }
      })
      .catch(error => {
        if (!cancelled) {
          setTimetableError(
            error instanceof Error
              ? error.message
              : String(error)
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTimetableLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [timetableRevision]);

  useEffect(() => {
    timetableScheduler.configure(
      scripts,
      movements,
      timetable
    );
  }, [
    scripts,
    movements,
    timetable,
  ]);

  const snapshot = clockState.snapshot;

  const formattedTime = useMemo(
    () => (snapshot ? formatClockTime(snapshot.timeMs) : "--:--:--"),
    [snapshot?.timeMs]
  );

  // The store redraws the clock every animation frame. Timetable expansion only
  // changes when the FastClock enters another minute, so keep it minute-based.
  const fastClockMinute = snapshot
    ? Math.floor(normalizeDayTime(snapshot.timeMs) / MINUTE_MS)
    : -1;

  const expandedRows = useMemo<ExpandedTimetableRow[]>(() => {
    if (!snapshot) {
      return [];
    }

    const scriptsById = new Map(
      scripts.map(script => [script.id, script] as const)
    );

    const movementsById =
      new Map(
        movements.map(
          movement => [
            movement.id,
            movement,
          ] as const
        )
      );

    const rows: ExpandedTimetableRow[] = [];
    const representedRunIds = new Set<string>();

    for (const entry of timetable) {
      if (!entry.enabled) {
        continue;
      }

      const occurrences =
        enumerateTimetableCronOccurrences(
          entry.cron,
          snapshot.timeMs,
          TIMETABLE_WINDOW_MINUTES
        );

      for (
        const occurrence of
        occurrences
      ) {
        for (
          const action of
          entry.actions
        ) {
          const target =
            action.targetType ===
              "movement"
              ? movementsById.get(
                  action.targetId
                )
              : scriptsById.get(
                  action.targetId
                );

          const activeRun =
            occurrence.dayOffset ===
              0
              ? schedulerState.activeRuns.find(
                  run =>
                    run.timetableEntryId ===
                      entry.id &&
                    run.timetableActionId ===
                      action.id &&
                    run.scheduledMinuteOfDay ===
                      occurrence.minuteOfDay
                ) ??
                null
              : null;

          if (activeRun) {
            representedRunIds.add(
              activeRun.id
            );
          }

          rows.push({
            key:
              `${entry.id}:${action.id}:${occurrence.absoluteMinute}`,
            time:
              formatTimetableTime(
                occurrence.hour,
                occurrence.minute
              ),
            absoluteMinute:
              occurrence.absoluteMinute,
            dayOffset:
              occurrence.dayOffset,
            targetName:
              target?.name ??
              (
                action.targetType ===
                  "movement"
                  ? "Missing Movement"
                  : t(
                      "ui.missingScript"
                    )
              ),
            targetMissing:
              !target,
            targetType:
              action.targetType,
            isCurrent:
              occurrence.dayOffset ===
                0 &&
              occurrence.absoluteMinute ===
                fastClockMinute,
            activeRun,
          });
        }
      }
    }

    // A timetable window normally starts at the current minute, so a run that
    // started earlier would disappear from the list while it is still active.
    // Keep that concrete departure visible until its script actually finishes.
    for (const activeRun of schedulerState.activeRuns) {
      if (representedRunIds.has(activeRun.id)) {
        continue;
      }

      let absoluteMinute = activeRun.scheduledMinuteOfDay;

      if (absoluteMinute > fastClockMinute) {
        // The run belongs to the previous FastClock day (midnight wrap).
        absoluteMinute -= 24 * 60;
      }

      rows.push({
        key: `active:${activeRun.id}`,
        time: activeRun.scheduledTime,
        absoluteMinute,
        dayOffset: 0,
        targetName:
          activeRun.targetName,
        targetMissing:
          false,
        targetType:
          activeRun.targetType,
        isCurrent:
          activeRun.scheduledMinuteOfDay === fastClockMinute,
        activeRun,
      });
    }

    rows.sort((left, right) => {
      if (left.absoluteMinute !== right.absoluteMinute) {
        return left.absoluteMinute - right.absoluteMinute;
      }

      if (left.activeRun && !right.activeRun) {
        return -1;
      }

      if (!left.activeRun && right.activeRun) {
        return 1;
      }

      return left.targetName.localeCompare(right.targetName);
    });

    return rows;
  }, [
    fastClockMinute,
    timetable,
    scripts,
    movements,
    schedulerState.activeRuns,
    snapshot !== null,
    t,
  ]);

  const executeClockCommand = async (
    operation: () => Promise<NonNullable<FastClockViewState["snapshot"]>>,
    fallbackMessage: string,
    rebaseSchedulerAfter = false
  ): Promise<void> => {
    if (busy) return;

    setBusy(true);

    try {
      const next = await operation();
      fastClockStore.applyServerSnapshot(next);
      setSpeedInput(next.speed);

      if (rebaseSchedulerAfter) {
        timetableScheduler.rebase();
      }
    } catch (error) {
      showNotification({
        color: "red",
        title: t("ui.fastClockError"),
        message:
          error instanceof Error
            ? error.message
            : fallbackMessage,
      });
    } finally {
      setBusy(false);
    }
  };

  const applySpeed = (): void => {
    const speed = Math.max(1, Math.round(Number(speedInput) || 1));

    void executeClockCommand(
      () => setFastClockSpeed(speed),
      t("ui.fastClockSpeedSetFailed")
    );
  };

  return (
    <ScrollArea
      h="100%"
      type="always"
      scrollbarSize={9}
      className="lite-info-scroll"
    >
      <Stack gap="sm">
        <Card withBorder p="sm">
          <Stack gap="sm">
            <Group justify="space-between" align="center" wrap="wrap">
              <div>
                <Text fw={700}>FastClock</Text>
                <Text size="xs" c="dimmed">
                  {t("ui.timetableTimeBase")}
                </Text>
              </div>

              <Group gap={6}>
                <Badge
                  size="sm"
                  variant="light"
                  color={clockState.connected ? "green" : "red"}
                >
                  {clockState.connected ? t("ui.online") : t("ui.offline")}
                </Badge>

                <Badge
                  size="sm"
                  variant="light"
                  color={snapshot?.running ? "green" : "gray"}
                >
                  {snapshot?.running ? t("ui.running") : t("ui.pausedShort")}
                </Badge>
              </Group>
            </Group>

            <Text
              fw={800}
              ta="center"
              style={{
                fontSize: "clamp(2rem, 10vw, 4rem)",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
                fontFamily: "monospace",
                letterSpacing: "0.04em",
              }}
            >
              {formattedTime}
            </Text>

            <Text size="sm" c="dimmed" ta="center">
              {t("ui.speedValue", { value1: snapshot?.speed ?? speedInput })}
            </Text>

            <Group grow gap="xs">
              <Button
                size="xs"
                variant="light"
                color="green"
                leftSection={<IconPlayerPlay size={15} />}
                disabled={busy || !clockState.connected || !snapshot || snapshot.running}
                onClick={() => {
                  void executeClockCommand(
                    runFastClock,
                    t("ui.fastClockStartFailed")
                  );
                }}
              >
                {t("ui.start")}
              </Button>

              <Button
                size="xs"
                variant="light"
                color="yellow"
                leftSection={<IconPlayerPause size={15} />}
                disabled={busy || !clockState.connected || !snapshot || !snapshot.running}
                onClick={() => {
                  void executeClockCommand(
                    pauseFastClock,
                    t("ui.fastClockPauseFailed")
                  );
                }}
              >
                {t("ui.pause")}
              </Button>

              <Button
                size="xs"
                variant="light"
                color="blue"
                leftSection={<IconRefresh size={15} />}
                disabled={busy || !clockState.connected}
                onClick={() => {
                  void executeClockCommand(
                    resetFastClock,
                    t("ui.fastClockResetFailed"),
                    true
                  );
                }}
              >
                {t("ui.reset")}
              </Button>
            </Group>

            <Group align="flex-end" wrap="nowrap">
              <NumberInput
                label={t("ui.speedLabel")}
                description={t("ui.realTimeSpeedDescription")}
                min={1}
                max={100}
                step={1}
                value={speedInput}
                onChange={(value: string | number) => {
                  const numeric = typeof value === "number" ? value : Number(value);
                  setSpeedInput(Number.isFinite(numeric) ? numeric : 1);
                }}
                style={{ flex: 1 }}
              />

              <Button
                size="sm"
                variant="light"
                leftSection={<IconDeviceFloppy size={15} />}
                disabled={busy || !clockState.connected}
                onClick={applySpeed}
              >
                {t("ui.apply")}
              </Button>
            </Group>
          </Stack>
        </Card>

        <Card withBorder p="sm">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <div>
                <Text fw={700}>{t("ui.timetable")}</Text>
                <Text size="xs" c="dimmed">
                  {t("ui.timetableWindowDescription", { value1: TIMETABLE_WINDOW_MINUTES })}
                </Text>
              </div>

              <Group gap={6} wrap="wrap">
                <Badge variant="light" color="blue">
                  {t("ui.rowsCount", { value1: expandedRows.length })}
                </Badge>

                {schedulerState.activeRuns.length > 0 && (
                  <Badge variant="filled" color="green">
                    {t("ui.activeRunsCount", { value1: schedulerState.activeRuns.length })}
                  </Badge>
                )}
              </Group>
            </Group>

            {timetableError && (
              <Alert color="red" variant="light">
                {timetableError}
              </Alert>
            )}

            {timetableLoading ? (
              <Group justify="center" py="md">
                <Loader size="sm" />
              </Group>
            ) : !snapshot ? (
              <Text size="sm" c="dimmed" ta="center" py="sm">
                {t("ui.fastClockStateUnavailable")}
              </Text>
            ) : expandedRows.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" py="sm">
                {t("ui.noDeparturesNextMinutes", { value1: TIMETABLE_WINDOW_MINUTES })}
              </Text>
            ) : (
              <Table
                striped
                highlightOnHover
                withRowBorders
                verticalSpacing={5}
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={82}>{t("ui.timeColumn")}</Table.Th>
                    <Table.Th>{t("ui.timetableTarget")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>

                <Table.Tbody>
                  {expandedRows.map(row => (
                    <Table.Tr
                      key={row.key}
                      style={
                        row.activeRun
                          ? {
                              backgroundColor:
                                "var(--mantine-color-green-light)",
                            }
                          : row.isCurrent
                            ? {
                                backgroundColor:
                                  "var(--mantine-color-blue-light)",
                              }
                            : {}
                      }
                    >
                      <Table.Td>
                        <Group gap={5} wrap="nowrap">
                          <Text
                            fw={700}
                            ff="monospace"
                            style={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            {row.time}
                          </Text>

                          {row.isCurrent && (
                            <Badge size="xs" variant="filled" color="blue">
                              {t("ui.now")}
                            </Badge>
                          )}

                          {row.dayOffset > 0 && (
                            <Badge size="xs" variant="light" color="gray">
                              {t("ui.nextDay")}
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>

                      <Table.Td>
                        <Stack gap={2}>
                          <Group gap={6} wrap="wrap">
                            <Text
                              size="sm"
                              {...(row.targetMissing
                                ? { c: "red" as const }
                                : {})}
                              fw={
                                row.activeRun || row.isCurrent || row.targetMissing
                                  ? 700
                                  : 500
                              }
                            >
                              {row.targetName}
                            </Text>

                            <Badge
                              size="xs"
                              variant="light"
                              color={
                                row.targetType ===
                                  "movement"
                                  ? "violet"
                                  : "blue"
                              }
                            >
                              {
                                row.targetType ===
                                  "movement"
                                  ? "Movement"
                                  : "Script"
                              }
                            </Badge>

                            {row.activeRun && (
                              <Badge
                                size="xs"
                                variant="filled"
                                color={
                                  row.activeRun.status === "paused"
                                    ? "yellow"
                                    : row.activeRun.status === "launching"
                                      ? "blue"
                                      : "green"
                                }
                              >
                                {row.activeRun.status === "paused"
                                  ? t("ui.pausedShort")
                                  : row.activeRun.status === "launching"
                                    ? t("ui.launchingShort")
                                    : t("ui.runningShort")}
                              </Badge>
                            )}
                          </Group>

                          {row.activeRun && (
                            <Text
                              size="xs"
                              c="dimmed"
                              style={{ whiteSpace: "pre-wrap" }}
                            >
                              {
                                row.activeRun.message ||
                                (
                                  row.activeRun.targetType ===
                                    "movement"
                                    ? t(
                                        "ui.running"
                                      )
                                    : t(
                                        "ui.scriptRunning"
                                      )
                                )
                              }
                            </Text>
                          )}
                        </Stack>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}

            <Divider />

            <Group justify="space-between" align="center" wrap="wrap">
              <Group gap="xs" wrap="wrap">
                <Badge
                  size="sm"
                  variant={schedulerState.running ? "filled" : "light"}
                  color={schedulerState.running ? "green" : "gray"}
                >
                  {schedulerState.running
                    ? t("ui.timetableActive")
                    : t("ui.timetableStopped")}
                </Badge>

                {automationFinishing && (
                  <Badge size="sm" variant="light" color="orange">
                    {t("ui.finishingNoNewStarts")}
                  </Badge>
                )}
              </Group>

              {schedulerState.lastTriggeredAt &&
                schedulerState.lastTriggeredTargetName && (
                  <Text size="xs" c="dimmed">
                    {t("ui.lastStart")} {schedulerState.lastTriggeredAt} ·{" "}
                    {schedulerState.lastTriggeredTargetName}
                  </Text>
                )}
            </Group>

            <Group grow gap="xs">
              <Button
                color="green"
                variant="light"
                leftSection={<IconPlayerPlay size={16} />}
                disabled={
                  schedulerState.running ||
                  !clockState.connected ||
                  !snapshot ||
                  timetableLoading ||
                  timetable.length === 0
                }
                onClick={() => timetableScheduler.start()}
              >
                {t("ui.timetableStart")}
              </Button>

              <Button
                color="red"
                variant="light"
                leftSection={<IconPlayerStop size={16} />}
                disabled={!schedulerState.running}
                onClick={() => timetableScheduler.stop()}
              >
                {t("ui.timetableStop")}
              </Button>
            </Group>

            <Divider />

            <Button
              variant="default"
              leftSection={<IconCalendarTime size={17} />}
              onClick={onOpenTimetable}
            >
              {t("ui.editTimetable")}
            </Button>
          </Stack>
        </Card>
      </Stack>
    </ScrollArea>
  );
}
