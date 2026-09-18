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
  IconCode,
  IconInfoCircle,
  IconPlus,
  IconPlayerPause,
  IconPlayerPlay,
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
            i18next.t("ui.isPausedAtTheCurrentNextAwaitDelayCheckpoint", { value1: definition.name }),
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

                <Text
                  size="xs"
                  c="dimmed"
                >
                  {
                    definition.script.trim()
                      ? i18next.t("ui.lines", { value1: definition.script.split("\n").length })
                      : i18next.t("ui.emptyScript")
                  }
                </Text>
              </Group>

              <TextInput
                label={i18next.t("ui.name")}
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
              <Tooltip label={i18next.t("ui.editScript")}>
                <ActionIcon
                  variant="light"
                  color="violet"
                  onClick={
                    () =>
                      setOpened(
                        true
                      )
                  }
                  aria-label={i18next.t("ui.editScript")}
                >
                  <IconCode
                    size={17}
                  />
                </ActionIcon>
              </Tooltip>

              <Tooltip
                label={
                  idle
                    ? i18next.t("ui.deleteScript")
                    : i18next.t("ui.stopOrAbortTheScriptBeforeDeletingIt")
                }
              >
                <ActionIcon
                  variant="light"
                  color="red"
                  disabled={!idle}
                  onClick={
                    onDelete
                  }
                  aria-label={i18next.t("ui.deleteScript")}
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
            > {i18next.t("ui.start")} </Button>

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
            > {i18next.t("ui.stop")} </Button>

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
            > {i18next.t("ui.resume")} </Button>

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
            > {i18next.t("ui.abort")} </Button>
          </Group>

          {paused && (
            <Text
              size="xs"
              c="yellow"
            > {i18next.t("ui.pausedResumeContinuesTheSameAsyncExecution")} </Text>
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
              i18next.t("ui.automation", { value1: definition.name || "Unnamed script" })
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
                        i18next.t("ui.automationScriptSaved"),
                      message:
                        definition.name,
                    });
                  })
                  .catch(error => {
                    showNotification({
                      color: "red",
                      title:
                        i18next.t("ui.automationFailed"),
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
        i18next.t("ui.automationDeleted"),
      message:
        i18next.t("ui.saveTheProjectToPersistTheDeletionInTheHub"),
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
            <Text fw={700}> {i18next.t("ui.automationScripts")} </Text>

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
          > {i18next.t("ui.newScript")} </Button>
        </Group>

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
                  <Text fw={700}> {i18next.t("ui.noAutomationScripts")} </Text>

                  <Text
                    size="sm"
                    c="dimmed"
                    ta="center"
                  > {i18next.t("ui.createAScriptGiveItANameThenEditAnd")} </Text>

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
                  > {i18next.t("ui.newScript")} </Button>
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
        > {i18next.t("ui.scriptsAreStoredSeparatelyFromTheLayoutInConfigAutomations")} </Text>
      </Stack>
    </ScrollArea>
  );
}
