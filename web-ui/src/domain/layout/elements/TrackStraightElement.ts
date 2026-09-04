import {
  ELEMENT_TYPES,
} from "../elementTypes.js";
import type {
  TrackStraightElementDto,
} from "../layoutDto.js";
import {
  TrackElement,
} from "../model/TrackElement.js";

export class TrackStraightElement extends TrackElement {
  override type: typeof ELEMENT_TYPES.TRACK_STRAIGHT =
    ELEMENT_TYPES.TRACK_STRAIGHT;

  constructor(x: number, y: number) {
    super(x, y);
    this.type = ELEMENT_TYPES.TRACK_STRAIGHT;
    this.rotationStep = 45;
    this.length = 200;
  }

  static fromJSON(data: TrackStraightElementDto): TrackStraightElement {
    const element = new TrackStraightElement(data.x, data.y);
    element.id = data.id;
    element.name = data.name;
    element.layerName = data.layerName;
    element.rotation = data.rotation;
    element.rotationStep = data.rotationStep;
    element.address = data.address;
    element.length = data.length;
    element.bg = data.bg;
    element.fg = data.fg;
    return element;
  }

  override toJSON(): TrackStraightElementDto {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.TRACK_STRAIGHT,
    };
  }
}
