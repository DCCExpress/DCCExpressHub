import { useTranslation } from "react-i18next";
import i18next from "i18next";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";

import {
  showNotification,
} from "@mantine/notifications";

import {
  IconAlertTriangle,
  IconCode,
  IconInfoCircle,
  IconPlus,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerPlayFilled,
  IconTrash,
  IconTrashX,
} from "@tabler/icons-react";

import {
  saveAutomationScripts,
  type AutomationScriptDefinition,
} from "../services/automationApi";

import {
  getSharedScriptInfo,
  subscribeSharedScriptInfo,
} from "../services/scriptInfoRuntime";

import {
  abortClientScript,
  getClientScriptState,
  pauseClientScript,
  resumeClientScript,
  runClientScript,
  ScriptAbortError,
  subscribeClientScriptState,
  type ClientScriptState,
} from "../services/clientScriptRunner";

import {
  wsApi,
} from "../services/wsApi";

import {
  useCommandCenter,
} from "../context/CommandCenterContext";

import {
  automationPanelText,
} from "./automation-panel-i18n";

const ScriptEditorDialog =
  lazy(
    () =>
      import(
        "./ScriptEditorDialog"
      )
  );

type AutomationPanelProps = {
  scripts: AutomationScriptDefinition[];
  onScriptsChange: (
    scripts: AutomationScriptDefinition[]
  ) => void;
};

type ScriptCardProps = {
  definition: AutomationScriptDefinition;
  onChange: (
    next: AutomationScriptDefinition
  ) => void;
  onSave: (
    next: AutomationScriptDefinition
  ) => Promise<void>;
  onDelete: () => void;
};

type AutomationRuntimeStateMap =
  Record<string, ClientScriptState>;

function createAutomationId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return (
    `automation-${Date.now()}-` +
    Math.random()
      .toString(36)
      .slice(2, 10)
  );
}

function executionId(
  scriptId: string
): string {
  return `automation:${scriptId}`;
}

function stateColor(
  state: ClientScriptState
): string {
  if (
    state.status === "running"
  ) {
    return "green";
  }

  if (
    state.status === "paused"
  ) {
    return "yellow";
  }

  return "gray";
}

