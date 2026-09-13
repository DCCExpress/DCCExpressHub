import { BaseElement } from "./BaseElement";
import { TrackStraightElement } from "../elements/TrackStraightElement";
import { EditorElementData } from "../types/EditorTypes";
import { TrackCornerElement } from "../elements/TrackCornerElement";
import { TrackEndElement } from "../elements/TrackEndElement";
import { TrackCurveElement } from "../elements/TrackCurveElement";
import { TrackTurnoutLeftElement } from "../elements/TrackTurnoutLeftElement";
import { TrackTurnoutRightElement } from "../elements/TrackTurnoutRightElement";
import TrackTurnoutDoubleElement from "../elements/TrackTurnoutDoubleElement";
import { TrackTurnoutTwoWayElement } from "../elements/TrackTurnoutTwoWayElement";
import { TrackTurnoutThreeWayElement } from "../elements/TrackTurnoutThreeWayElement";
import { TrackSensorElement } from "../elements/TrackSensorElement";
import { ButtonElement } from "../elements/ButtonElement";
import { ClockElement } from "../elements/ClockElement";
import { BlockElement } from "../elements/BlockElement";
import { TreeElement } from "../elements/TreeElement";
import { TrackSignalElement } from "../elements/TrackSignalElement";
import { AudioButtonElement } from "../elements/AudioButtonElement";
import { AudioListButtonElement } from "../elements/AudioListButtonElement";
import { RouteButtonElement } from "../elements/RouteButtonElement";
import { TrackCrossingElement } from "../elements/TrackCrossingElement";
import { TrackLevelCrossingElement } from "../elements/TrackLevelCrossingElement";
import { ButtonScriptElement } from "../elements/ButtonScriptElement";
import { LabelElement } from "../elements/LabelElement";
import { TrackDirectionElement } from "../elements/TrackDirectionElement";
import { ExtendedRouteButtonElement } from "../elements/ExtendedRouteButtonElement";
import { ELEMENT_TYPES } from "@domain/layout/elementTypes";

export class ElementFactory {
  static create(
    data: EditorElementData
  ): BaseElement {
    switch (data.type) {
      case ELEMENT_TYPES.TRACK_STRAIGHT:
        return TrackStraightElement.fromJSON(data);

      case ELEMENT_TYPES.TRACK_LEVEL_CROSSING:
        return TrackLevelCrossingElement.fromJSON(data);

      case ELEMENT_TYPES.TRACK_DIRECTION:
        return TrackDirectionElement.fromJSON(data);

      case ELEMENT_TYPES.TRACK_END:
        return TrackEndElement.fromJSON(data);

      case ELEMENT_TYPES.TRACK_CORNER:
        return TrackCornerElement.fromJSON(data);

      case ELEMENT_TYPES.TRACK_CURVE:
        return TrackCurveElement.fromJSON(data);

      case ELEMENT_TYPES.TRACK_CROSSING:
        return TrackCrossingElement.fromJSON(data);

      case ELEMENT_TYPES.TRACK_TURNOUT_LEFT:
        return TrackTurnoutLeftElement.fromJSON(data);

      case ELEMENT_TYPES.TRACK_TURNOUT_RIGHT:
        return TrackTurnoutRightElement.fromJSON(data);

      case ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY:
        return TrackTurnoutTwoWayElement.fromJSON(data);

      case ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY:
        return TrackTurnoutThreeWayElement.fromJSON(data);

      case ELEMENT_TYPES.TRACK_TURNOUT_DOUBLE:
        return TrackTurnoutDoubleElement.fromJSON(data);

      case ELEMENT_TYPES.TRACK_SENSOR:
        return TrackSensorElement.fromJSON(data);

      case ELEMENT_TYPES.TRACK_SIGNAL2:
      case ELEMENT_TYPES.TRACK_SIGNAL3:
      case ELEMENT_TYPES.TRACK_SIGNAL4:
        return TrackSignalElement.fromJSON(data);

      case ELEMENT_TYPES.BUTTON:
        return ButtonElement.fromJSON(data);

      case ELEMENT_TYPES.BUTTON_SCRIPT:
        return ButtonScriptElement.fromJSON(data);

      case ELEMENT_TYPES.BUTTON_AUDIO:
        return AudioButtonElement.fromJSON(data);

      case ELEMENT_TYPES.BUTTON_AUDIO_LIST:
        return AudioListButtonElement.fromJSON(data);

      case ELEMENT_TYPES.BUTTON_ROUTE:
        return RouteButtonElement.fromJSON(data);

      case ELEMENT_TYPES.BUTTON_ROUTE_EXTENDED:
        return ExtendedRouteButtonElement.fromJSON(data);

      case ELEMENT_TYPES.CLOCK:
        return ClockElement.fromJSON(data);

      case ELEMENT_TYPES.TRACK_BLOCK:
        return BlockElement.fromJSON(data);

      case ELEMENT_TYPES.TREE:
        return TreeElement.fromJSON(data);

      case ELEMENT_TYPES.LABEL:
        return LabelElement.fromJSON(data);

      default:
        throw new Error(
          `Unsupported element type: ${
            (data as { type?: string }).type
          }`
        );
    }
  }

  static createMany(
    elements: EditorElementData[]
  ): BaseElement[] {
    return elements.map(
      element =>
        this.create(element)
    );
  }
}
