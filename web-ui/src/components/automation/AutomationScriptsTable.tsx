import {
  lazy,
  Suspense,
  useEffect,
  useState,
} from "react";

import i18next from "i18next";

import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";

import {
  showNotification,
} from "@mantine/notifications";

import {
  IconCode,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerPlayFilled,
  IconTrash,
  IconTrashX,
} from "@tabler/icons-react";

import {
  saveAutomationScripts,
  type AutomationScriptDefinition,
} from "../../services/automationApi";

import {
  abortClientScript,
  getAutomationFinishing,
  getClientScriptState,
  pauseClientScript,
  resumeClientScript,
  runClientScript,
  ScriptAbortError,
  setAutomationFinishing,
  subscribeAutomationFinishing,
  subscribeClientScriptState,
  type ClientScriptState,
} from "../../services/clientScriptRunner";

import {
  getSharedScriptInfo,
  subscribeSharedScriptInfo,
} from "../../services/scriptInfoRuntime";

import {
  automationPanelText,
} from "../automation-panel-i18n";

import {
  useCommandCenter,
} from "../../context/CommandCenterContext";

import {
  wsApi,
} from "../../services/wsApi";

const ScriptEditorDialog =
  lazy(
    () =>
      import(
        "../ScriptEditorDialog"
      )
  );

type Props = {
  scripts:
    AutomationScriptDefinition[];
  onScriptsChange: (
    scripts:
      AutomationScriptDefinition[]
  ) => void;
};

type RowProps = {
  definition:
    AutomationScriptDefinition;
  onChange: (
    next:
      AutomationScriptDefinition
  ) => void;
  onSave: (
    next:
      AutomationScriptDefinition
  ) => Promise<void>;
  onDelete: () => void;
};

function executionId(
  scriptId: string
): string {
  return `automation:${scriptId}`;
}

function statusColor(
  state:
    ClientScriptState
): string {
  if (
    state.status ===
    "running"
  ) {
    return "green";
  }

  if (
    state.status ===
    "paused"
  ) {
    return "yellow";
  }

  return "gray";
}