function ScriptCard({
  definition,
  onChange,
  onSave,
  onDelete,
}: ScriptCardProps) {
  useTranslation();

  const [
    opened,
    setOpened,
  ] =
    useState(false);

  const id =
    executionId(
      definition.id
    );

  const [
    scriptState,
    setScriptState,
  ] =
    useState<ClientScriptState>(
      () =>
        getClientScriptState(
          id
        )
    );

  const [
    sharedInfo,
    setSharedInfo,
  ] =
    useState<string | null>(
      () =>
        getSharedScriptInfo(
          id
        )
    );

  useEffect(
    () =>
      subscribeClientScriptState(
        id,
        setScriptState
      ),
    [id]
  );

  useEffect(
    () =>
      subscribeSharedScriptInfo(
        id,
        setSharedInfo
      ),
    [id]
  );

  const context =
    useMemo(
      () => ({
        id,
        name:
          definition.name,
        type:
          "automation",
      }),
      [
        id,
        definition.name,
      ]
    );

  const run =
    async (
      source: string
    ): Promise<void> => {
      try {
        await runClientScript(
          source,
          context
        );

        showNotification({
          color: "green",
          title:
            i18next.t("ui.automationCompleted"),
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
          showNotification({
            color: "orange",
            title:
              i18next.t("ui.automationAborted"),
            message:
              definition.name,
          });

          throw error;
        }

        showNotification({
          color: "red",
          title:
            i18next.t("ui.automationFailed"),
          message:
            error instanceof Error
              ? error.message
              : String(error),
        });

        throw error;
      }
    };

  const pause =
    (): void => {
      if (
        pauseClientScript(
          id
        )
      ) {
        showNotification({
          color: "yellow",
          title:
            i18next.t("ui.automationStopped"),
          message:
            i18next.t(
              "ui.isPausedAtTheCurrentNextAwaitDelayCheckpoint",
              {
                value1:
                  definition.name,
              }
            ),
        });
      }
    };

  const resume =
    (): void => {
      if (
        resumeClientScript(
          id
        )
      ) {
        showNotification({
          color: "green",
          title:
            i18next.t("ui.automationResumed"),
          message:
            definition.name,
        });
      }
    };

  const abort =
    (): void => {
      if (
        abortClientScript(
          id
        )
      ) {
        showNotification({
          color: "red",
          title:
            i18next.t("ui.automationAbortRequested"),
          message:
            definition.name,
        });
      }
    };

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

      // Persist the operational Start All membership immediately.
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

  const idle =
    scriptState.status ===
    "idle";

  const running =
    scriptState.status ===
    "running";

  const paused =
    scriptState.status ===
    "paused";

  return (
    <>
      <Card
        withBorder
        p="sm"
      >
        <Stack gap="sm">
          <Group
            justify="space-between"
            align="flex-start"
            wrap="nowrap"
          >
            <Stack
              gap={5}
              style={{
                flex: 1,
              }}
            >
              <Group gap={6}>
                <Badge
                  size="sm"
                  variant="light"
                  color={
                    stateColor(
                      scriptState
                    )
                  }
                >
                  {scriptState.status.toUpperCase()}
                </Badge>

                <Tooltip
                  label={
                    `${automationPanelText(
                      "startWithAll"
                    )} — ${automationPanelText(
                      "startWithAllDescription"
                    )}`
                  }
                  withArrow
                >
                  <Button
                    size="compact-xs"
                    variant="filled"
                    onClick={
                      toggleStartWithAll
                    }
                    aria-label={
                      automationPanelText(
                        "startWithAll"
                      )
                    }
                    aria-pressed={
                      definition.startWithAll !==
                      false
                    }
                    style={{
                      minWidth: 24,
                      width: 24,
                      height: 22,
                      padding: 0,
                      background:
                        definition.startWithAll !==
                        false
                          ? "#84cc16"
                          : "#2f3540",
                      color:
                        definition.startWithAll !==
                        false
                          ? "#142000"
                          : "#cbd5e1",
                      border:
                        definition.startWithAll !==
                        false
                          ? "1px solid #a3e635"
                          : "1px solid #475569",
                    }}
                  >
                    {
                      definition.startWithAll !==
                      false
                        ? (
                          <IconPlayerPlayFilled
                            size={13}
                          />
                        )
                        : (
                          <IconPlayerPlay
                            size={13}
                          />
                        )
                    }
                  </Button>
                </Tooltip>

                <Text
                  size="xs"
                  c="dimmed"
                >
                  {
                    definition.script.trim()
                      ? i18next.t(
                          "ui.lines",
                          {
                            value1:
                              definition.script.split("\n").length,
                          }
                        )
                      : i18next.t(
                          "ui.emptyScript"
                        )
                  }
                </Text>
              </Group>

              <TextInput
                label={
                  i18next.t("ui.name")
                }
                value={
                  definition.name
                }
                onChange={
                  event => {
                    onChange({
                      ...definition,
                      name:
                        event.currentTarget.value,
                    });
                  }
                }
              />

            </Stack>

            <Group gap={5}>
              <Tooltip
                label={
                  i18next.t(
                    "ui.editScript"
                  )
                }
              >
                <ActionIcon
                  variant="light"
                  color="violet"
                  onClick={
                    () =>
                      setOpened(
                        true
                      )
                  }
                  aria-label={
                    i18next.t(
                      "ui.editScript"
                    )
                  }
                >
                  <IconCode
                    size={17}
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
                  variant="light"
                  color="red"
                  disabled={!idle}
                  onClick={
                    onDelete
                  }
                  aria-label={
                    i18next.t(
                      "ui.deleteScript"
                    )
                  }
                >
                  <IconTrash
                    size={17}
                  />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

          {sharedInfo && (
            <Alert
              color="blue"
              variant="light"
              icon={
                <IconInfoCircle
                  size={16}
                />
              }
              py={6}
              px="sm"
            >
              <Text
                size="sm"
                style={{
                  whiteSpace:
                    "pre-wrap",
                  overflowWrap:
                    "anywhere",
                }}
              >
                {sharedInfo}
              </Text>
            </Alert>
          )}

          <Group
            gap={6}
            grow
          >
            <Button
              size="xs"
              variant="light"
              color="green"
              leftSection={
                <IconPlayerPlay
                  size={14}
                />
              }
              disabled={
                !idle ||
                !definition.script.trim()
              }
              onClick={
                () => {
                  void run(
                    definition.script
                  ).catch(
                    () =>
                      undefined
                  );
                }
              }
            >
              {i18next.t("ui.start")}
            </Button>

            <Button
              size="xs"
              variant="light"
              color="yellow"
              leftSection={
                <IconPlayerPause
                  size={14}
                />
              }
              disabled={
                !running
              }
              onClick={
                pause
              }
            >
              {i18next.t("ui.stop")}
            </Button>

            <Button
              size="xs"
              variant="light"
              color="cyan"
              leftSection={
                <IconPlayerPlay
                  size={14}
                />
              }
              disabled={
                !paused
              }
              onClick={
                resume
              }
            >
              {i18next.t("ui.resume")}
            </Button>

            <Button
              size="xs"
              variant="light"
              color="red"
              leftSection={
                <IconTrashX
                  size={14}
                />
              }
              disabled={
                idle
              }
              onClick={
                abort
              }
            >
              {i18next.t("ui.abort")}
            </Button>
          </Group>

          {paused && (
            <Text
              size="xs"
              c="yellow"
            >
              {i18next.t(
                "ui.pausedResumeContinuesTheSameAsyncExecution"
              )}
            </Text>
          )}
        </Stack>
      </Card>

      {opened && (
        <Suspense
          fallback={
            <Group
              justify="center"
              p="xl"
            >
              <Loader />
            </Group>
          }
        >
          <ScriptEditorDialog
            opened={
              opened
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
              scriptState.status
            }
            onClose={
              () =>
                setOpened(
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

                // Update the currently displayed script immediately, then
                // persist the entire automation document to the Hub. The
                // editor Save button is a real save operation now; a separate
                // project/layout save is not required for the script body.
                onChange(
                  next
                );

                void onSave(
                  next
                )
                  .then(() => {
                    showNotification({
                      color: "teal",
                      title:
                        i18next.t(
                          "ui.automationScriptSaved"
                        ),
                      message:
                        definition.name,
                    });
                  })
                  .catch(error => {
                    showNotification({
                      color: "red",
                      title:
                        i18next.t(
                          "ui.automationFailed"
                        ),
                      message:
                        error instanceof Error
                          ? error.message
                          : String(error),
                    });
                  });
              }
            }
            onRun={
              run
            }
            onPause={
              pause
            }
            onResume={
              resume
            }
            onAbort={
              abort
            }
          />
        </Suspense>
      )}
    </>
  );
}

export default function AutomationPanel({
  scripts,
  onScriptsChange,
}: AutomationPanelProps) {
  useTranslation();

  const commandCenter =
    useCommandCenter();

  const [
    runtimeStates,
    setRuntimeStates,
  ] =
    useState<AutomationRuntimeStateMap>(
      {}
    );

  /*
   * Subscribe to the same authoritative client-script runtime state used by
   * the individual cards. The global control card therefore cannot drift from
   * the per-script START/STOP/RESUME/ABORT controls.
   *
   * Only the script ID set matters here. Renaming/editing a script must not
   * tear down all runtime subscriptions.
   */
  const scriptIdSignature =
    scripts
      .map(
        script =>
          script.id
      )
      .join("\u001f");

  useEffect(
    () => {
      const definitions =
        scripts.map(
          script => ({
            id:
              script.id,
            executionId:
              executionId(
                script.id
              ),
          })
        );

      const activeIds =
        new Set(
          definitions.map(
            item =>
              item.id
          )
        );

      setRuntimeStates(
        previous => {
          const next:
            AutomationRuntimeStateMap = {};

          for (
            const id of
            activeIds
          ) {
            next[id] =
              previous[id] ??
              getClientScriptState(
                executionId(
                  id
                )
              );
          }

          return next;
        }
      );

      const unsubscribe =
        definitions.map(
          item =>
            subscribeClientScriptState(
              item.executionId,
              state => {
                setRuntimeStates(
                  previous => ({
                    ...previous,
                    [item.id]:
                      state,
                  })
                );
              }
            )
        );

      return () => {
        for (
          const dispose of
          unsubscribe
        ) {
          dispose();
        }
      };
    },
    [
      scriptIdSignature,
    ]
  );

  const runningCount =
    scripts.reduce(
      (
        count,
        script
      ) =>
        runtimeStates[
          script.id
        ]?.status ===
        "running"
          ? count + 1
          : count,
      0
    );

  const pausedCount =
    scripts.reduce(
      (
        count,
        script
      ) =>
        runtimeStates[
          script.id
        ]?.status ===
        "paused"
          ? count + 1
          : count,
      0
    );

  const activeCount =
    runningCount +
    pausedCount;


  const startableCount =
    scripts.reduce(
      (
        count,
        script
      ) => {
        const status =
          runtimeStates[
            script.id
          ]?.status ??
          "idle";

        return (
          script.startWithAll !==
            false &&
          status ===
            "idle" &&
          Boolean(
            script.script.trim()
          )
            ? count + 1
            : count
        );
      },
      0
    );

  const startAll =
    (): void => {
      let started = 0;

      for (
        const definition of
        scripts
      ) {
        const id =
          executionId(
            definition.id
          );

        const state =
          getClientScriptState(
            id
          );

        if (
          definition.startWithAll ===
            false ||
          state.status !==
            "idle" ||
          !definition.script.trim()
        ) {
          continue;
        }

        started += 1;

        void runClientScript(
          definition.script,
          {
            id,
            name:
              definition.name,
            type:
              "automation",
          }
        ).catch(
          error => {
            // Abort All intentionally rejects active execution promises.
            // That is a normal global-control outcome, not a start failure.
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
                `${definition.name}: ${
                  error instanceof Error
                    ? error.message
                    : String(
                        error
                      )
                }`,
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

      // Deliberately ignore startWithAll here.
      // Resume All means every currently paused automation.
      for (
        const definition of
        scripts
      ) {
        if (
          resumeClientScript(
            executionId(
              definition.id
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

      // Deliberately ignore startWithAll here.
      // Stop All is a global safety/control operation.
      for (
        const definition of
        scripts
      ) {
        if (
          pauseClientScript(
            executionId(
              definition.id
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
        const definition of
        scripts
      ) {
        if (
          abortClientScript(
            executionId(
              definition.id
            ),
            "All automation scripts aborted by user."
          )
        ) {
          aborted += 1;
        }
      }

      /*
       * DCCExpressHub's emergencyStop command is a safe toggle at the backend.
       * Never send it when E-STOP is already active, otherwise Abort All could
       * accidentally resume the command station.
       *
       * Also do not guess when powerInfo is unknown; aborting browser scripts
       * is still valid, but an unknown toggle is not.
       */
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
        color: "red",
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

  const nextScriptsWithUpdate = (
    id: string,
    next: AutomationScriptDefinition
  ): AutomationScriptDefinition[] =>
    scripts.map(
      script =>
        script.id === id
          ? next
          : script
    );

  const updateScript = (
    id: string,
    next: AutomationScriptDefinition
  ): void => {
    onScriptsChange(
      nextScriptsWithUpdate(
        id,
        next
      )
    );
  };

  const saveScript = async (
    id: string,
    next: AutomationScriptDefinition
  ): Promise<void> => {
    const nextScripts =
      nextScriptsWithUpdate(
        id,
        next
      );

    // Keep local state and persistent storage based on the exact same
    // snapshot. This avoids saving the stale pre-editor scripts array.
    onScriptsChange(
      nextScripts
    );

    await saveAutomationScripts(
      nextScripts
    );
  };

  const deleteScript = (
    id: string
  ): void => {
    onScriptsChange(
      scripts.filter(
        script =>
          script.id !== id
      )
    );

    showNotification({
      color: "red",
      title:
        i18next.t(
          "ui.automationDeleted"
        ),
      message:
        i18next.t(
          "ui.saveTheProjectToPersistTheDeletionInTheHub"
        ),
    });
  };

  const createScript =
    (): void => {
      const next:
        AutomationScriptDefinition = {
          id:
            createAutomationId(),
          name:
            `Automation ${scripts.length + 1}`,
          script:
            "",
          startWithAll:
            true,
        };

      onScriptsChange([
        ...scripts,
        next,
      ]);
    };

  return (
    <ScrollArea
      h="100%"
      type="always"
      scrollbarSize={9}
      className="lite-info-scroll"
    >
      <Stack gap="sm">
        <Group
          justify="space-between"
          align="center"
          wrap="nowrap"
        >
          <div>
            <Text fw={700}>
              {i18next.t(
                "ui.automationScripts"
              )}
            </Text>

            <Text
              size="xs"
              c="dimmed"
            >
              {scripts.length} script{scripts.length === 1 ? "" : "s"} in this layout
            </Text>
          </div>

          <Button
            size="xs"
            leftSection={
              <IconPlus
                size={15}
              />
            }
            onClick={
              createScript
            }
          >
            {i18next.t(
              "ui.newScript"
            )}
          </Button>
        </Group>

        <Card
          withBorder
          p="sm"
        >
          <Stack gap="sm">
            <Group
              justify="space-between"
              align="center"
              wrap="wrap"
            >
              <Stack gap={4}>
                <Text
                  fw={700}
                  size="sm"
                >
                  {automationPanelText(
                    "controlTitle"
                  )}
                </Text>

                <Group gap={6}>
                  <Badge
                    size="sm"
                    variant="light"
                    color={
                      runningCount > 0
                        ? "green"
                        : "gray"
                    }
                  >
                    {automationPanelText(
                      "running"
                    )}: {runningCount}
                  </Badge>

                  <Badge
                    size="sm"
                    variant="light"
                    color={
                      pausedCount > 0
                        ? "yellow"
                        : "gray"
                    }
                  >
                    {automationPanelText(
                      "paused"
                    )}: {pausedCount}
                  </Badge>
                </Group>
              </Stack>

              <Group gap="xs">
                <Button
                  size="xs"
                  variant="light"
                  color="green"
                  leftSection={
                    <IconPlayerPlay
                      size={15}
                    />
                  }
                  disabled={
                    startableCount === 0
                  }
                  onClick={
                    startAll
                  }
                >
                  {automationPanelText(
                    "startAll"
                  )}
                </Button>

                <Button
                  size="xs"
                  variant="light"
                  color="cyan"
                  leftSection={
                    <IconPlayerPlay
                      size={15}
                    />
                  }
                  disabled={
                    pausedCount === 0
                  }
                  onClick={
                    resumeAll
                  }
                >
                  {automationPanelText(
                    "resumeAll"
                  )}
                </Button>

                <Button
                  size="xs"
                  variant="light"
                  color="yellow"
                  leftSection={
                    <IconPlayerPause
                      size={15}
                    />
                  }
                  disabled={
                    runningCount === 0
                  }
                  onClick={
                    stopAll
                  }
                >
                  {automationPanelText(
                    "stopAll"
                  )}
                </Button>

                <Button
                  size="xs"
                  variant="filled"
                  color="red"
                  leftSection={
                    <IconAlertTriangle
                      size={15}
                    />
                  }
                  disabled={
                    activeCount === 0
                  }
                  onClick={
                    abortAll
                  }
                >
                  {automationPanelText(
                    "abortAll"
                  )}
                </Button>
              </Group>
            </Group>

            <Text
              size="xs"
              c="dimmed"
            >
              {automationPanelText(
                "controlDescription"
              )}
            </Text>
          </Stack>
        </Card>

        {
          scripts.length === 0
            ? (
              <Card
                withBorder
                p="lg"
              >
                <Stack
                  gap="xs"
                  align="center"
                >
                  <Text fw={700}>
                    {i18next.t(
                      "ui.noAutomationScripts"
                    )}
                  </Text>

                  <Text
                    size="sm"
                    c="dimmed"
                    ta="center"
                  >
                    {i18next.t(
                      "ui.createAScriptGiveItANameThenEditAnd"
                    )}
                  </Text>

                  <Button
                    size="xs"
                    leftSection={
                      <IconPlus
                        size={15}
                      />
                    }
                    onClick={
                      createScript
                    }
                  >
                    {i18next.t(
                      "ui.newScript"
                    )}
                  </Button>
                </Stack>
              </Card>
            )
            : scripts.map(
                definition => (
                  <ScriptCard
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

        <Text
          size="xs"
          c="dimmed"
        >
          {i18next.t(
            "ui.scriptsAreStoredSeparatelyFromTheLayoutInConfigAutomations"
          )}
        </Text>
      </Stack>
    </ScrollArea>
  );
}
