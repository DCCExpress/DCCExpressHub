import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import { BaseElement } from "../../models/editor/core/BaseElement";
import { AudioButtonElement } from "../../models/editor/elements/AudioButtonElement";
import { AudioListButtonElement } from "../../models/editor/elements/AudioListButtonElement";
import { BlockElement } from "../../models/editor/elements/BlockElement";
import { ButtonElement } from "../../models/editor/elements/ButtonElement";
import { ButtonScriptElement } from "../../models/editor/elements/ButtonScriptElement";
import { ClockElement } from "../../models/editor/elements/ClockElement";
import { ExtendedRouteButtonElement } from "../../models/editor/elements/ExtendedRouteButtonElement";
import { LabelElement } from "../../models/editor/elements/LabelElement";
import { RouteButtonElement } from "../../models/editor/elements/RouteButtonElement";
import { TrackCornerElement } from "../../models/editor/elements/TrackCornerElement";
import { TrackCrossingElement } from "../../models/editor/elements/TrackCrossingElement";
import { TrackCurveElement } from "../../models/editor/elements/TrackCurveElement";
import { TrackDirectionElement } from "../../models/editor/elements/TrackDirectionElement";
import { TrackEndElement } from "../../models/editor/elements/TrackEndElement";
import { TrackLevelCrossingElement } from "../../models/editor/elements/TrackLevelCrossingElement";
import { TrackSensorElement } from "../../models/editor/elements/TrackSensorElement";
import { TrackSignalElement } from "../../models/editor/elements/TrackSignalElement";
import { TrackStraightElement } from "../../models/editor/elements/TrackStraightElement";
import TrackTurnoutDoubleElement from "../../models/editor/elements/TrackTurnoutDoubleElement";
import { TrackTurnoutLeftElement } from "../../models/editor/elements/TrackTurnoutLeftElement";
import { TrackTurnoutRightElement } from "../../models/editor/elements/TrackTurnoutRightElement";
import { TrackTurnoutThreeWayElement } from "../../models/editor/elements/TrackTurnoutThreeWayElement";
import { TrackTurnoutTwoWayElement } from "../../models/editor/elements/TrackTurnoutTwoWayElement";
import { TreeElement } from "../../models/editor/elements/TreeElement";
import type { EditorTool } from "../../models/editor/types/EditorTypes";

const cursorTrackElement = new TrackStraightElement(0, 0);
const cursorTrackLevelCrossingElement = new TrackLevelCrossingElement(0, 0);
const cursorTrackDirectionElement = new TrackDirectionElement(0, 0);
const cursorTrackEndElement = new TrackEndElement(0, 0);
const cursorTrackCornerElement = new TrackCornerElement(0, 0);
const cursorTrackCurveElement = new TrackCurveElement(0, 0);
const cursorTrackTurnoutLeftElement = new TrackTurnoutLeftElement(0, 0);
const cursorTrackTurnoutRightElement = new TrackTurnoutRightElement(0, 0);
const cursorTrackTurnoutTwoWayElement = new TrackTurnoutTwoWayElement(0, 0);
const cursorTrackTurnoutThreeWayElement = new TrackTurnoutThreeWayElement(0, 0);
const cursorTrackTurnoutDoubleElement = new TrackTurnoutDoubleElement(0, 0);
const cursorTrackSensorElement = new TrackSensorElement(0, 0);
const cursorTrackSignalElement = new TrackSignalElement(0, 0);
const cursorTrackCrossingElement = new TrackCrossingElement(0, 0);
const cursorButtonElement = new ButtonElement(0, 0);
const cursorButtonScriptElement = new ButtonScriptElement(0, 0);
const cursorRouteButtonElement = new RouteButtonElement(0, 0);
const cursorExtendedRouteButtonElement = new ExtendedRouteButtonElement(0, 0);
const cursorAudioButtonElement = new AudioButtonElement(0, 0);
const cursorAudioListButtonElement = new AudioListButtonElement(0, 0);
const cursorClockElement = new ClockElement(0, 0);
const cursorTreeElement = new TreeElement(0, 0);
const cursorBlockElement = new BlockElement(0, 0);
const cursorLabelElement = new LabelElement(0, 0);

export function createCursorElement(tool: EditorTool): BaseElement | null {
  switch (tool.elementType) {
    case ELEMENT_TYPES.TRACK_STRAIGHT: return cursorTrackElement;
    case ELEMENT_TYPES.TRACK_LEVEL_CROSSING: return cursorTrackLevelCrossingElement;
    case ELEMENT_TYPES.TRACK_DIRECTION: return cursorTrackDirectionElement;
    case ELEMENT_TYPES.TRACK_END: return cursorTrackEndElement;
    case ELEMENT_TYPES.TRACK_CORNER: return cursorTrackCornerElement;
    case ELEMENT_TYPES.TRACK_CURVE: return cursorTrackCurveElement;
    case ELEMENT_TYPES.TRACK_CROSSING: return cursorTrackCrossingElement;
    case ELEMENT_TYPES.TRACK_TURNOUT_LEFT: return cursorTrackTurnoutLeftElement;
    case ELEMENT_TYPES.TRACK_TURNOUT_RIGHT: return cursorTrackTurnoutRightElement;
    case ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY: return cursorTrackTurnoutTwoWayElement;
    case ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY: return cursorTrackTurnoutThreeWayElement;
    case ELEMENT_TYPES.TRACK_TURNOUT_DOUBLE: return cursorTrackTurnoutDoubleElement;
    case ELEMENT_TYPES.TRACK_SENSOR: return cursorTrackSensorElement;
    case ELEMENT_TYPES.BUTTON: return cursorButtonElement;
    case ELEMENT_TYPES.BUTTON_SCRIPT: return cursorButtonScriptElement;
    case ELEMENT_TYPES.BUTTON_AUDIO: return cursorAudioButtonElement;
    case ELEMENT_TYPES.BUTTON_AUDIO_LIST: return cursorAudioListButtonElement;
    case ELEMENT_TYPES.BUTTON_ROUTE: return cursorRouteButtonElement;
    case ELEMENT_TYPES.BUTTON_ROUTE_EXTENDED: return cursorExtendedRouteButtonElement;
    case ELEMENT_TYPES.CLOCK: return cursorClockElement;
    case ELEMENT_TYPES.TREE: return cursorTreeElement;
    case ELEMENT_TYPES.TRACK_BLOCK: return cursorBlockElement;
    case ELEMENT_TYPES.TRACK_SIGNAL2:
    case ELEMENT_TYPES.TRACK_SIGNAL3:
    case ELEMENT_TYPES.TRACK_SIGNAL4:
      return cursorTrackSignalElement;
    case ELEMENT_TYPES.LABEL: return cursorLabelElement;
    default: return null;
  }
}
