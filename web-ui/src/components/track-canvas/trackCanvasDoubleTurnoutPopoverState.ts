import type {
  Dispatch,
  SetStateAction,
} from "react";

import type TrackTurnoutDoubleElement from "../../models/editor/elements/TrackTurnoutDoubleElement";
import type {
  TrackTurnoutThreeWayElement,
} from "../../models/editor/elements/TrackTurnoutThreeWayElement";
import type {
  DoubleTurnoutPopoverState,
} from "./TrackCanvas.types";

export type DoubleTurnoutPopoverStateSetter =
  Dispatch<SetStateAction<DoubleTurnoutPopoverState>>;

export type MultiMotorTurnout =
  | TrackTurnoutDoubleElement
  | TrackTurnoutThreeWayElement;

export function openTrackCanvasDoubleTurnoutPopover(
  setDoubleTurnoutPopover: DoubleTurnoutPopoverStateSetter,
  turnout: MultiMotorTurnout,
  clientX: number,
  clientY: number
): void {
  setDoubleTurnoutPopover({
    opened: true,
    x: clientX,
    y: clientY,
    turnout,
  });
}

export function closeTrackCanvasDoubleTurnoutPopover(
  setDoubleTurnoutPopover: DoubleTurnoutPopoverStateSetter
): void {
  setDoubleTurnoutPopover(previous => ({
    ...previous,
    opened: false,
    turnout: null,
  }));
}

export function reopenTrackCanvasDoubleTurnoutPopover(
  setDoubleTurnoutPopover: DoubleTurnoutPopoverStateSetter,
  turnout: MultiMotorTurnout,
  clientX: number,
  clientY: number,
  _delayMs = 100
): void {
  setDoubleTurnoutPopover({
    opened: true,
    x: clientX,
    y: clientY,
    turnout,
  });
}
