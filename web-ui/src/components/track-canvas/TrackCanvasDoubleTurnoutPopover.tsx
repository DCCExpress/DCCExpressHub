import {
  Box,
  Group,
  Popover,
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

export function TrackCanvasDoubleTurnoutPopover({
  state,
  onClose,
}: TrackCanvasDoubleTurnoutPopoverProps) {
  const turnout = state.turnout;

  return (
    <Popover
      opened={state.opened}
      onChange={opened => {
        if (!opened) {
          onClose();
        }
      }}
      withArrow
      shadow="xl"
      closeOnClickOutside
      closeOnEscape
      withinPortal
      offset={18}
      transitionProps={{
        transition: "scale",
        duration: 200,
        timingFunction: "ease-out",
      }}
    >
      <Popover.Target>
        <Box
          p={4}
          style={{
            position: "fixed",
            left: state.x,
            top: state.y,
            width: 0,
            height: 0,
            pointerEvents: "none",
          }}
        />
      </Popover.Target>

      <Popover.Dropdown
        p={4}
        onPointerDown={event => {
          event.stopPropagation();
        }}
        onMouseDown={event => {
          event.stopPropagation();
        }}
        onClick={event => {
          event.stopPropagation();
        }}
      >
        <Stack gap="xs">
          <Group gap={4}>
            {turnout &&
              DOUBLE_TURNOUT_POSITIONS.map(
                position => (
                  <Box
                    key={position.label}
                    className="signal-aspect-button"
                    onClick={() => {
                      onClose();

                      setDoubleTurnoutPosition(
                        turnout,
                        position
                      );
                    }}
                  >
                    <ElementPreview
                      style={{
                        cursor: "pointer",
                      }}
                      element={
                        createDoubleTurnoutPreview(
                          turnout,
                          position
                        )
                      }
                      label={
                        position.label
                      }
                      width={40}
                      height={40}
                    />
                  </Box>
                )
              )}
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