function ScriptRow({
  definition,
  onChange,
  onSave,
  onDelete,
}: RowProps) {
  const id =
    executionId(
      definition.id
    );

  const [
    state,
    setState,
  ] =
    useState<
      ClientScriptState
    >(
      () =>
        getClientScriptState(
          id
        )
    );

  const [
    info,
    setInfo,
  ] =
    useState<
      string |
      null
    >(
      () =>
        getSharedScriptInfo(
          id
        )
    );

  const [
    editorOpened,
    setEditorOpened,
  ] =
    useState(false);

  const [
    deleteConfirmOpened,
    setDeleteConfirmOpened,
  ] =
    useState(false);

  useEffect(
    () =>
      subscribeClientScriptState(
        id,
        setState
      ),
    [
      id,
    ]
  );

  useEffect(
    () =>
      subscribeSharedScriptInfo(
        id,
        setInfo
      ),
    [
      id,
    ]
  );

  const run =
    async (
      source:
        string
    ): Promise<void> => {
      try {
        await runClientScript(
          source,
          {
            id,
            name:
              definition.name,
            type:
              "automation",
          }
        );

        showNotification({
          color:
            "green",
          title:
            i18next.t(
              "ui.automationCompleted"
            ),
          message:
            definition.name,
        });
      } catch (
        error
      ) {
        if (
          error instanceof
          ScriptAbortError
        ) {
          return;
        }

        showNotification({
          color:
            "red",
          title:
            i18next.t(
              "ui.automationFailed"
            ),
          message:
            error instanceof Error
              ? error.message
              : String(
                  error
                ),
        });

        throw error;
      }
    };

  const idle =
    state.status ===
    "idle";

  const running =
    state.status ===
    "running";

  const paused =
    state.status ===
    "paused";

  const toggleStartWithAll =
    (): void => {
      const next = {
        ...definition,
        startWithAll:
          definition.startWithAll ===
          false,
      };

      onChange(
        next
      );

      void onSave(
        next
      ).catch(
        error => {
          showNotification({
            color:
              "red",
            title:
              automationPanelText(
                "settingSaveFailed"
              ),
            message:
              error instanceof Error
                ? error.message
                : String(
                    error
                  ),
          });
        }
      );
    };

  return (
    <>
      <Table.Tr>
        <Table.Td>
          <Badge
            size="sm"
            variant="light"
            color={
              statusColor(
                state
              )
            }
          >
            {
              state.status.toUpperCase()
            }
          </Badge>
        </Table.Td>

        <Table.Td>
          <Tooltip
            withArrow
            label={
              automationPanelText(
                "startWithAllDescription"
              )
            }
          >
            <ActionIcon
              size="sm"
              variant={
                definition.startWithAll !==
                false
                  ? "filled"
                  : "light"
              }
              color={
                definition.startWithAll !==
                false
                  ? "lime"
                  : "gray"
              }
              onClick={
                toggleStartWithAll
              }
            >
              {
                definition.startWithAll !==
                false
                  ? (
                    <IconPlayerPlayFilled
                      size={14}
                    />
                  )
                  : (
                    <IconPlayerPlay
                      size={14}
                    />
                  )
              }
            </ActionIcon>
          </Tooltip>
        </Table.Td>

        <Table.Td>
          <TextInput
            size="xs"
            value={
              definition.name
            }
            onChange={
              event =>
                onChange({
                  ...definition,
                  name:
                    event.currentTarget
                      .value,
                })
            }
            onBlur={
              () =>
                void onSave(
                  definition
                ).catch(
                  () =>
                    undefined
                )
            }
          />
        </Table.Td>

        <Table.Td>
          <Text
            size="xs"
            c="dimmed"
          >
            {
              definition.script.trim()
                ? `${definition.script.split("\n").length} lines`
                : i18next.t(
                    "ui.emptyScript"
                  )
            }
          </Text>
        </Table.Td>

        <Table.Td>
          <Text
            size="xs"
            c={
              info
                ? "blue"
                : "dimmed"
            }
            truncate
            maw={280}
          >
            {
              info ||
              "—"
            }
          </Text>
        </Table.Td>

        <Table.Td>
          <Group
            gap={5}
            wrap="nowrap"
            justify="flex-end"
          >
            <Button
              size="compact-xs"
              variant="light"
              color="green"
              leftSection={
                <IconPlayerPlay
                  size={13}
                />
              }
              disabled={
                running ||
                !definition.script.trim()
              }
              onClick={
                () => {
                  if (paused) {
                    resumeClientScript(
                      id
                    );
                    return;
                  }

                  void run(
                    definition.script
                  ).catch(
                    () =>
                      undefined
                  );
                }
              }
            >
              {
                paused
                  ? i18next.t(
                      "ui.resume"
                    )
                  : i18next.t(
                      "ui.start"
                    )
              }
            </Button>

            <Button
              size="compact-xs"
              variant="light"
              color="yellow"
              leftSection={
                <IconPlayerPause
                  size={13}
                />
              }
              disabled={
                !running
              }
              onClick={
                () =>
                  pauseClientScript(
                    id
                  )
              }
            >
              {
                i18next.t(
                  "ui.stop"
                )
              }
            </Button>

            <Button
              size="compact-xs"
              variant="light"
              color="red"
              leftSection={
                <IconTrashX
                  size={13}
                />
              }
              disabled={
                idle
              }
              onClick={
                () =>
                  abortClientScript(
                    id
                  )
              }
            >
              {
                i18next.t(
                  "ui.abort"
                )
              }
            </Button>

            <Tooltip
              label={
                i18next.t(
                  "ui.editScript"
                )
              }
            >
              <ActionIcon
                size="sm"
                variant="light"
                color="violet"
                onClick={
                  () =>
                    setEditorOpened(
                      true
                    )
                }
              >
                <IconCode
                  size={15}
                />
              </ActionIcon>
            </Tooltip>

            <Tooltip
              label={
                idle
                  ? i18next.t(
                      "ui.deleteScript"
                    )
                  : i18next.t(
                      "ui.stopOrAbortTheScriptBeforeDeletingIt"
                    )
              }
            >
              <ActionIcon
                size="sm"
                variant="light"
                color="red"
                disabled={
                  !idle
                }
                onClick={
                  () =>
                    setDeleteConfirmOpened(
                      true
                    )
                }
              >
                <IconTrash
                  size={15}
                />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Table.Td>
      </Table.Tr>

      <Modal
        opened={
          deleteConfirmOpened
        }
        onClose={
          () =>
            setDeleteConfirmOpened(
              false
            )
        }
        title={
          i18next.t(
            "ui.deleteScriptConfirmTitle",
            {
              defaultValue:
                "Delete script?",
            }
          )
        }
        centered
      >
        <Stack gap="md">
          <Text
            size="sm"
          >
            {
              i18next.t(
                "ui.deleteScriptConfirmMessage",
                {
                  defaultValue:
                    "Are you sure you want to permanently delete '{{name}}'? This cannot be undone.",
                  name:
                    definition.name ||
                    i18next.t(
                      "ui.unnamedScript",
                      {
                        defaultValue:
                          "Unnamed script",
                      }
                    ),
                }
              )
            }
          </Text>

          <Group
            justify="flex-end"
            gap="xs"
          >
            <Button
              variant="default"
              onClick={
                () =>
                  setDeleteConfirmOpened(
                    false
                  )
              }
            >
              {
                i18next.t(
                  "ui.cancel",
                  {
                    defaultValue:
                      "Cancel",
                  }
                )
              }
            </Button>

            <Button
              color="red"
              leftSection={
                <IconTrash
                  size={15}
                />
              }
              onClick={
                () => {
                  setDeleteConfirmOpened(
                    false
                  );
                  onDelete();
                }
              }
            >
              {
                i18next.t(
                  "ui.delete",
                  {
                    defaultValue:
                      "Delete",
                  }
                )
              }
            </Button>
          </Group>
        </Stack>
      </Modal>

      {editorOpened && (
        <Suspense
          fallback={
            <Loader />
          }
        >
          <ScriptEditorDialog
            opened={
              editorOpened
            }
            title={
              i18next.t(
                "ui.automation",
                {
                  value1:
                    definition.name ||
                    "Unnamed script",
                }
              )
            }
            value={
              definition.script
            }
            scriptStatus={
              state.status
            }
            onClose={
              () =>
                setEditorOpened(
                  false
                )
            }
            onSave={
              value => {
                const next = {
                  ...definition,
                  script:
                    value,
                };

                onChange(
                  next
                );

                void onSave(
                  next
                );
              }
            }
            onRun={
              run
            }
            onPause={
              () =>
                pauseClientScript(
                  id
                )
            }
            onResume={
              () =>
                resumeClientScript(
                  id
                )
            }
            onAbort={
              () =>
                abortClientScript(
                  id
                )
            }
          />
        </Suspense>
      )}
    </>
  );
}

