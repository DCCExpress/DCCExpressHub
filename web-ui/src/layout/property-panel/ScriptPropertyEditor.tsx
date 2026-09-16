import { useTranslation } from "react-i18next";
import i18next from "i18next";
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
  BaseElement,
} from "../../models/editor/core/BaseElement";

import {
  ButtonScriptElement,
} from "../../models/editor/elements/ButtonScriptElement";

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
    BaseElement;
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
  useTranslation();
  const [
    opened,
    setOpened,
  ] =
    useState(false);

  const element =
    selectedElement instanceof
      ButtonScriptElement
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
      > {i18next.t("ui.scriptEditorIsAvailableOnlyForScriptButtonElements")} </Text>
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
            i18next.t("ui.scriptCompleted"),
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
              i18next.t("ui.scriptAborted"),
            message:
              element.name ||
              `Script Button #${element.id}`,
          });

          throw error;
        }

        showNotification({
          color: "red",
          title:
            i18next.t("ui.scriptFailed"),
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
        title: i18next.t("ui.scriptStopped"),
        message:
          i18next.t("ui.executionWillRemainPausedAtTheCurrentNextAwaitDelay"),
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
        title: i18next.t("ui.scriptResumed"),
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
        title: i18next.t("ui.scriptAbortRequested"),
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
                  ? i18next.t("ui.lines", { value1: element.script.split("\n").length })
                  : i18next.t("ui.emptyScript")}
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
          > {i18next.t("ui.edit")} </Button>
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
            > {i18next.t("ui.run")} </Button>
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
            > {i18next.t("ui.stop")} </Button>
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
            > {i18next.t("ui.resume")} </Button>
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
            > {i18next.t("ui.abort")} </Button>
          )}
        </Group>

        {scriptState.status ===
          "paused" && (
          <Text
            size="xs"
            c="yellow"
          > {i18next.t("ui.pausedResumeContinuesTheSameAsyncRunFromItsDelay")} </Text>
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
            title={i18next.t("ui.script", { value1: element.name ||
              `#${element.id}` })}
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
                  i18next.t("ui.scriptSaved"),
                message:
                  i18next.t("ui.editorRemainsOpenSaveTheLayoutToPersistTheChange"),
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
