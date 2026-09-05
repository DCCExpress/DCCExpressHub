import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ActionIcon,
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
  IconPlus,
  IconPlayerPause,
  IconPlayerPlay,
  IconTrash,
  IconTrashX,
} from "@tabler/icons-react";

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

import type {
  AutomationScriptDefinition,
} from "../LiteLayoutPage";

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

function createAutomationId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `automation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function executionId(
  scriptId: string
): string {
  return `automation:${scriptId}`;
}

function stateColor(
  state: ClientScriptState
): string {
  if (state.status === "running") return "green";
  if (state.status === "paused") return "yellow";
  return "gray";
}

type ScriptCardProps = {
  definition: AutomationScriptDefinition;
  onChange: (
    next: AutomationScriptDefinition
  ) => void;
  onDelete: () => void;
};

function ScriptCard({
  definition,
  onChange,
  onDelete,
}: ScriptCardProps) {
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
        getClientScriptState(id)
    );

  useEffect(() => {
    return subscribeClientScriptState(
      id,
      setScriptState
    );
  }, [id]);

  const context = useMemo(
    () => ({
      id,
      name: definition.name,
      type: "automation",
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
          title: "Automation completed",
          message: definition.name,
        });
      } catch (error) {
        if (error instanceof ScriptAbortError) {
          showNotification({
            color: "orange",
            title: "Automation aborted",
            message: definition.name,
          });

          throw error;
        }

        showNotification({
          color: "red",
          title: "Automation failed",
          message:
            error instanceof Error
              ? error.message
              : String(error),
        });

        throw error;
      }
    };

  const pause = () => {
    if (pauseClientScript(id)) {
      showNotification({
        color: "yellow",
        title: "Automation stopped",
        message:
          `${definition.name} is paused at the current/next await delay() checkpoint.`,
      });
    }
  };

  const resume = () => {
    if (resumeClientScript(id)) {
      showNotification({
        color: "green",
        title: "Automation resumed",
        message: definition.name,
      });
    }
  };

  const abort = () => {
    if (abortClientScript(id)) {
      showNotification({
        color: "red",
        title: "Automation abort requested",
        message: definition.name,
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
                  {definition.script.trim()
                    ? `${definition.script.split("\n").length} lines`
                    : "Empty script"}
                </Text>
              </Group>

              <TextInput
                label="Name"
                value={
                  definition.name
                }
                onChange={event => {
                  onChange({
                    ...definition,
                    name:
                      event.currentTarget.value,
                  });
                }}
              />
            </Stack>

            <Group gap={5}>
              <Tooltip label="Edit script">
                <ActionIcon
                  variant="light"
                  color="violet"
                  onClick={() => {
                    setOpened(true);
                  }}
                  aria-label="Edit script"
                >
                  <IconCode
                    size={17}
                  />
                </ActionIcon>
              </Tooltip>

              <Tooltip
                label={
                  idle
                    ? "Delete script"
                    : "Stop or abort the script before deleting it"
                }
              >
                <ActionIcon
                  variant="light"
                  color="red"
                  disabled={!idle}
                  onClick={
                    onDelete
                  }
                  aria-label="Delete script"
                >
                  <IconTrash
                    size={17}
                  />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

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
              onClick={() => {
                void run(
                  definition.script
                ).catch(
                  () => undefined
                );
              }}
            >
              Start
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
              disabled={!running}
              onClick={pause}
            >
              Stop
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
              disabled={!paused}
              onClick={resume}
            >
              Resume
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
              disabled={idle}
              onClick={abort}
            >
              Abort
            </Button>
          </Group>

          {paused && (
            <Text
              size="xs"
              c="yellow"
            >
              Paused. Resume continues the same async execution.
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
            opened={opened}
            title={`Automation · ${definition.name || "Unnamed script"}`}
            value={
              definition.script
            }
            scriptStatus={
              scriptState.status
            }
            onClose={() => {
              setOpened(false);
            }}
            onSave={value => {
              onChange({
                ...definition,
                script: value,
              });

              showNotification({
                color: "teal",
                title: "Automation script saved",
                message:
                  "Editor remains open. Save the layout to persist it on the Hub.",
              });
            }}
            onRun={run}
            onPause={pause}
            onResume={resume}
            onAbort={abort}
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
  const updateScript = (
    id: string,
    next: AutomationScriptDefinition
  ) => {
    onScriptsChange(
      scripts.map(script =>
        script.id === id
          ? next
          : script
      )
    );
  };

  const deleteScript = (
    id: string
  ) => {
    onScriptsChange(
      scripts.filter(
        script =>
          script.id !== id
      )
    );

    showNotification({
      color: "red",
      title: "Automation deleted",
      message:
        "Save the layout to persist the deletion on the Hub.",
    });
  };

  const createScript = () => {
    const next:
      AutomationScriptDefinition = {
        id:
          createAutomationId(),
        name:
          `Automation ${scripts.length + 1}`,
        script: "",
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
              Automation scripts
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
            New script
          </Button>
        </Group>

        {scripts.length === 0 ? (
          <Card
            withBorder
            p="lg"
          >
            <Stack
              gap="xs"
              align="center"
            >
              <Text
                fw={700}
              >
                No automation scripts
              </Text>

              <Text
                size="sm"
                c="dimmed"
                ta="center"
              >
                Create a script, give it a name, then edit and run it independently.
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
                New script
              </Button>
            </Stack>
          </Card>
        ) : (
          scripts.map(
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
                onDelete={
                  () =>
                    deleteScript(
                      definition.id
                    )
                }
              />
            )
          )
        )}

        <Text
          size="xs"
          c="dimmed"
        >
          Scripts are currently stored inside the layout JSON. Their IDs and data model are already separated so they can later move to a dedicated automation store/API.
        </Text>
      </Stack>
    </ScrollArea>
  );
}
