import {
  ActionIcon,
  Alert,
  Button,
  Code,
  Group,
  Loader,
  NativeSelect,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  SegmentedControl,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";

import {
  showNotification,
} from "@mantine/notifications";

import {
  IconAlertTriangle,
  IconDeviceFloppy,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useTranslation,
} from "react-i18next";

import AppModal from "@/components/common/AppModal";
import TimetableTimeline from "@/components/TimetableTimeline";
import SelectMovementRouteDialog from "@/components/routes/SelectMovementRouteDialog";
import type { LayoutView } from "@/models/editor/core/LayoutView";
import type { MovementDocument } from "@/domain/movement";

import type {
  MovementPage,
} from "@/domain/movement";

import {
  isValidTimetableCron,
} from "@/domain/timetableCron";

export {
  isValidTimetableCron,
};

import {
  createTimetableActionId,
  createTimetableEntryId,
  loadAutomationTimetable,
  saveAutomationTimetable,
  type AutomationScriptDefinition,
  type TimetableActionDefinition,
  type TimetableEntryDefinition,
  type TimetableTargetType,
} from "@/services/automationApi";

type TimetableDialogProps = {
  opened: boolean;
  onClose: () => void;
  onSaved?: () => void;
  scripts:
    AutomationScriptDefinition[];
  movements:
    MovementPage[];
  layout: LayoutView;
  movementDocument: MovementDocument;
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
      Number(
        exact[1]
      );

    const hour =
      Number(
        exact[2]
      );

    if (
      minute >= 0 &&
      minute <= 59 &&
      hour >= 0 &&
      hour <= 23
    ) {
      return {
        mode:
          "time",
        time:
          `${String(
            hour
          ).padStart(
            2,
            "0"
          )}:${String(
            minute
          ).padStart(
            2,
            "0"
          )}`,
        intervalMinutes:
          5,
        cron:
          value,
      };
    }
  }

  const interval =
    value.match(
      /^\*\/(\d{1,2})\s+\*$/
    );

  if (interval) {
    const intervalMinutes =
      Number(
        interval[1]
      );

    if (
      intervalMinutes >=
        1 &&
      intervalMinutes <=
        59
    ) {
      return {
        mode:
          "interval",
        time:
          "08:00",
        intervalMinutes,
        cron:
          value,
      };
    }
  }

  return {
    mode:
      "cron",
    time:
      "08:00",
    intervalMinutes:
      5,
    cron:
      value ||
      "*/5 *",
  };
}

function cronFromEditor(
  editor:
    EditorSchedule
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
      Number(
        match[1]
      );

    const minute =
      Number(
        match[2]
      );

    return (
      `${minute} ${hour}`
    );
  }

  if (
    editor.mode ===
    "interval"
  ) {
    return (
      `*/${Math.trunc(
        editor.intervalMinutes
      )} *`
    );
  }

  return editor.cron.trim();
}

function toEditorRow(
  entry:
    TimetableEntryDefinition
): EditorRow {
  return {
    ...entry,
    actions:
      entry.actions.map(
        action => ({
          ...action,
        })
      ),
    editor:
      parseCronEditor(
        entry.cron
      ),
  };
}

function createDefaultAction(
  scripts:
    AutomationScriptDefinition[],
  movements:
    MovementPage[]
): TimetableActionDefinition {
  const targetType:
    TimetableTargetType =
    scripts.length > 0
      ? "script"
      : "movement";

  return {
    id:
      createTimetableActionId(),
    targetType,
    targetId:
      targetType ===
        "script"
        ? scripts[0]?.id ??
          ""
        : movements[0]?.id ??
          "",
  };
}

function createEditorRow(
  scripts:
    AutomationScriptDefinition[],
  movements:
    MovementPage[]
): EditorRow {
  return {
    id:
      createTimetableEntryId(),
    enabled:
      true,
    actions: [
      createDefaultAction(
        scripts,
        movements
      ),
    ],
    cron:
      "0 8",
    editor: {
      mode:
        "time",
      time:
        "08:00",
      intervalMinutes:
        5,
      cron:
        "0 8",
    },
  };
}

