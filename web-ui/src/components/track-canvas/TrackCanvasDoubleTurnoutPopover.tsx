import {
  Box,
  Group,
  Paper,
  Stack,
} from "@mantine/core";

import ElementPreview from "../../models/editor/rendering/ElementPreviewRenderer";
import TrackTurnoutDoubleElement from "../../models/editor/elements/TrackTurnoutDoubleElement";
import {
  TrackTurnoutThreeWayElement,
  type ThreeWayTurnoutPosition,
} from "../../models/editor/elements/TrackTurnoutThreeWayElement";
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

const THREE_WAY_POSITIONS: Array<{
  label: string;
  position: Exclude<ThreeWayTurnoutPosition, "invalid">;
}> = [
  {
    label: "Left",
    position: "left",
  },
  {
    label: "Straight",
    position: "straight",
  },
  {
    label: "Right",
    position: "right",
  },
];

export type TrackCanvasDoubleTurnoutPopoverProps = {
  state: DoubleTurnoutPopoverState;
  onClose: () => void;
};

function getConfiguredBits(
  turnout: TrackTurnoutDoubleElement,
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
  source: TrackTurnoutDoubleElement,
  target: TrackTurnoutDoubleElement
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
  selectedElement: TrackTurnoutDoubleElement,
  position: DoubleTurnoutPosition
): TrackTurnoutDoubleElement {
  const turnout =
    new TrackTurnoutDoubleElement(0, 0);

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
  turnout: TrackTurnoutDoubleElement,
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

function copyThreeWayConfiguration(
  source: TrackTurnoutThreeWayElement,
  target: TrackTurnoutThreeWayElement
): void {
  target.rotation = source.rotation;
  target.outputMode = source.outputMode;
  target.turnout1Address = source.turnout1Address;
  target.turnout2Address = source.turnout2Address;
  target.turnout1ClosedValue = source.turnout1ClosedValue;
  target.turnout2ClosedValue = source.turnout2ClosedValue;

  target.leftMotor1Value = source.leftMotor1Value;
  target.leftMotor2Value = source.leftMotor2Value;
  target.straightMotor1Value = source.straightMotor1Value;
  target.straightMotor2Value = source.straightMotor2Value;
  target.rightMotor1Value = source.rightMotor1Value;
  target.rightMotor2Value = source.rightMotor2Value;
}

function createThreeWayTurnoutPreview(
  selectedElement: TrackTurnoutThreeWayElement,
  position: Exclude<ThreeWayTurnoutPosition, "invalid">
): TrackTurnoutThreeWayElement {
  const turnout =
    new TrackTurnoutThreeWayElement(0, 0);

  copyThreeWayConfiguration(
    selectedElement,
    turnout
  );

  turnout.setLogicalPosition(position);

  return turnout;
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

function getMobileMapCenter(): {
  left: number;
  top: number;
} | null {
  if (typeof document === "undefined") {
    return null;
  }

  const mapOverlay =
    document.querySelector<HTMLElement>(
      ".mobile-runtime-layout-overlay"
    );

  if (!mapOverlay) {
    return null;
  }

  const rect =
    mapOverlay.getBoundingClientRect();

  if (
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }

  return {
    left:
      rect.left +
      rect.width / 2,
    top:
      rect.top +
      rect.height / 2,
  };
}

function getPanelPosition(
  x: number,
  y: number
): {
  left: number;
  top: number;
} {
  const panelHeight = 86;
  const margin = 8;

  const viewportHeight =
    typeof window !== "undefined"
      ? window.innerHeight
      : 768;

  const left = x;

  let top =
    y + 12;

  if (
    top + panelHeight + margin >
    viewportHeight
  ) {
    top =
      y - panelHeight - 12;
  }

  return {
    left,
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

  const mobileMapCenter =
    mobileCentered
      ? getMobileMapCenter()
      : null;

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
          left:
            mobileMapCenter?.left ??
            position.left,
          top:
            mobileMapCenter?.top ??
            position.top,
          transform: mobileMapCenter
            ? "translate(-50%, -50%)"
            : "translateX(-50%)",
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
            {turnout instanceof TrackTurnoutThreeWayElement
              ? THREE_WAY_POSITIONS.map(
                  turnoutPosition => (
                    <Box
                      key={turnoutPosition.position}
                      className="signal-aspect-button"
                      style={{
                        cursor: "pointer",
                        touchAction: "manipulation",
                      }}
                      onPointerDown={event => {
                        event.stopPropagation();
                      }}
                      onClick={() => {
                        turnout.setPositionAndSend(
                          turnoutPosition.position
                        );
                        onClose();
                      }}
                    >
                      <ElementPreview
                        style={{
                          cursor: "pointer",
                        }}
                        element={
                          createThreeWayTurnoutPreview(
                            turnout,
                            turnoutPosition.position
                          )
                        }
                        label={turnoutPosition.label}
                        width={48}
                        height={40}
                      />
                    </Box>
                  )
                )
              : DOUBLE_TURNOUT_POSITIONS.map(
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
