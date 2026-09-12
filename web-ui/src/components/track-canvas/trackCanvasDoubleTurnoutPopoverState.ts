import type {
  Dispatch,
  SetStateAction,
} from "react";

import type TrackTurnoutDoubleElementView from "../../models/editor/elements/TrackTurnoutDoubleElementView";
import type {
  DoubleTurnoutPopoverState,
} from "./TrackCanvas.types";

export type DoubleTurnoutPopoverStateSetter =
  Dispatch<SetStateAction<DoubleTurnoutPopoverState>>;

function isCoarsePointerDevice(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.matchMedia?.("(pointer: coarse)").matches === true ||
    navigator.maxTouchPoints > 0
  );
}

function setDoubleTurnoutPopoverOpen(
  setDoubleTurnoutPopover: DoubleTurnoutPopoverStateSetter,
  turnout: TrackTurnoutDoubleElementView,
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

export function openTrackCanvasDoubleTurnoutPopover(
  setDoubleTurnoutPopover: DoubleTurnoutPopoverStateSetter,
  turnout: TrackTurnoutDoubleElementView,
  clientX: number,
  clientY: number
): void {
  if (!isCoarsePointerDevice()) {
    setDoubleTurnoutPopoverOpen(
      setDoubleTurnoutPopover,
      turnout,
      clientX,
      clientY
    );
    return;
  }

  const handlePointerUp = (
    event: PointerEvent
  ) => {
    if (event.pointerType !== "touch") {
      return;
    }

    window.removeEventListener(
      "pointerup",
      handlePointerUp,
      true
    );

    // Let the original touch/click sequence finish before mounting
    // the Mantine popover. Otherwise mobile browsers can immediately
    // treat that same gesture as an outside click and close it.
    window.setTimeout(() => {
      setDoubleTurnoutPopoverOpen(
        setDoubleTurnoutPopover,
        turnout,
        clientX,
        clientY
      );
    }, 0);
  };

  window.addEventListener(
    "pointerup",
    handlePointerUp,
    true
  );
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
  turnout: TrackTurnoutDoubleElementView,
  clientX: number,
  clientY: number,
  delayMs = 100
): void {
  closeTrackCanvasDoubleTurnoutPopover(
    setDoubleTurnoutPopover
  );

  if (isCoarsePointerDevice()) {
    openTrackCanvasDoubleTurnoutPopover(
      setDoubleTurnoutPopover,
      turnout,
      clientX,
      clientY
    );
    return;
  }

  window.setTimeout(() => {
    setDoubleTurnoutPopoverOpen(
      setDoubleTurnoutPopover,
      turnout,
      clientX,
      clientY
    );
  }, delayMs);
}
