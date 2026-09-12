import {
  Box,
  Group,
  Paper,
  Stack,
} from "@mantine/core";

import ElementPreview from "../../models/editor/rendering/ElementPreviewRenderer";
import TrackTurnoutDoubleElementView from "../../models/editor/elements/TrackTurnoutDoubleElementView";
import {
  getDoubleTurnoutAspect,
} from "../../models/editor/turnout/turnoutAccessoryHelpers";
import {
  sendTurnoutOutput,
} from "../../services/layoutOutput";

import type {
  DoubleTurnoutPopoverState,
} from "./TrackCanvas.types";

type DoubleTurnoutPosition = {
  label: string;
  firstClosed: boolean;
  secondClosed: boolean;
};

type DoubleTurnoutBits = {
  first: boolean;
  second: boolean;
};

const DOUBLE_TURNOUT_POSITIONS: DoubleTurnoutPosition[] = [
  {
    label: "O-O",
    firstClosed: false,
    secondClosed: false,
  },
  {
    label: "O-C",
    firstClosed: false,
    secondClosed: true,
  },
  {
    label: "C-O",
    firstClosed: true,
    secondClosed: false,
  },
  {
    label: "C-C",
    firstClosed: true,
    secondClosed: true,
  },
];

export type TrackCanvasDoubleTurnoutPopoverProps = {
  state: DoubleTurnoutPopoverState;
  onClose: () => void;
};

function getConfiguredBits(
  turnout: TrackTurnoutDoubleElementView,
  position: DoubleTurnoutPosition
): DoubleTurnoutBits {
  switch (position.label) {
    case "O-C":
      return {
        first: turnout.ocMotor1Value,
        second: turnout.ocMotor2Value,
      };

    case "C-O":
      return {
        first: turnout.coMotor1Value,
        second: turnout.coMotor2Value,
      };

    case "C-C":
      return {
        first: turnout.ccMotor1Value,
        second: turnout.ccMotor2Value,
      };

    case "O-O":
    default:
      return {
        first: turnout.ooMotor1Value,
        second: turnout.ooMotor2Value,
      };
  }
}

function copyConfiguredStateTable(
  source: TrackTurnoutDoubleElementView,
  target: TrackTurnoutDoubleElementView
): void {
  target.ooMotor1Value = source.ooMotor1Value;
  target.ooMotor2Value = source.ooMotor2Value;

  target.ocMotor1Value = source.ocMotor1Value;
  target.ocMotor2Value = source.ocMotor2Value;

  target.coMotor1Value = source.coMotor1Value;
  target.coMotor2Value = source.coMotor2Value;

  target.ccMotor1Value = source.ccMotor1Value;
  target.ccMotor2Value = source.ccMotor2Value;
}

function createDoubleTurnoutPreview(
  selectedElement: TrackTurnoutDoubleElementView,
  position: DoubleTurnoutPosition
): TrackTurnoutDoubleElementView {
  const turnout =
    new TrackTurnoutDoubleElementView(0, 0);

  turnout.rotation =
    selectedElement.rotation;

  turnout.outputMode =
    selectedElement.outputMode;

  turnout.turnout1Address =
    selectedElement.turnout1Address;

  turnout.turnout2Address =
    selectedElement.turnout2Address;

  turnout.turnout1ClosedValue =
    selectedElement.turnout1ClosedValue;

  turnout.turnout2ClosedValue =
    selectedElement.turnout2ClosedValue;

  copyConfiguredStateTable(
    selectedElement,
    turnout
  );

  const bits =
    getConfiguredBits(
      selectedElement,
      position
    );

  turnout.turnout1Closed =
    bits.first;

  turnout.turnout2Closed =
    bits.second;

  return turnout;
}