export default function AutomationScriptsTable({
  scripts,
  onScriptsChange,
}: Props) {
  const commandCenter =
    useCommandCenter();

  const [
    finishing,
    setFinishingState,
  ] =
    useState(
      () =>
        getAutomationFinishing()
    );

  useEffect(
    () =>
      subscribeAutomationFinishing(
        setFinishingState
      ),
    []
  );

  const [
    runtimeStates,
    setRuntimeStates,
  ] =
    useState<
      Record<
        string,
        ClientScriptState
      >
    >({});

  const signature =
    scripts
      .map(
        script =>
          script.id
      )
      .join(
        "\u001f"
      );

  useEffect(
    () => {
      const unsubscribes =
        scripts.map(
          script => {
            const id =
              executionId(
                script.id
              );

            return subscribeClientScriptState(
              id,
              state => {
                setRuntimeStates(
                  current => ({
                    ...current,
                    [script.id]:
                      state,
                  })
                );
              }
            );
          }
        );

      setRuntimeStates(
        Object.fromEntries(
          scripts.map(
            script => [
              script.id,
              getClientScriptState(
                executionId(
                  script.id
                )
              ),
            ]
          )
        )
      );

      return () => {
        for (
          const unsubscribe of
          unsubscribes
        ) {
          unsubscribe();
        }
      };
    },
    [
      signature,
    ]
  );

  const runningCount =
    scripts.filter(
      script =>
        runtimeStates[
          script.id
        ]?.status ===
        "running"
    ).length;

  const pausedCount =
    scripts.filter(
      script =>
        runtimeStates[
          script.id
        ]?.status ===
        "paused"
    ).length;

  const startableCount =
    scripts.filter(
      script =>
        (
          runtimeStates[
            script.id
          ]?.status ??
          "idle"
        ) ===
          "idle" &&
        script.startWithAll !==
          false &&
        Boolean(
          script.script.trim()
        )
    ).length;

  const updateScript =
    (
      id: string,
      next:
        AutomationScriptDefinition
    ): void => {
      onScriptsChange(
        scripts.map(
          script =>
            script.id ===
            id
              ? next
              : script
        )
      );
    };

  const saveScript =
    async (
      id: string,
      next:
        AutomationScriptDefinition
    ): Promise<void> => {
      const nextScripts =
        scripts.map(
          script =>
            script.id ===
            id
              ? next
              : script
        );

      onScriptsChange(
        nextScripts
      );

      await saveAutomationScripts(
        nextScripts
      );
    };

  const deleteScript =
    (
      id: string
    ): void => {
      const next =
        scripts.filter(
          script =>
            script.id !==
            id
        );

      onScriptsChange(
        next
      );

      void saveAutomationScripts(
        next
      );
    };

  const createScript =
    (): void => {
      const id =
        typeof crypto !==
          "undefined" &&
        typeof crypto.randomUUID ===
          "function"
          ? crypto.randomUUID()
          : `automation-${Date.now()}`;

      const next = [
        ...scripts,
        {
          id,
          name:
            `Automation ${scripts.length + 1}`,
          script:
            "",
          startWithAll:
            true,
        },
      ];

      onScriptsChange(
        next
      );

      void saveAutomationScripts(
        next
      );
    };

  const startAll =
    (): void => {
      let started = 0;

      for (
        const definition of
        scripts
      ) {
        if (
          definition.startWithAll ===
            false ||
          !definition.script.trim() ||
          getClientScriptState(
            executionId(
              definition.id
            )
          ).status !==
            "idle"
        ) {
          continue;
        }

        started += 1;

        void runClientScript(
          definition.script,
          {
            id:
              executionId(
                definition.id
              ),
            name:
              definition.name,
            type:
              "automation",
          }
        ).catch(
          error => {
            if (
              error instanceof
              ScriptAbortError
            ) {
              return;
            }

            showNotification({
              color:
                "red",
              title:
                i18next.t(
                  "ui.automationFailed"
                ),
              message:
                error instanceof Error
                  ? error.message
                  : String(
                      error
                    ),
            });
          }
        );
      }

      showNotification({
        color:
          started > 0
            ? "green"
            : "gray",
        title:
          automationPanelText(
            "startAll"
          ),
        message:
          started > 0
            ? automationPanelText(
                "startAllStarted",
                {
                  count:
                    started,
                }
              )
            : automationPanelText(
                "noStartableScripts"
              ),
      });
    };

  const resumeAll =
    (): void => {
      let resumed = 0;

      for (
        const script of
        scripts
      ) {
        if (
          resumeClientScript(
            executionId(
              script.id
            )
          )
        ) {
          resumed += 1;
        }
      }

      showNotification({
        color:
          resumed > 0
            ? "cyan"
            : "gray",
        title:
          automationPanelText(
            "resumeAll"
          ),
        message:
          resumed > 0
            ? automationPanelText(
                "resumeAllResumed",
                {
                  count:
                    resumed,
                }
              )
            : automationPanelText(
                "noPausedScripts"
              ),
      });
    };

  const stopAll =
    (): void => {
      let stopped = 0;

      for (
        const script of
        scripts
      ) {
        if (
          pauseClientScript(
            executionId(
              script.id
            )
          )
        ) {
          stopped += 1;
        }
      }

      showNotification({
        color:
          stopped > 0
            ? "yellow"
            : "gray",
        title:
          automationPanelText(
            "stopAll"
          ),
        message:
          stopped > 0
            ? automationPanelText(
                "stopAllPaused",
                {
                  count:
                    stopped,
                }
              )
            : automationPanelText(
                "noRunningScripts"
              ),
      });
    };

  const abortAll =
    (): void => {
      let aborted = 0;

      for (
        const script of
        scripts
      ) {
        if (
          abortClientScript(
            executionId(
              script.id
            ),
            "All automation scripts aborted by user."
          )
        ) {
          aborted += 1;
        }
      }

      const emergencyKnownOff =
        commandCenter.powerInfo
          ?.emergencyStop ===
        false;

      const emergencyAlreadyOn =
        commandCenter.powerInfo
          ?.emergencyStop ===
        true;

      const emergencySent =
        emergencyKnownOff
          ? wsApi.emergencyStop()
          : false;

      let emergencyMessage =
        automationPanelText(
          "estopUnknown"
        );

      if (
        emergencyAlreadyOn
      ) {
        emergencyMessage =
          automationPanelText(
            "estopAlreadyActive"
          );
      } else if (
        emergencySent
      ) {
        emergencyMessage =
          automationPanelText(
            "estopRequested"
          );
      } else if (
        emergencyKnownOff
      ) {
        emergencyMessage =
          automationPanelText(
            "estopSendFailed"
          );
      }

      showNotification({
        color:
          "red",
        title:
          automationPanelText(
            "abortAll"
          ),
        message:
          `${automationPanelText(
            "abortAllAborted",
            {
              count:
                aborted,
            }
          )} ${emergencyMessage}`,
      });
    };

  return (
    <Stack
      gap="sm"
      h="100%"
    >
      <Group
        justify="space-between"
        align="center"
      >
        <Group gap="xs">
          <Badge
            variant="light"
            color={
              runningCount > 0
                ? "green"
                : "gray"
            }
          >
            {i18next.t("ui.running", { defaultValue: "Running" })}: {
              runningCount
            }
          </Badge>

          <Badge
            variant="light"
            color={
              pausedCount > 0
                ? "yellow"
                : "gray"
            }
          >
            {i18next.t("ui.paused", { defaultValue: "Paused" })}: {
              pausedCount
            }
          </Badge>

          <Tooltip
            withArrow
            label={
              automationPanelText(
                "finishingDescription"
              )
            }
          >
            <Switch
              size="sm"
              color="orange"
              label={
                automationPanelText(
                  "finishing"
                )
              }
              checked={
                finishing
              }
              onChange={
                event =>
                  setAutomationFinishing(
                    event.currentTarget
                      .checked
                  )
              }
            />
          </Tooltip>
        </Group>

        <Group gap="xs">
          <Button
            size="xs"
            variant="light"
            color="green"
            disabled={
              startableCount ===
              0
            }
            onClick={
              startAll
            }
          >
            {
              automationPanelText(
                "startAll"
              )
            }
          </Button>

          <Button
            size="xs"
            variant="light"
            color="cyan"
            disabled={
              pausedCount ===
              0
            }
            onClick={
              resumeAll
            }
          >
            {
              automationPanelText(
                "resumeAll"
              )
            }
          </Button>

          <Button
            size="xs"
            variant="light"
            color="yellow"
            disabled={
              runningCount ===
              0
            }
            onClick={
              stopAll
            }
          >
            {
              automationPanelText(
                "stopAll"
              )
            }
          </Button>

          <Button
            size="xs"
            variant="light"
            color="red"
            disabled={
              runningCount +
              pausedCount ===
              0
            }
            onClick={
              abortAll
            }
          >
            {
              automationPanelText(
                "abortAll"
              )
            }
          </Button>

          <Button
            size="xs"
            onClick={
              createScript
            }
          >
            +
            {" "}
            {
              i18next.t(
                "ui.newScript"
              )
            }
          </Button>
        </Group>
      </Group>

      <ScrollArea
        style={{
          flex: 1,
          minHeight: 0,
        }}
        type="always"
      >
        <Table
          striped
          highlightOnHover
          withTableBorder
          withColumnBorders
          verticalSpacing="xs"
          horizontalSpacing="sm"
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>
                {i18next.t("ui.automationStatus", { defaultValue: "Status" })}
              </Table.Th>
              <Table.Th
                w={54}
              >
                {i18next.t("ui.automationStartAllColumn", { defaultValue: "All" })}
              </Table.Th>
              <Table.Th>
                {
                  i18next.t(
                    "ui.name"
                  )
                }
              </Table.Th>
              <Table.Th>
                {i18next.t("ui.automationScriptColumn", { defaultValue: "Script" })}
              </Table.Th>
              <Table.Th>
                {i18next.t("ui.info", { defaultValue: "Info" })}
              </Table.Th>
              <Table.Th
                ta="right"
              >
                {i18next.t("ui.automationActions", { defaultValue: "Actions" })}
              </Table.Th>
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {
              scripts.map(
                definition => (
                  <ScriptRow
                    key={
                      definition.id
                    }
                    definition={
                      definition
                    }
                    onChange={
                      next =>
                        updateScript(
                          definition.id,
                          next
                        )
                    }
                    onSave={
                      next =>
                        saveScript(
                          definition.id,
                          next
                        )
                    }
                    onDelete={
                      () =>
                        deleteScript(
                          definition.id
                        )
                    }
                  />
                )
              )
            }
          </Table.Tbody>
        </Table>

        {scripts.length ===
          0 && (
          <Text
            size="sm"
            c="dimmed"
            ta="center"
            py="xl"
          >
            {
              i18next.t(
                "ui.noAutomationScripts"
              )
            }
          </Text>
        )}
      </ScrollArea>
    </Stack>
  );
}
