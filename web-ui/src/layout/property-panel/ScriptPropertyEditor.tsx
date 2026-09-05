import {
  lazy,
  Suspense,
  useEffect,
  useState,
} from "react";

import {
  Badge,
  Button,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";

import {
  showNotification,
} from "@mantine/notifications";

import {
  IconBraces,
  IconCode,
  IconPlayerPause,
  IconPlayerPlay,
  IconTrashX,
} from "@tabler/icons-react";

import type {
  BaseElementView,
} from "../../models/editor/core/BaseElementView";

import {
  ButtonScriptElementView,
} from "../../models/editor/elements/ButtonScriptElementView";

import type {
  IEditableProperty,
} from "../../models/editor/elements/PropertyDescriptor";

import {
  abortClientScript,
  getClientScriptState,
  pauseClientScript,
  resumeClientScript,
  runClientScript,
  ScriptAbortError,
  subscribeClientScriptState,
  type ClientScriptState,
} from "../../services/clientScriptRunner";

import type {
  PropertyChangeHandler,
} from "./propertyPanelTypes";

const ScriptEditorDialog =
  lazy(
    () =>
      import(
        "../../components/ScriptEditorDialog"
      )
  );

type ScriptPropertyEditorProps = {
  prop: IEditableProperty;
  selectedElement:
    BaseElementView;
  onChange:
    PropertyChangeHandler;
};

function stateColor(
  state: ClientScriptState
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

export default function ScriptPropertyEditor({
  prop,
  selectedElement,
  onChange,
}: ScriptPropertyEditorProps) {
  const [
    opened,
    setOpened,
  ] =
    useState(false);

  const element =
    selectedElement instanceof
      ButtonScriptElementView
      ? selectedElement
      : null;

  const [
    scriptState,
    setScriptState,
  ] =
    useState<ClientScriptState>(
      () =>
        getClientScriptState(
          element?.id ?? -1
        )
    );

  useEffect(() => {
    if (!element) return;

    return subscribeClientScriptState(
      element.id,
      setScriptState
    );
  }, [
    element?.id,
  ]);

  if (!element) {
    return (
      <Text
        size="sm"
        c="red"
      >
        Script editor is available only for Script Button elements.
      </Text>
    );
  }

  const context = {
    id:
      element.id,
    name:
      element.name,
    type:
      element.type,
  };

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
            "Script completed",
          message:
            element.name ||
            `Script Button #${element.id}`,
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
              "Script aborted",
            message:
              element.name ||
              `Script Button #${element.id}`,
          });

          throw error;
        }

        showNotification({
          color: "red",
          title:
            "Script failed",
          message:
            error instanceof Error
              ? error.message
              : String(error),
        });

        throw error;
      }
    };

  const pause = () => {
    if (
      pauseClientScript(
        element.id
      )
    ) {
      showNotification({
        color: "yellow",
        title: "Script stopped",
        message:
          "Execution will remain paused at the current/next await delay() checkpoint.",
      });
    }
  };

  const resume = () => {
    if (
      resumeClientScript(
        element.id
      )
    ) {
      showNotification({
        color: "green",
        title: "Script resumed",
        message:
          element.name ||
          `Script Button #${element.id}`,
      });
    }
  };

  const abort = () => {
    if (
      abortClientScript(
        element.id
      )
    ) {
      showNotification({
        color: "red",
        title: "Script abort requested",
        message:
          element.name ||
          `Script Button #${element.id}`,
      });
    }
  };

  return (
    <>
      <Stack gap="xs">
        <Group
          justify="space-between"
          align="center"
          wrap="nowrap"
        >
          <Group
            gap={6}
            wrap="nowrap"
          >
            <IconBraces
              size={18}
            />

            <div>
              <Group gap={5}>
                <Text
                  size="sm"
                  fw={600}
                >
                  JavaScript
                </Text>

                <Badge
                  size="xs"
                  variant="light"
                  color={
                    stateColor(
                      scriptState
                    )
                  }
                >
                  {scriptState.status.toUpperCase()}
                </Badge>
              </Group>

              <Text
                size="xs"
                c="dimmed"
              >
                {element.script.trim()
                  ? `${element.script.split("\n").length} lines`
                  : "Empty script"}
              </Text>
            </div>
          </Group>

          <Button
            size="xs"
            variant="light"
            color="violet"
            leftSection={
              <IconCode
                size={15}
              />
            }
            onClick={() => {
              setOpened(true);
            }}
          >
            Edit
          </Button>
        </Group>

        <Group
          gap={5}
          grow
        >
          {scriptState.status ===
            "idle" && (
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
                !element.script.trim()
              }
              onClick={() => {
                void run(
                  element.script
                ).catch(
                  () => undefined
                );
              }}
            >
              Run
            </Button>
          )}

          {scriptState.status ===
            "running" && (
            <Button
              size="xs"
              variant="light"
              color="yellow"
              leftSection={
                <IconPlayerPause
                  size={14}
                />
              }
              onClick={pause}
            >
              Stop
            </Button>
          )}

          {scriptState.status ===
            "paused" && (
            <Button
              size="xs"
              variant="light"
              color="green"
              leftSection={
                <IconPlayerPlay
                  size={14}
                />
              }
              onClick={resume}
            >
              Resume
            </Button>
          )}

          {scriptState.status !==
            "idle" && (
            <Button
              size="xs"
              variant="light"
              color="red"
              leftSection={
                <IconTrashX
                  size={14}
                />
              }
              onClick={abort}
            >
              Abort
            </Button>
          )}
        </Group>

        {scriptState.status ===
          "paused" && (
          <Text
            size="xs"
            c="yellow"
          >
            Paused. Resume continues the same async run from its delay checkpoint.
          </Text>
        )}
      </Stack>

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
            title={`Script · ${
              element.name ||
              `#${element.id}`
            }`}
            value={
              element.script
            }
            scriptStatus={
              scriptState.status
            }
            onClose={() => {
              setOpened(false);
            }}
            onSave={value => {
              onChange(
                prop,
                value
              );

              showNotification({
                color: "teal",
                title:
                  "Script saved",
                message:
                  "Editor remains open. Save the layout to persist the change on the Hub.",
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
