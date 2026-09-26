import {
  ActionIcon,
  Alert,
  Button,
  Code,
  Group,
  Loader,
  NativeSelect,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconDeviceFloppy,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import AppModal from "@/components/common/AppModal";
import { isValidTimetableCron } from "@/domain/timetableCron";

import type {
  MovementPage,
} from "@/domain/movement";
export { isValidTimetableCron };
import {
  createTimetableEntryId,
  loadAutomationTimetable,
  saveAutomationTimetable,
  type AutomationScriptDefinition,
  type TimetableEntryDefinition,
  type TimetableTargetType,
} from "@/services/automationApi";

type TimetableDialogProps = {
  opened: boolean;
  onClose: () => void;
  onSaved?: () => void;
  scripts: AutomationScriptDefinition[];
  movements: MovementPage[];
};

type ScheduleMode =
  | "time"
  | "interval"
  | "cron";

type EditorSchedule = {
  mode: ScheduleMode;
  time: string;
  intervalMinutes: number;
  cron: string;
};

type EditorRow =
  TimetableEntryDefinition & {
    editor: EditorSchedule;
  };

function parseCronEditor(
  cron: string
): EditorSchedule {
  const value =
    cron.trim();

  const exact =
    value.match(
      /^(\d{1,2})\s+(\d{1,2})$/
    );

  if (exact) {
    const minute =
      Number(exact[1]);
    const hour =
      Number(exact[2]);

    if (
      minute >= 0 &&
      minute <= 59 &&
      hour >= 0 &&
      hour <= 23
    ) {
      return {
        mode: "time",
        time:
          `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        intervalMinutes: 5,
        cron: value,
      };
    }
  }

  const interval =
    value.match(
      /^\*\/(\d{1,2})\s+\*$/
    );

  if (interval) {
    const intervalMinutes =
      Number(interval[1]);

    if (
      intervalMinutes >= 1 &&
      intervalMinutes <= 59
    ) {
      return {
        mode: "interval",
        time: "08:00",
        intervalMinutes,
        cron: value,
      };
    }
  }

  return {
    mode: "cron",
    time: "08:00",
    intervalMinutes: 5,
    cron:
      value || "*/5 *",
  };
}

function cronFromEditor(
  editor: EditorSchedule
): string {
  if (
    editor.mode ===
    "time"
  ) {
    const match =
      editor.time.match(
        /^(\d{1,2}):(\d{2})$/
      );

    if (!match) {
      return "";
    }

    const hour =
      Number(match[1]);
    const minute =
      Number(match[2]);

    return `${minute} ${hour}`;
  }

  if (
    editor.mode ===
    "interval"
  ) {
    return `*/${Math.trunc(editor.intervalMinutes)} *`;
  }

  return editor.cron.trim();
}

function toEditorRow(
  entry: TimetableEntryDefinition
): EditorRow {
  return {
    ...entry,
    editor:
      parseCronEditor(
        entry.cron
      ),
  };
}

function createEditorRow(
  scripts:
    AutomationScriptDefinition[],
  movements:
    MovementPage[]
): EditorRow {
  const targetType:
    TimetableTargetType =
    scripts.length > 0
      ? "script"
      : "movement";

  return {
    id:
      createTimetableEntryId(),
    enabled: true,
    targetType,
    targetId:
      targetType ===
        "script"
        ? scripts[0]?.id ??
          ""
        : movements[0]?.id ??
          "",
    cron: "0 8",
    editor: {
      mode: "time",
      time: "08:00",
      intervalMinutes: 5,
      cron: "0 8",
    },
  };
}

export default function TimetableDialog({
  opened,
  onClose,
  onSaved,
  scripts,
  movements,
}: TimetableDialogProps) {
  const [rows, setRows] =
    useState<EditorRow[]>([]);
  const [loading, setLoading] =
    useState(false);
  const [saving, setSaving] =
    useState(false);
  const [loadError, setLoadError] =
    useState<string | null>(null);

  const scriptOptions =
    useMemo(
      () =>
        scripts.map(
          script => ({
            value:
              script.id,
            label:
              script.name,
          })
        ),
      [scripts]
    );


  const movementOptions =
    useMemo(
      () =>
        movements.map(
          movement => ({
            value:
              movement.id,
            label:
              movement.name,
          })
        ),
      [
        movements,
      ]
    );

  useEffect(
    () => {
      if (!opened) {
        return;
      }

      let cancelled =
        false;

      setLoading(true);
      setLoadError(null);

      void loadAutomationTimetable()
        .then(entries => {
          if (cancelled) {
            return;
          }

          setRows(
            entries.map(
              toEditorRow
            )
          );
        })
        .catch(error => {
          if (cancelled) {
            return;
          }

          setLoadError(
            error instanceof Error
              ? error.message
              : String(error)
          );
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });

      return () => {
        cancelled = true;
      };
    },
    [opened]
  );

  const updateRow = (
    id: string,
    update: (
      row: EditorRow
    ) => EditorRow
  ): void => {
    setRows(
      current =>
        current.map(
          row =>
            row.id === id
              ? update(row)
              : row
        )
    );
  };

  const deleteRow = (
    id: string
  ): void => {
    setRows(
      current =>
        current.filter(
          row =>
            row.id !== id
        )
    );
  };

  const persist =
    async (): Promise<void> => {
      const normalized:
        TimetableEntryDefinition[] =
        rows.map(
          row => ({
            id:
              row.id,
            enabled:
              row.enabled,
            targetType:
              row.targetType,
            targetId:
              row.targetId,
            cron:
              cronFromEditor(
                row.editor
              ),
          })
        );

      const invalidCron =
        normalized.find(
          entry =>
            !isValidTimetableCron(
              entry.cron
            )
        );

      if (invalidCron) {
        showNotification({
          color: "red",
          title:
            "Hibás menetrendi időzítés",
          message:
            "A cron formátum két mezőből áll: PERC ÓRA. Például: */5 * vagy 15 8.",
        });
        return;
      }

      const invalidTarget =
        normalized.find(
          entry =>
            entry.targetType ===
              "movement"
              ? !movements.some(
                  movement =>
                    movement.id ===
                    entry.targetId
                )
              : !scripts.some(
                  script =>
                    script.id ===
                    entry.targetId
                )
        );

      if (invalidTarget) {
        showNotification({
          color: "red",
          title:
            "Hiányzó menetrendi cél",
          message:
            "Minden menetrendi sorhoz válassz létező scriptet vagy Movementet.",
        });
        return;
      }

      setSaving(true);

      try {
        await saveAutomationTimetable(
          normalized
        );

        setRows(
          normalized.map(
            toEditorRow
          )
        );

        onSaved?.();

        showNotification({
          color: "teal",
          title:
            "Menetrend elmentve",
          message:
            `${normalized.length} sor mentve az automations.json fájlba.`,
        });
      } catch (error) {
        showNotification({
          color: "red",
          title:
            "Menetrend mentési hiba",
          message:
            error instanceof Error
              ? error.message
              : String(error),
        });
      } finally {
        setSaving(false);
      }
    };

  return (
    <AppModal
      opened={opened}
      onClose={onClose}
      title="Menetrend"
      size="xl"
      centered
      draggable
      closeOnClickOutside={!saving}
      closeOnEscape={!saving}
    >
      <Stack gap="sm">
        <Alert
          color="blue"
          variant="light"
        >
          <Text size="sm">
            Az időzítés FastClock-alapú, kétmezős cron formátumot használ: <Code>PERC ÓRA</Code>.
            Példák: <Code>*/5 *</Code> = minden 5. percben, <Code>15 8</Code> = 08:15-kor.
            A menetrendi sor célja lehet automation script vagy Movement; a FastClock a megadott időpontban automatikusan elindítja a kiválasztott célt.
          </Text>
        </Alert>

        {loadError && (
          <Alert
            color="red"
            icon={
              <IconAlertTriangle
                size={18}
              />
            }
          >
            {loadError}
          </Alert>
        )}

        {scripts.length === 0 &&
          movements.length === 0 && (
          <Alert color="yellow">
            Előbb hozz létre legalább egy automation scriptet vagy Movementet, hogy menetrendi sort lehessen hozzá rendelni.
          </Alert>
        )}

        {loading ? (
          <Group
            justify="center"
            p="xl"
          >
            <Loader />
          </Group>
        ) : (
          <ScrollArea
            type="auto"
            offsetScrollbars
          >
            <Table
              striped
              highlightOnHover
              withTableBorder
              withColumnBorders
              miw={1180}
              verticalSpacing="xs"
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={90}>Enable</Table.Th>
                  <Table.Th w={150}>Időzítés típusa</Table.Th>
                  <Table.Th w={235}>Időzítés</Table.Th>
                  <Table.Th w={135}>Cél típusa</Table.Th>
                  <Table.Th>Cél</Table.Th>
                  <Table.Th w={52}></Table.Th>
                </Table.Tr>
              </Table.Thead>

              <Table.Tbody>
                {rows.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={6}>
                      <Text
                        ta="center"
                        c="dimmed"
                        py="md"
                      >
                        Nincs még menetrendi sor.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ) : rows.map(
                  row => {
                    const resolvedCron =
                      cronFromEditor(
                        row.editor
                      );

                    const cronValid =
                      isValidTimetableCron(
                        resolvedCron
                      );

                    return (
                      <Table.Tr
                        key={row.id}
                      >
                        <Table.Td>
                          <Switch
                            checked={
                              row.enabled
                            }
                            onChange={
                              event =>
                                updateRow(
                                  row.id,
                                  current => ({
                                    ...current,
                                    enabled:
                                      event.currentTarget.checked,
                                  })
                                )
                            }
                          />
                        </Table.Td>

                        <Table.Td>
                          <NativeSelect
                            size="xs"
                            value={
                              row.editor.mode
                            }
                            data={[
                              {
                                value: "time",
                                label: "Időpont",
                              },
                              {
                                value: "interval",
                                label: "Minden N perc",
                              },
                              {
                                value: "cron",
                                label: "Cron",
                              },
                            ]}
                            onChange={
                              event => {
                                const mode =
                                  event.currentTarget.value as ScheduleMode;

                                updateRow(
                                  row.id,
                                  current => ({
                                    ...current,
                                    editor: {
                                      ...current.editor,
                                      mode,
                                    },
                                  })
                                );
                              }
                            }
                          />
                        </Table.Td>

                        <Table.Td>
                          {row.editor.mode === "time" ? (
                            <Stack gap={3}>
                              <TextInput
                                size="xs"
                                type="time"
                                value={
                                  row.editor.time
                                }
                                onChange={
                                  event =>
                                    updateRow(
                                      row.id,
                                      current => ({
                                        ...current,
                                        editor: {
                                          ...current.editor,
                                          time:
                                            event.currentTarget.value,
                                        },
                                      })
                                    )
                                }
                              />
                              <Text
                                size="xs"
                                c="dimmed"
                              >
                                cron: <Code>{resolvedCron || "—"}</Code>
                              </Text>
                            </Stack>
                          ) : row.editor.mode === "interval" ? (
                            <Stack gap={3}>
                              <NumberInput
                                size="xs"
                                min={1}
                                max={59}
                                allowDecimal={false}
                                value={
                                  row.editor.intervalMinutes
                                }
                                suffix=" perc"
                                onChange={
                                  value =>
                                    updateRow(
                                      row.id,
                                      current => ({
                                        ...current,
                                        editor: {
                                          ...current.editor,
                                          intervalMinutes:
                                            typeof value === "number"
                                              ? value
                                              : Number(value) || 1,
                                        },
                                      })
                                    )
                                }
                              />
                              <Text
                                size="xs"
                                c="dimmed"
                              >
                                cron: <Code>{resolvedCron}</Code>
                              </Text>
                            </Stack>
                          ) : (
                            <TextInput
                              size="xs"
                              value={
                                row.editor.cron
                              }
                              error={
                                cronValid
                                  ? undefined
                                  : "PERC ÓRA"
                              }
                              placeholder="*/5 *"
                              onChange={
                                event =>
                                  updateRow(
                                    row.id,
                                    current => ({
                                      ...current,
                                      editor: {
                                        ...current.editor,
                                        cron:
                                          event.currentTarget.value,
                                      },
                                    })
                                  )
                              }
                            />
                          )}
                        </Table.Td>

                        <Table.Td>
                          <Select
                            size="xs"
                            clearable={
                              false
                            }
                            searchable={
                              false
                            }
                            data={[
                              {
                                value:
                                  "script",
                                label:
                                  "Script",
                              },
                              {
                                value:
                                  "movement",
                                label:
                                  "Movement",
                              },
                            ]}
                            value={
                              row.targetType
                            }
                            onChange={
                              value => {
                                const targetType =
                                  (
                                    value ===
                                    "movement"
                                      ? "movement"
                                      : "script"
                                  ) as TimetableTargetType;

                                updateRow(
                                  row.id,
                                  current => ({
                                    ...current,
                                    targetType,
                                    targetId:
                                      targetType ===
                                        "movement"
                                        ? movements[0]?.id ??
                                          ""
                                        : scripts[0]?.id ??
                                          "",
                                  })
                                );
                              }
                            }
                          />
                        </Table.Td>

                        <Table.Td>
                          <Select
                            size="xs"
                            searchable
                            clearable={
                              false
                            }
                            data={
                              row.targetType ===
                                "movement"
                                ? movementOptions
                                : scriptOptions
                            }
                            value={
                              row.targetId ||
                              null
                            }
                            placeholder={
                              row.targetType ===
                                "movement"
                                ? "Válassz Movementet"
                                : "Válassz scriptet"
                            }
                            onChange={
                              value =>
                                updateRow(
                                  row.id,
                                  current => ({
                                    ...current,
                                    targetId:
                                      value ??
                                      "",
                                  })
                                )
                            }
                          />
                        </Table.Td>

                        <Table.Td>
                          <Tooltip
                            label="Sor törlése"
                          >
                            <ActionIcon
                              color="red"
                              variant="light"
                              onClick={
                                () =>
                                  deleteRow(
                                    row.id
                                  )
                              }
                              aria-label="Sor törlése"
                            >
                              <IconTrash
                                size={16}
                              />
                            </ActionIcon>
                          </Tooltip>
                        </Table.Td>
                      </Table.Tr>
                    );
                  }
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}

        <Group
          justify="space-between"
          wrap="wrap"
        >
          <Button
            variant="light"
            leftSection={
              <IconPlus
                size={16}
              />
            }
            disabled={
              loading ||
              saving ||
              (
                scripts.length === 0 &&
                movements.length === 0
              )
            }
            onClick={
              () =>
                setRows(
                  current => [
                    ...current,
                    createEditorRow(
                      scripts,
                      movements
                    ),
                  ]
                )
            }
          >
            Új sor
          </Button>

          <Group gap="xs">
            <Button
              variant="default"
              disabled={saving}
              onClick={onClose}
            >
              Bezárás
            </Button>

            <Button
              leftSection={
                <IconDeviceFloppy
                  size={16}
                />
              }
              loading={saving}
              disabled={
                loading ||
                (
                  scripts.length === 0 &&
                  movements.length === 0 &&
                  rows.length > 0
                )
              }
              onClick={
                () => {
                  void persist();
                }
              }
            >
              Mentés
            </Button>
          </Group>
        </Group>
      </Stack>
    </AppModal>
  );
}