export default function TimetableDialog({
  opened,
  onClose,
  onSaved,
  scripts,
  movements,
  layout,
  movementDocument,
}: TimetableDialogProps) {
  const {
    t,
  } =
    useTranslation();

  const [routePicker, setRoutePicker] = useState<{ rowId: string; actionId: string } | null>(null);

  const [viewMode, setViewMode] = useState<"editor" | "timeline">("editor");

  const [
    rows,
    setRows,
  ] =
    useState<
      EditorRow[]
    >([]);

  const [
    loading,
    setLoading,
  ] =
    useState(
      false
    );

  const [
    saving,
    setSaving,
  ] =
    useState(
      false
    );

  const [
    loadError,
    setLoadError,
  ] =
    useState<
      string | null
    >(
      null
    );

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
      [
        scripts,
      ]
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

      setLoading(
        true
      );

      setLoadError(
        null
      );

      void loadAutomationTimetable()
        .then(
          entries => {
            if (
              cancelled
            ) {
              return;
            }

            setRows(
              entries.map(
                toEditorRow
              )
            );
          }
        )
        .catch(
          error => {
            if (
              cancelled
            ) {
              return;
            }

            setLoadError(
              error instanceof
                Error
                ? error.message
                : String(
                    error
                  )
            );
          }
        )
        .finally(
          () => {
            if (
              !cancelled
            ) {
              setLoading(
                false
              );
            }
          }
        );

      return () => {
        cancelled =
          true;
      };
    },
    [
      opened,
    ]
  );

  const updateRow =
    (
      id: string,
      update:
        (
          row:
            EditorRow
        ) => EditorRow
    ): void => {
      setRows(
        current =>
          current.map(
            row =>
              row.id ===
              id
                ? update(
                    row
                  )
                : row
          )
      );
    };

  const addAction =
    (
      rowId:
        string
    ): void => {
      updateRow(
        rowId,
        row => ({
          ...row,
          actions: [
            ...row.actions,
            createDefaultAction(
              scripts,
              movements
            ),
          ],
        })
      );
    };

  const updateAction =
    (
      rowId:
        string,
      actionId:
        string,
      update:
        (
          action:
            TimetableActionDefinition
        ) =>
          TimetableActionDefinition
    ): void => {
      updateRow(
        rowId,
        row => ({
          ...row,
          actions:
            row.actions.map(
              action =>
                action.id ===
                actionId
                  ? update(
                      action
                    )
                  : action
            ),
        })
      );
    };

  const deleteAction =
    (
      rowId:
        string,
      actionId:
        string
    ): void => {
      if (
        !window.confirm(
          t(
            "ui.timetableDeleteActionConfirm"
          )
        )
      ) {
        return;
      }

      updateRow(
        rowId,
        row => ({
          ...row,
          actions:
            row.actions.filter(
              action =>
                action.id !==
                actionId
            ),
        })
      );
    };

  const deleteRow =
    (
      id: string
    ): void => {
      if (
        !window.confirm(
          t(
            "ui.timetableDeleteRowConfirm"
          )
        )
      ) {
        return;
      }

      setRows(
        current =>
          current.filter(
            row =>
              row.id !==
              id
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
            actions:
              row.actions.map(
                action => ({
                  ...action,
                })
              ),
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

      if (
        invalidCron
      ) {
        showNotification({
          color:
            "red",
          title:
            t(
              "ui.timetableInvalidScheduleTitle"
            ),
          message:
            t(
              "ui.timetableInvalidScheduleMessage"
            ),
        });

        return;
      }

      const emptyEntry =
        normalized.find(
          entry =>
            entry.actions.length ===
            0
        );

      if (
        emptyEntry
      ) {
        showNotification({
          color:
            "red",
          title:
            t(
              "ui.timetableMissingActionTitle"
            ),
          message:
            t(
              "ui.timetableMissingActionMessage"
            ),
        });

        return;
      }

      const invalidAction =
        normalized
          .flatMap(
            entry =>
              entry.actions
          )
          .find(
            action =>
              action.targetType === "fromto"
                ? !action.routeRef || !action.speed || action.speed < 1 || action.speed > 126
                : action.targetType ===
                "movement"
                ? !movements.some(
                    movement =>
                      movement.id ===
                      action.targetId
                  )
                : !scripts.some(
                    script =>
                      script.id ===
                      action.targetId
                  )
          );

      if (
        invalidAction
      ) {
        showNotification({
          color:
            "red",
          title:
            t(
              "ui.timetableMissingTargetTitle"
            ),
          message:
            t(
              "ui.timetableMissingTargetMessage"
            ),
        });

        return;
      }

      setSaving(
        true
      );

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
          color:
            "teal",
          title:
            t(
              "ui.timetableSavedTitle"
            ),
          message:
            t(
              "ui.timetableSavedMessage",
              {
                count:
                  normalized.length,
              }
            ),
        });
      } catch (error) {
        showNotification({
          color:
            "red",
          title:
            t(
              "ui.timetableSaveFailedTitle"
            ),
          message:
            error instanceof
              Error
              ? error.message
              : String(
                  error
                ),
        });
      } finally {
        setSaving(
          false
        );
      }
    };

  return (
    <AppModal
      opened={
        opened
      }
      onClose={
        onClose
      }
      title={
        t(
          "ui.timetable"
        )
      }
      size={1360}
      centered
      draggable
      styles={{
        content: {
          height: 820,
          maxHeight:
            "calc(100dvh - 32px)",
          overflow:
            "hidden",
        },
        body: {
          height:
            "calc(100% - 56px)",
          overflow:
            "hidden",
        },
      }}
      closeOnClickOutside={
        !saving
      }
      closeOnEscape={
        !saving
      }
    >
      <Stack
        gap="sm"
        h="100%"
        style={{
          minHeight: 0,
        }}
      >
        <Alert
          color="blue"
          variant="light"
        >
          <Text
            size="sm"
          >
            {
              t(
                "ui.timetableEditorDescription"
              )
            }{" "}
            <Code>
              {
                t(
                  "ui.timetableCronFields"
                )
              }
            </Code>
          </Text>
        </Alert>

        {
          loadError && (
            <Alert
              color="red"
              icon={
                <IconAlertTriangle
                  size={18}
                />
              }
            >
              {
                loadError
              }
            </Alert>
          )
        }

        <SegmentedControl
          fullWidth
          value={viewMode}
          onChange={value => setViewMode(value as "editor" | "timeline")}
          data={[
            { value: "editor", label: "Timetable editor" },
            { value: "timeline", label: "Graphical timeline" },
          ]}
        />

        {viewMode === "timeline" && !loading && (
          <TimetableTimeline
            entries={rows.map(row => ({
              ...row,
              cron: cronFromEditor(row.editor),
            }))}
            movements={movements}
            scripts={scripts}
          />
        )}

        {viewMode === "editor" && (
          loading
            ? (
              <Group
                justify="center"
                align="center"
                p="xl"
                style={{
                  flex: 1,
                  minHeight: 0,
                }}
              >
                <Loader />
              </Group>
            )
            : (
              <ScrollArea
                type="always"
                offsetScrollbars
                scrollbarSize={10}
                style={{
                  flex: 1,
                  minHeight: 0,
                }}
              >
                <Table
                  striped
                  highlightOnHover
                  withTableBorder
                  withColumnBorders
                  miw={1280}
                  w="100%"
                  verticalSpacing="xs"
                  style={{
                    tableLayout:
                      "fixed",
                  }}
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th
                        w={76}
                      >
                        {
                          t(
                            "ui.enabled"
                          )
                        }
                      </Table.Th>

                      <Table.Th
                        w={150}
                      >
                        {
                          t(
                            "ui.timetableScheduleType"
                          )
                        }
                      </Table.Th>

                      <Table.Th
                        w={210}
                      >
                        {
                          t(
                            "ui.timetableSchedule"
                          )
                        }
                      </Table.Th>

                      <Table.Th
                        w={790}
                      >
                        {
                          t(
                            "ui.timetableActions"
                          )
                        }
                      </Table.Th>

                      <Table.Th
                        w={52}
                      />
                    </Table.Tr>
                  </Table.Thead>

                  <Table.Tbody>
                    {
                      rows.length ===
                        0
                        ? (
                          <Table.Tr>
                            <Table.Td
                              colSpan={5}
                            >
                              <Text
                                ta="center"
                                c="dimmed"
                                py="md"
                              >
                                {
                                  t(
                                    "ui.timetableNoRows"
                                  )
                                }
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        )
                        : rows.map(
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
                                key={
                                  row.id
                                }
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
                                        value:
                                          "time",
                                        label:
                                          t(
                                            "ui.timetableExactTime"
                                          ),
                                      },
                                      {
                                        value:
                                          "interval",
                                        label:
                                          t(
                                            "ui.timetableEveryNMinutes"
                                          ),
                                      },
                                      {
                                        value:
                                          "cron",
                                        label:
                                          "Cron",
                                      },
                                    ]}
                                    onChange={
                                      event => {
                                        const mode =
                                          event.currentTarget.value as
                                            ScheduleMode;

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
                                  {
                                    row.editor.mode ===
                                      "time"
                                      ? (
                                        <Stack
                                          gap={3}
                                        >
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
                                            cron:{" "}
                                            <Code>
                                              {
                                                resolvedCron ||
                                                "—"
                                              }
                                            </Code>
                                          </Text>
                                        </Stack>
                                      )
                                      : row.editor.mode ===
                                          "interval"
                                        ? (
                                          <Stack
                                            gap={3}
                                          >
                                            <NumberInput
                                              size="xs"
                                              min={1}
                                              max={59}
                                              allowDecimal={
                                                false
                                              }
                                              value={
                                                row.editor.intervalMinutes
                                              }
                                              suffix={
                                                ` ${t(
                                                  "ui.minutesShort"
                                                )}`
                                              }
                                              onChange={
                                                value =>
                                                  updateRow(
                                                    row.id,
                                                    current => ({
                                                      ...current,
                                                      editor: {
                                                        ...current.editor,
                                                        intervalMinutes:
                                                          typeof value ===
                                                            "number"
                                                            ? value
                                                            : Number(
                                                                value
                                                              ) ||
                                                              1,
                                                      },
                                                    })
                                                  )
                                              }
                                            />

                                            <Text
                                              size="xs"
                                              c="dimmed"
                                            >
                                              cron:{" "}
                                              <Code>
                                                {
                                                  resolvedCron
                                                }
                                              </Code>
                                            </Text>
                                          </Stack>
                                        )
                                        : (
                                          <TextInput
                                            size="xs"
                                            value={
                                              row.editor.cron
                                            }
                                            error={
                                              cronValid
                                                ? undefined
                                                : t(
                                                    "ui.timetableCronFields"
                                                  )
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
                                        )
                                  }
                                </Table.Td>

                                <Table.Td>
                                  <Stack
                                    gap="xs"
                                  >
                                    {
                                      row.actions.map(
                                        (
                                          action,
                                          actionIndex
                                        ) => (
                                          <Paper
                                            key={
                                              action.id
                                            }
                                            withBorder
                                            p="xs"
                                            radius="sm"
                                          >
                                            <Group
                                              gap="xs"
                                              align="center"
                                              wrap="nowrap"
                                            >
                                              <Text
                                                size="xs"
                                                fw={700}
                                                w={58}
                                                style={{
                                                  flex:
                                                    "0 0 58px",
                                                }}
                                              >
                                                {
                                                  `${t(
                                                    "ui.timetableAction"
                                                  )} ${actionIndex + 1}`
                                                }
                                              </Text>

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
                                                      t(
                                                        "ui.timetableScriptType"
                                                      ),
                                                  },
                                                  // Movement remains supported by storage/runtime;
                                                  // hide it from new Timetable action selection for now.
                                                  // {
                                                  //                                                     value:
                                                  //                                                       "movement",
                                                  //                                                     label:
                                                  //                                                       "Movement",
                                                  //                                                   },
                                                  { value: "fromto", label: "From–To" },
                                                ]}
                                                value={
                                                  action.targetType
                                                }
                                                onChange={
                                                  value => {
                                                    const targetType =
                                                      (
                                                        value === "fromto" ? "fromto" :
                                                        value === "movement" ? "movement" : "script"
                                                      ) as
                                                        TimetableTargetType;

                                                    updateAction(
                                                      row.id,
                                                      action.id,
                                                      current => ({
                                                        ...current,
                                                        targetType,
                                                        targetId:
                                                          targetType === "fromto" ? "" :
                                                          targetType === "movement"
                                                            ? movements[0]?.id ?? ""
                                                            : scripts[0]?.id ?? "",
                                                        ...(targetType === "fromto"
                                                          ? { routeRef: null, speed: 20 }
                                                          : { routeRef: null }),
                                                      })
                                                    );
                                                  }
                                                }
                                                w={125}
                                                style={{
                                                  flex:
                                                    "0 0 125px",
                                                }}
                                              />

                                              {action.targetType === "fromto" ? (
                                                <Group gap={4} wrap="nowrap">
                                                  <Text size="xs" w={225} truncate>{action.targetId ? `${action.targetId} · Speed ${action.speed ?? 20}` : "Select exact route"}</Text>
                                                  <Button size="compact-xs" variant="light" onClick={() => setRoutePicker({ rowId: row.id, actionId: action.id })}>...</Button>
                                                </Group>
                                              ) : <Select
                                                size="xs"
                                                searchable
                                                clearable={
                                                  false
                                                }
                                                data={
                                                  action.targetType ===
                                                    "movement"
                                                    ? movementOptions
                                                    : scriptOptions
                                                }
                                                value={
                                                  action.targetId ||
                                                  null
                                                }
                                                placeholder={
                                                  action.targetType ===
                                                    "movement"
                                                    ? t(
                                                        "ui.timetableSelectMovement"
                                                      )
                                                    : t(
                                                        "ui.timetableSelectScript"
                                                      )
                                                }
                                                onChange={
                                                  value =>
                                                    updateAction(
                                                      row.id,
                                                      action.id,
                                                      current => ({
                                                        ...current,
                                                        targetId:
                                                          value ??
                                                          "",
                                                      })
                                                    )
                                                }
                                                w={290}
                                                maw={290}
                                                style={{
                                                  flex:
                                                    "0 0 290px",
                                                }}
                                              />}

                                              <Tooltip
                                                label={
                                                  t(
                                                    "ui.timetableDeleteAction"
                                                  )
                                                }
                                              >
                                                <ActionIcon
                                                  color="red"
                                                  variant="light"
                                                  aria-label={
                                                    t(
                                                      "ui.timetableDeleteAction"
                                                    )
                                                  }
                                                  onClick={
                                                    () =>
                                                      deleteAction(
                                                        row.id,
                                                        action.id
                                                      )
                                                  }
                                                >
                                                  <IconTrash
                                                    size={16}
                                                  />
                                                </ActionIcon>
                                              </Tooltip>
                                            </Group>
                                          </Paper>
                                        )
                                      )
                                    }

                                    <Button
                                      size="compact-xs"
                                      variant="light"
                                      leftSection={
                                        <IconPlus
                                          size={14}
                                        />
                                      }
                                      disabled={
                                        scripts.length ===
                                          0 &&
                                        movements.length ===
                                          0
                                      }
                                      onClick={
                                        () =>
                                          addAction(
                                            row.id
                                          )
                                      }
                                    >
                                      {
                                        t(
                                          "ui.timetableAddAction"
                                        )
                                      }
                                    </Button>
                                  </Stack>
                                </Table.Td>

                                <Table.Td>
                                  <Tooltip
                                    label={
                                      t(
                                        "ui.timetableDeleteRow"
                                      )
                                    }
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
                                      aria-label={
                                        t(
                                          "ui.timetableDeleteRow"
                                        )
                                      }
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
                        )
                    }
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            )
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
                scripts.length ===
                  0 &&
                movements.length ===
                  0
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
            {
              t(
                "ui.timetableAddRow"
              )
            }
          </Button>

          <Group
            gap="xs"
          >
            <Button
              variant="default"
              disabled={
                saving
              }
              onClick={
                onClose
              }
            >
              {
                t(
                  "ui.close"
                )
              }
            </Button>

            <Button
              leftSection={
                <IconDeviceFloppy
                  size={16}
                />
              }
              loading={
                saving
              }
              disabled={loading}
              onClick={
                () => {
                  void persist();
                }
              }
            >
              {
                t(
                  "ui.save"
                )
              }
            </Button>
          </Group>
        </Group>
      </Stack>
      <SelectMovementRouteDialog
        opened={routePicker !== null}
        onClose={() => setRoutePicker(null)}
        layout={layout}
        movements={movementDocument}
        editingMovementId={null}
        onMovementsChange={() => {}}
        initialRoute={(() => {
          const action = rows.find(row => row.id === routePicker?.rowId)
            ?.actions.find(action => action.id === routePicker?.actionId);
          return action?.routeRef
            ? { name: action.targetId.replace(/ \((forward|reverse)\)$/i, ""),
                speed: action.speed ?? 20, routeRef: action.routeRef }
            : null;
        })()}
        onSelectRoute={page => {
          if (!routePicker || !page.routeRef) return;
          updateAction(routePicker.rowId, routePicker.actionId, current => ({
            ...current, targetType: "fromto",
            targetId: page.name + " (" + page.routeRef!.direction + ")",
            routeRef: page.routeRef,
            speed: page.speed,
          }));
          setRoutePicker(null);
        }}
      />
    </AppModal>
  );
}
