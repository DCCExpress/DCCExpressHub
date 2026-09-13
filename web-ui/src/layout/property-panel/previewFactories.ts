import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import type { BaseElement } from "../../models/editor/core/BaseElement";
import { TrackSignalElement } from "../../models/editor/elements/TrackSignalElement";
import TrackTurnoutDoubleElement from "../../models/editor/elements/TrackTurnoutDoubleElement";
import { TrackTurnoutLeftElement } from "../../models/editor/elements/TrackTurnoutLeftElement";
import { TrackTurnoutRightElement } from "../../models/editor/elements/TrackTurnoutRightElement";
import { TrackTurnoutTwoWayElement } from "../../models/editor/elements/TrackTurnoutTwoWayElement";
import { TrackTurnoutThreeWayElement } from "../../models/editor/elements/TrackTurnoutThreeWayElement";

export type SignalPreviewColor = 1 | 2 | 3 | 4;

function createFallbackTurnoutPreview(): BaseElement {
  const turnout = new TrackTurnoutLeftElement(0, 0);
  turnout.turnoutClosed = turnout.turnoutClosedValue;
  return turnout;
}

export function createTurnoutPreview(
  selectedElement: BaseElement,
  closed: boolean
): BaseElement {
  let turnout:
    | TrackTurnoutLeftElement
    | TrackTurnoutRightElement
    | TrackTurnoutTwoWayElement;

  if (selectedElement.type === ELEMENT_TYPES.TRACK_TURNOUT_LEFT) {
    turnout = new TrackTurnoutLeftElement(0, 0);
  } else if (selectedElement.type === ELEMENT_TYPES.TRACK_TURNOUT_RIGHT) {
    turnout = new TrackTurnoutRightElement(0, 0);
  } else if (selectedElement.type === ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY) {
    turnout = new TrackTurnoutTwoWayElement(0, 0);
  } else {
    return createFallbackTurnoutPreview();
  }

  const source = selectedElement as
    | TrackTurnoutLeftElement
    | TrackTurnoutRightElement
    | TrackTurnoutTwoWayElement;

  turnout.rotation = selectedElement.rotation;
  turnout.turnoutAddress = source.turnoutAddress;
  turnout.outputMode = source.outputMode;
  turnout.turnoutClosedValue = source.turnoutClosedValue;
  turnout.turnoutClosed = closed
    ? turnout.turnoutClosedValue
    : !turnout.turnoutClosedValue;

  return turnout;
}

export function createDoubleTurnoutPreview(
  selectedElement: TrackTurnoutDoubleElement,
  firstClosed: boolean,
  secondClosed: boolean
): BaseElement {
  const turnout = new TrackTurnoutDoubleElement(0, 0);

  turnout.rotation = selectedElement.rotation;
  turnout.turnout1Address = selectedElement.turnout1Address;
  turnout.turnout2Address = selectedElement.turnout2Address;
  turnout.turnout1ClosedValue = selectedElement.turnout1ClosedValue;
  turnout.turnout2ClosedValue = selectedElement.turnout2ClosedValue;

  turnout.turnout1Closed = firstClosed
    ? turnout.turnout1ClosedValue
    : !turnout.turnout1ClosedValue;

  turnout.turnout2Closed = secondClosed
    ? turnout.turnout2ClosedValue
    : !turnout.turnout2ClosedValue;

  return turnout;
}

export function createThreeWayTurnoutPreview(
  selectedElement: TrackTurnoutThreeWayElement,
  firstClosed: boolean,
  secondClosed: boolean
): BaseElement {
  const turnout = new TrackTurnoutThreeWayElement(0, 0);

  turnout.rotation = selectedElement.rotation;
  turnout.outputMode = selectedElement.outputMode;
  turnout.turnout1Address = selectedElement.turnout1Address;
  turnout.turnout2Address = selectedElement.turnout2Address;
  turnout.turnout1ClosedValue = selectedElement.turnout1ClosedValue;
  turnout.turnout2ClosedValue = selectedElement.turnout2ClosedValue;

  turnout.turnout1Closed = firstClosed
    ? turnout.turnout1ClosedValue
    : !turnout.turnout1ClosedValue;

  turnout.turnout2Closed = secondClosed
    ? turnout.turnout2ClosedValue
    : !turnout.turnout2ClosedValue;

  return turnout;
}

export function createSignalPreview(
  selectedElement: BaseElement,
  color: SignalPreviewColor
): BaseElement {
  if (selectedElement.type !== ELEMENT_TYPES.TRACK_SIGNAL2) {
    return createFallbackTurnoutPreview();
  }

  const signal = new TrackSignalElement(0, 0);
  signal.aspect = (selectedElement as TrackSignalElement).aspect;
  signal.rotation = 90;

  switch (color) {
    case 1:
      signal.setGreen();
      break;
    case 2:
      signal.setRed();
      break;
    case 3:
      signal.setYellow();
      break;
    case 4:
      signal.setWhite();
      break;
  }

  return signal;
}
