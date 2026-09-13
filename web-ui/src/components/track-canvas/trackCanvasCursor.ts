
import type {
  BaseElement,
} from "../../models/editor/core/BaseElement";

import {
  ClickableBaseElement,
} from "../../models/editor/core/ClickableBaseElement";

import {
  AudioButtonElement,
} from "../../models/editor/elements/AudioButtonElement";

import {
  BlockElement,
} from "../../models/editor/elements/BlockElement";

import {
  TrackLevelCrossingElement,
} from "../../models/editor/elements/TrackLevelCrossingElement";

import {
  TrackSensorElement,
} from "../../models/editor/elements/TrackSensorElement";

import {
  TrackSignalElement,
} from "../../models/editor/elements/TrackSignalElement";

import {
  TrackTurnoutLeftElement,
} from "../../models/editor/elements/TrackTurnoutLeftElement";

import {
  TrackTurnoutRightElement,
} from "../../models/editor/elements/TrackTurnoutRightElement";

import TrackTurnoutDoubleElement from "../../models/editor/elements/TrackTurnoutDoubleElement";

import {
  TrackTurnoutTwoWayElement,
} from "../../models/editor/elements/TrackTurnoutTwoWayElement";

import type {
  EditorTool,
} from "../../models/editor/types/EditorTypes";

export function isTrackCanvasPointerElement(
  element: BaseElement | null
): boolean {
  return (
    element instanceof TrackTurnoutLeftElement ||
    element instanceof TrackTurnoutRightElement ||
    element instanceof TrackTurnoutTwoWayElement ||
    element instanceof TrackTurnoutDoubleElement ||
    element instanceof TrackSignalElement ||
    element instanceof TrackSensorElement ||
    element instanceof TrackLevelCrossingElement ||
    element instanceof ClickableBaseElement ||
    element instanceof AudioButtonElement ||
    element instanceof BlockElement
  );
}

export function getTrackCanvasCursor(
  editMode: boolean,
  tool: EditorTool,
  hoveredElement: BaseElement | null
): string {
  if (!editMode) {
    return isTrackCanvasPointerElement(hoveredElement)
      ? "pointer"
      : "default";
  }

  if (tool.mode === "draw") {
    return "crosshair";
  }

  return "default";
}