function setDoubleTurnoutPosition(
  turnout: TrackTurnoutDoubleElementView,
  position: DoubleTurnoutPosition
): void {
  const bits =
    getConfiguredBits(
      turnout,
      position
    );

  turnout.turnout1Closed =
    bits.first;

  turnout.turnout2Closed =
    bits.second;

  sendTurnoutOutput(
    String(
      (turnout as any).outputMode
    ),
    turnout.turnout1Address,
    bits.first,
    {
      closedValue:
        turnout.turnout1ClosedValue,
      closedAspect:
        getDoubleTurnoutAspect(
          turnout,
          1,
          true
        ),
      openedAspect:
        getDoubleTurnoutAspect(
          turnout,
          1,
          false
        ),
    }
  );

  sendTurnoutOutput(
    String(
      (turnout as any).outputMode
    ),
    turnout.turnout2Address,
    bits.second,
    {
      closedValue:
        turnout.turnout2ClosedValue,
      closedAspect:
        getDoubleTurnoutAspect(
          turnout,
          2,
          true
        ),
      openedAspect:
        getDoubleTurnoutAspect(
          turnout,
          2,
          false
        ),
    }
  );
}

function isMobileLikePointer(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.matchMedia?.("(pointer: coarse)").matches === true ||
    navigator.maxTouchPoints > 0
  );
}

function getPanelPosition(
  x: number,
  y: number
): {
  left: number;
  top: number;
} {
  const panelWidth = 210;
  const panelHeight = 86;
  const margin = 8;

  const viewportWidth =
    typeof window !== "undefined"
      ? window.innerWidth
      : 1024;

  const viewportHeight =
    typeof window !== "undefined"
      ? window.innerHeight
      : 768;

  let left = x + 12;
  let top = y + 12;

  if (
    left + panelWidth + margin >
    viewportWidth
  ) {
    left =
      x - panelWidth - 12;
  }

  if (
    top + panelHeight + margin >
    viewportHeight
  ) {
    top =
      y - panelHeight - 12;
  }

  return {
    left: Math.max(
      margin,
      Math.min(
        left,
        viewportWidth -
          panelWidth -
          margin
      )
    ),
    top: Math.max(
      margin,
      Math.min(
        top,
        viewportHeight -
          panelHeight -
          margin
      )
    ),
  };
}

export function TrackCanvasDoubleTurnoutPopover({
  state,
  onClose,
}: TrackCanvasDoubleTurnoutPopoverProps) {
  if (
    !state.opened ||
    !state.turnout
  ) {
    return null;
  }

  const turnout =
    state.turnout;

  const mobileCentered =
    isMobileLikePointer();

  const position =
    getPanelPosition(
      state.x,
      state.y
    );

  return (
    <>
      <Box
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1999,
          background: "transparent",
          touchAction: "none",
        }}
        onPointerDown={event => {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      />

      <Paper
        withBorder
        shadow="xl"
        radius="md"
        p={6}
        style={{
          position: "fixed",
          left: mobileCentered
            ? "50%"
            : position.left,
          top: mobileCentered
            ? "50%"
            : position.top,
          transform: mobileCentered
            ? "translate(-50%, -50%)"
            : undefined,
          zIndex: 2000,
          background:
            "var(--mantine-color-dark-7)",
          touchAction: "manipulation",
        }}
        onPointerDown={event => {
          event.stopPropagation();
        }}
        onClick={event => {
          event.stopPropagation();
        }}
      >
        <Stack gap={4}>
          <Group
            gap={4}
            wrap="nowrap"
          >
            {DOUBLE_TURNOUT_POSITIONS.map(
              turnoutPosition => (
                <Box
                  key={
                    turnoutPosition.label
                  }
                  className="signal-aspect-button"
                  style={{
                    cursor: "pointer",
                    touchAction:
                      "manipulation",
                  }}
                  onPointerDown={
                    event => {
                      event.stopPropagation();
                    }
                  }
                  onClick={() => {
                    setDoubleTurnoutPosition(
                      turnout,
                      turnoutPosition
                    );

                    onClose();
                  }}
                >
                  <ElementPreview
                    style={{
                      cursor: "pointer",
                    }}
                    element={
                      createDoubleTurnoutPreview(
                        turnout,
                        turnoutPosition
                      )
                    }
                    label={
                      turnoutPosition.label
                    }
                    width={40}
                    height={40}
                  />
                </Box>
              )
            )}
          </Group>
        </Stack>
      </Paper>
    </>
  );
}
