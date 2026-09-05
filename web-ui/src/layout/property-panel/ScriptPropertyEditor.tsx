import {
  lazy,
  Suspense,
  useState,
} from "react";

import {
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
  IconPlayerPlay,
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
  runClientScript,
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

  const [
    running,
    setRunning,
  ] =
    useState(false);

  if (
    !(
      selectedElement instanceof
      ButtonScriptElementView
    )
  ) {
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
      selectedElement.id,
    name:
      selectedElement.name,
    type:
      selectedElement.type,
  };

  const run =
    async (
      source: string
    ): Promise<void> => {
      try {
        setRunning(true);

        await runClientScript(
          source,
          context
        );

        showNotification({
          color: "green",
          title:
            "Script completed",
          message:
            selectedElement.name ||
            `Script Button #${selectedElement.id}`,
        });
      } catch (
        error
      ) {
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
      } finally {
        setRunning(false);
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
              <Text
                size="sm"
                fw={600}
              >
                JavaScript
              </Text>

              <Text
                size="xs"
                c="dimmed"
              >
                {selectedElement.script.trim()
                  ? `${selectedElement.script.split("\n").length} lines`
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

        <Button
          size="xs"
          variant="subtle"
          color="green"
          leftSection={
            <IconPlayerPlay
              size={14}
            />
          }
          loading={running}
          disabled={
            !selectedElement.script.trim()
          }
          onClick={() => {
            void run(
              selectedElement.script
            ).catch(
              () => undefined
            );
          }}
        >
          Run test
        </Button>
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
              selectedElement.name ||
              `#${selectedElement.id}`
            }`}
            value={
              selectedElement.script
            }
            onClose={() => {
              setOpened(false);
            }}
            onSave={value => {
              onChange(
                prop,
                value
              );

              setOpened(false);

              showNotification({
                color: "teal",
                title:
                  "Script saved",
                message:
                  "Save the layout to persist the change on the Hub.",
              });
            }}
            onRun={async value => {
              await run(value);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
