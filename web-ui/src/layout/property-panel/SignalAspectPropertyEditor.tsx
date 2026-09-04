import {
  Alert,
  Box,
  Button,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";

import {
  IconSettings,
  IconTrafficLights,
} from "@tabler/icons-react";

import {
  useMemo,
  useState,
} from "react";

import SignalAutomationDialog from "@/components/SignalAutomationDialog";
import SignalOutputDialog from "@/components/SignalOutputDialog";

import type {
  SignalOutputConfiguration,
  SignalOutputState,
} from "@/domain/layout/signalOutput";

import {
  cloneSignalOutputConfiguration,
} from "@/domain/layout/signalOutput";

import {
  LayoutView,
} from "../../models/editor/core/LayoutView";

import type {
  BaseElementView,
} from "../../models/editor/core/BaseElementView";

import type {
  IEditableProperty,
} from "../../models/editor/elements/PropertyDescriptor";

import {
  TrackSignalElementView,
} from "../../models/editor/elements/TrackSignalElementView";

import ElementPreview from "../../models/editor/rendering/ElementPreviewRenderer";

import type {
  SelectedElementUpdateHandler,
} from "./propertyPanelTypes";

type SignalAspectPropertyEditorProps = {
  prop: IEditableProperty;
  selectedElement: BaseElementView;
  onUpdateSelectedElement: SelectedElementUpdateHandler;
};

function createStatePreview(
  signal: TrackSignalElementView,
  stateIndex: number
): TrackSignalElementView {
  const preview =
    new TrackSignalElementView(0, 0);

  preview.signalOutput =
    cloneSignalOutputConfiguration(
      signal.signalOutput
    );

  preview.currentStateIndex =
    Math.max(
      0,
      Math.min(
        stateIndex,
        preview.signalOutput.states.length - 1
      )
    );

  preview.rotation = 90;

  return preview;
}

export default function SignalAspectPropertyEditor({
  selectedElement,
  onUpdateSelectedElement,
}: SignalAspectPropertyEditorProps) {
  const signal =
    selectedElement as TrackSignalElementView;

  const [opened, setOpened] =
    useState(false);

  const [automationOpened, setAutomationOpened] =
    useState(false);

  const [automationLayout, setAutomationLayout] =
    useState<LayoutView | null>(null);

  const [automationLoading, setAutomationLoading] =
    useState(false);

  const [automationError, setAutomationError] =
    useState<string | null>(null);

  const dialogValue =
    useMemo(
      () =>
        cloneSignalOutputConfiguration(
          signal.signalOutput
        ),
      [signal, opened]
    );

  const previews =
    useMemo(
      () =>
        signal.signalOutput.states.map(
          (_, index) =>
            createStatePreview(
              signal,
              index
            )
        ),
      [
        signal,
        signal.signalOutput,
      ]
    );

  const apply = (
    value: SignalOutputConfiguration
  ) => {
    signal.setSignalOutput(value);

    onUpdateSelectedElement(signal);
    setOpened(false);
  };

  const testState = (
    config: SignalOutputConfiguration,
    state: SignalOutputState
  ) => {
    signal.setSignalOutput(config);
    signal.sendState(state);

    onUpdateSelectedElement(signal);
  };

  const testCurrentState = (
    state: SignalOutputState
  ) => {
    signal.sendState(state);
    onUpdateSelectedElement(signal);
  };

  const openAutomation = async (): Promise<void> => {
    setAutomationLoading(true);
    setAutomationError(null);

    try {
      const response = await fetch("/api/layout", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(
          "The saved layout could not be loaded for signal automation."
        );
      }

      const loadedLayout =
        LayoutView.fromJSON(await response.json());

      const savedSignal =
        loadedLayout
          .getAllElements()
          .find(element => element.id === signal.id);

      if (!(savedSignal instanceof TrackSignalElementView)) {
        throw new Error(
          "Save the layout before configuring automation for this signal."
        );
      }

      setAutomationLayout(loadedLayout);
      setAutomationOpened(true);
    } catch (loadError) {
      setAutomationError(
        loadError instanceof Error
          ? loadError.message
          : String(loadError)
      );
    } finally {
      setAutomationLoading(false);
    }
  };

  return (
    <>
      <Stack gap="sm">
        <Button
          variant="light"
          leftSection={
            <IconSettings size={17} />
          }
          onClick={() => setOpened(true)}
        >
          Signal configuration
        </Button>

        <Button
          variant="light"
          color="yellow"
          leftSection={
            <IconTrafficLights size={17} />
          }
          loading={automationLoading}
          onClick={() => void openAutomation()}
        >
          Signal automation
        </Button>

        {automationError && (
          <Alert
            color="red"
            onClose={() => setAutomationError(null)}
            withCloseButton
          >
            {automationError}
          </Alert>
        )}

        <Text size="xs" c="dimmed">
          {"Address "}
          {signal.signalOutput.address}
          {" · "}
          {signal.signalOutput.lampCount}
          {" lamps · "}
          {signal.signalOutput.states.length}
          {" aspects · "}
          {signal.signalOutput.protocol === "dccext"
            ? "DCC Extended"
            : "DCC"}
        </Text>

        <Text size="xs" fw={700}>
          Aspects
        </Text>

        <ScrollArea.Autosize
          mah={260}
          offsetScrollbars
          scrollbarSize={8}
        >
          <SimpleGrid
            cols={2}
            spacing="xs"
            verticalSpacing="xs"
          >
            {signal.signalOutput.states.map(
              (state, index) => (
                <Paper
                  key={state.id}
                  withBorder
                  p={4}
                  radius="sm"
                  style={{
                    cursor: "pointer",
                    borderColor:
                      index === signal.currentStateIndex
                        ? "var(--mantine-color-blue-5)"
                        : undefined,
                  }}
                  onClick={() =>
                    testCurrentState(state)
                  }
                  title={`Test aspect: ${state.label}`}
                >
                  <Stack
                    gap={2}
                    align="center"
                  >
                    <Box
                      w="100%"
                      style={{
                        display: "flex",
                        justifyContent: "center",
                      }}
                    >
                      <ElementPreview
                        element={previews[index]!}
                        label=""
                        width={54}
                        height={42}
                        translateX={-8}
                        onClick={() =>
                          testCurrentState(state)
                        }
                      />
                    </Box>

                    <Text
                      size="xs"
                      fw={
                        index === signal.currentStateIndex
                          ? 700
                          : 500
                      }
                      ta="center"
                      truncate
                      w="100%"
                    >
                      {state.label}
                    </Text>
                  </Stack>
                </Paper>
              )
            )}
          </SimpleGrid>
        </ScrollArea.Autosize>

        {signal.signalOutput.states.length === 0 && (
          <Text size="xs" c="dimmed">
            No signal aspects configured.
          </Text>
        )}
      </Stack>

      <SignalOutputDialog
        opened={opened}
        value={dialogValue}
        onClose={() => setOpened(false)}
        onApply={apply}
        onTestState={testState}
      />

      {automationLayout && (
        <SignalAutomationDialog
          opened={automationOpened}
          onClose={() => setAutomationOpened(false)}
          layout={automationLayout}
          signalId={signal.id}
        />
      )}
    </>
  );
}
