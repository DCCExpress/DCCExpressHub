import { useEffect, useMemo, useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
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
import {
  loadAutomationTimetable,
  type AutomationScriptDefinition,
  type TimetableEntryDefinition,
} from "@/services/automationApi";
import {
  fastClockStore,
  type FastClockViewState,
} from "@/services/fastClockStore";

type TimetablePanelProps = {
  scripts: AutomationScriptDefinition[];
  onOpenTimetable: () => void;
  timetableRevision?: number;
};

type ExpandedTimetableRow = {
  key: string;
  time: string;
  absoluteMinute: number;
  dayOffset: number;
  scriptName: string;
  scriptMissing: boolean;
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
  onOpenTimetable,
  timetableRevision = 0,
}: TimetablePanelProps) {
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

  useEffect(() => fastClockStore.subscribe(setClockState), []);

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

    const rows: ExpandedTimetableRow[] = [];

    for (const entry of timetable) {
      if (!entry.enabled) {
        continue;
      }

      const script = scriptsById.get(entry.scriptId);
      const occurrences = enumerateTimetableCronOccurrences(
        entry.cron,
        snapshot.timeMs,
        TIMETABLE_WINDOW_MINUTES
      );

      for (const occurrence of occurrences) {
        rows.push({
          key: `${entry.id}:${occurrence.absoluteMinute}`,
          time: formatTimetableTime(
            occurrence.hour,
            occurrence.minute
          ),
          absoluteMinute: occurrence.absoluteMinute,
          dayOffset: occurrence.dayOffset,
          scriptName: script?.name ?? "Hiányzó script",
          scriptMissing: !script,
        });
      }
    }

    rows.sort((left, right) => {
      if (left.absoluteMinute !== right.absoluteMinute) {
        return left.absoluteMinute - right.absoluteMinute;
      }

      return left.scriptName.localeCompare(right.scriptName);
    });

    return rows;
  }, [fastClockMinute, timetable, scripts, snapshot !== null]);

  const executeClockCommand = async (
    operation: () => Promise<NonNullable<FastClockViewState["snapshot"]>>,
    fallbackMessage: string
  ): Promise<void> => {
    if (busy) return;

    setBusy(true);

    try {
      const next = await operation();
      fastClockStore.applyServerSnapshot(next);
      setSpeedInput(next.speed);
    } catch (error) {
      showNotification({
        color: "red",
        title: "FastClock hiba",
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
      "A FastClock sebességét nem sikerült beállítani."
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
                  A menetrend időalapja
                </Text>
              </div>

              <Group gap={6}>
                <Badge
                  size="sm"
                  variant="light"
                  color={clockState.connected ? "green" : "red"}
                >
                  {clockState.connected ? "ONLINE" : "OFFLINE"}
                </Badge>

                <Badge
                  size="sm"
                  variant="light"
                  color={snapshot?.running ? "green" : "gray"}
                >
                  {snapshot?.running ? "RUNNING" : "PAUSED"}
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
              Sebesség: {snapshot?.speed ?? speedInput}×
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
                    "A FastClock nem indítható."
                  );
                }}
              >
                Start
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
                    "A FastClock nem állítható meg."
                  );
                }}
              >
                Pause
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
                    "A FastClock nem állítható alaphelyzetbe."
                  );
                }}
              >
                Reset
              </Button>
            </Group>

            <Group align="flex-end" wrap="nowrap">
              <NumberInput
                label="Sebesség"
                description="1× = valós idő"
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
                Beállítás
              </Button>
            </Group>
          </Stack>
        </Card>

        <Card withBorder p="sm">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <div>
                <Text fw={700}>Menetrend</Text>
                <Text size="xs" c="dimmed">
                  Következő {TIMETABLE_WINDOW_MINUTES} FastClock perc · csak az engedélyezett sorok
                </Text>
              </div>

              <Badge variant="light" color="blue">
                {expandedRows.length} indulás
              </Badge>
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
                A FastClock állapota még nem érhető el.
              </Text>
            ) : expandedRows.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" py="sm">
                Nincs indulás a következő {TIMETABLE_WINDOW_MINUTES} FastClock percben.
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
                    <Table.Th w={82}>Idő</Table.Th>
                    <Table.Th>Script</Table.Th>
                  </Table.Tr>
                </Table.Thead>

                <Table.Tbody>
                  {expandedRows.map(row => (
                    <Table.Tr key={row.key}>
                      <Table.Td>
                        <Group gap={5} wrap="nowrap">
                          <Text
                            fw={700}
                            ff="monospace"
                            style={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            {row.time}
                          </Text>

                          {row.dayOffset > 0 && (
                            <Badge size="xs" variant="light" color="gray">
                              +1 nap
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>

                      <Table.Td>
                        <Text
                          size="sm"
                          {...(row.scriptMissing
                            ? { c: "red" as const }
                            : {})}
                          fw={row.scriptMissing ? 700 : 500}
                        >
                          {row.scriptName}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}

            <Button
              leftSection={<IconCalendarTime size={17} />}
              onClick={onOpenTimetable}
            >
              Menetrend szerkesztése
            </Button>
          </Stack>
        </Card>
      </Stack>
    </ScrollArea>
  );
}
