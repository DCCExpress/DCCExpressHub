import {
  getDirectionXy,
} from "../../helpers.js";
import {
  Point,
} from "../../Rect.js";
import {
  ELEMENT_TYPES,
} from "../elementTypes.js";
import type {
  TrackTurnoutTwoWayElementDto,
} from "../layoutDto.js";
import {
  TrackTurnoutElement,
} from "./TrackTurnoutElement.js";

export class TrackTurnoutTwoWayElement extends TrackTurnoutElement {
  override type: typeof ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY =
    ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY;

  override getNextItemXy(): Point {
    return this.isClosed
      ? getDirectionXy(this.pos, -this.rotation - 45)
      : getDirectionXy(this.pos, -this.rotation + 45);
  }

  override getPrevItemXy(): Point {
    return getDirectionXy(this.pos, -this.rotation + 180);
  }

  override getConnections(): {
    entry: Point;
    straight: Point;
    div: Point;
  } {
    return {
      entry: getDirectionXy(this.pos, -this.rotation + 180),
      straight: getDirectionXy(this.pos, -this.rotation - 45),
      div: getDirectionXy(this.pos, -this.rotation + 45),
    };
  }

  override getNeigbordsXy(): Point[] {
    return [
      getDirectionXy(this.pos, -this.rotation + 180),
      getDirectionXy(this.pos, -this.rotation - 45),
      getDirectionXy(this.pos, -this.rotation + 45),
    ];
  }

  static fromJSON(
    data: TrackTurnoutTwoWayElementDto
  ): TrackTurnoutTwoWayElement {
    const element = new TrackTurnoutTwoWayElement(data.x, data.y);

    element.id = data.id;
    element.name = data.name;
    element.layerName = data.layerName;
    element.rotation = data.rotation;
    element.rotationStep = data.rotationStep;
    element.address = data.address;
    element.length = data.length;
    element.turnoutAddress = data.turnoutAddress ?? 0;
    element.outputMode = data.outputMode === "vpin" ? "vpin" : "accessory";
    element.turnoutClosedValue = data.turnoutClosedValue ?? false;
    element.bg = data.bg;
    element.fg = data.fg;

    return element;
  }

  override toJSON(): TrackTurnoutTwoWayElementDto {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY,
      turnoutAddress: this.turnoutAddress,
      outputMode: this.outputMode,
      turnoutClosedValue: this.turnoutClosedValue,
    };
  }
}
