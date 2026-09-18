import { useTranslation } from "react-i18next";
import i18next from "i18next";
import {
  Alert,
  Box,
  Button,
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
  BaseElement,
} from "../../models/editor/core/BaseElement";

import type {
  IEditableProperty,
} from "../../models/editor/elements/PropertyDescriptor";

import {
  TrackLevelCrossingElement,
} from "../../models/editor/elements/TrackLevelCrossingElement";

import {
  TrackSignalElement,
} from "../../models/editor/elements/TrackSignalElement";

import ElementPreview from "../../models/editor/rendering/ElementPreviewRenderer";

import type {
  SelectedElementUpdateHandler,
} from "./propertyPanelTypes";

type SignalAspectPropertyEditorProps = {
  prop: IEditableProperty;
  selectedElement: BaseElement;
  onUpdateSelectedElement: SelectedElementUpdateHandler;
};

function createStatePreview(
  signal: TrackSignalElement,
  stateIndex: number
): TrackSignalElement {
  const preview =
    signal instanceof TrackLevelCrossingElement
      ? new TrackLevelCrossingElement(0, 0)
      : new TrackSignalElement(0, 0);

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

  if (
    preview instanceof TrackLevelCrossingElement &&
    signal instanceof TrackLevelCrossingElement
  ) {
    preview.barrierType = signal.barrierType;
    preview.roadColor = signal.roadColor;
    preview.lightsEnabled = signal.lightsEnabled;

    // The property-panel preview should be deterministic:
    // Closed shows both red lamps lit, Open shows the centre white lamp.
    // Runtime blinking is animated on the actual layout canvas.
    preview.blinkingEnabled = false;
    preview.rotation = signal.rotation;
  } else {
    preview.rotation = 90;
  }

  return preview;
}

export default function SignalAspectPropertyEditor({
  selectedElement,
  onUpdateSelectedElement,
}: SignalAspectPropertyEditorProps) {
  useTranslation();
  const signal =
    selectedElement as TrackSignalElement;

  const isLevelCrossing =
    signal instanceof TrackLevelCrossingElement;

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
    if (signal.signalOutput.address <= 0) {
      setAutomationError(
        "Configure the signal output before creating automation."
      );
      return;
    }

    setAutomationLoading(true);
    setAutomationError(null);

    try {
      const response = await fetch("/api/layout", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(
          i18next.t("ui.theSavedLayoutCouldNotBeLoadedForSignalAutomation")
        );
      }

      const loadedLayout =
        LayoutView.fromJSON(await response.json());

      const savedSignal =
        loadedLayout
          .getAllElements()
          .find(element => element.id === signal.id);

      if (!(savedSignal instanceof TrackSignalElement)) {
        throw new Error(
          i18next.t("ui.saveTheLayoutBeforeConfiguringAutomationForThisSignal")
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
          {isLevelCrossing
            ? i18next.t("ui.levelCrossingConfiguration")
            : i18next.t("ui.signalConfiguration")}
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
          {isLevelCrossing
            ? i18next.t("ui.levelCrossingAutomation")
            : i18next.t("ui.signalAutomation")}
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
          {signal.signalOutput.address > 0
            ? `Address ${signal.signalOutput.address}`
            : "Output not configured"}
          {" · "}
          {signal.signalOutput.lampCount}
          {" lamps · "}
          {signal.signalOutput.states.length}
          {" aspects · "}
          {signal.signalOutput.protocol === "dccext"
            ? "DCC Extended"
            : "DCC"}
        </Text>

        <Text size="xs" fw={700}> {i18next.t("ui.aspects")} </Text>

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
                  title={i18next.t("ui.testAspect", { value1: state.label })}
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
            {isLevelCrossing
              ? i18next.t("ui.noLevelCrossingAspectsConfigured")
              : i18next.t("ui.noSignalAspectsConfigured")}
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
