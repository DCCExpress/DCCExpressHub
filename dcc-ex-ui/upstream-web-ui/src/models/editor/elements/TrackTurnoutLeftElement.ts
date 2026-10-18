import { getDirectionXy } from "../../../domain/helpers";
import { ELEMENT_TYPES } from "../../../domain/layout/elementTypes";
import { Point } from "../../../domain/Rect";
import { generateId } from "../../../helpers";
import type { ITrackTurnoutLeftElement } from "../types/EditorTypes";
import { TrackTurnoutElement } from "./TrackTurnoutElement";
export class TrackTurnoutLeftElement extends TrackTurnoutElement {
  override getNextItemXy(): Point {
    if (this.isClosed) {
      return getDirectionXy(this.pos, -this.rotation);
    }
    return getDirectionXy(this.pos, -this.rotation - 45);
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
      straight: getDirectionXy(this.pos, -this.rotation),
      entry: getDirectionXy(this.pos, -this.rotation + 180),
      div: getDirectionXy(this.pos, -this.rotation - 45),
    };
  }
  override getNeigbordsXy(): Point[] {
    return [
      getDirectionXy(this.pos, -this.rotation),
      getDirectionXy(this.pos, -this.rotation - 45),
      getDirectionXy(this.pos, -this.rotation + 180),
    ];
  }
  override type: typeof ELEMENT_TYPES.TRACK_TURNOUT_LEFT = ELEMENT_TYPES.TRACK_TURNOUT_LEFT;
  constructor(x: number, y: number) {
    super(x, y);
  }
  override drawTurnout(ctx: CanvasRenderingContext2D, closed: boolean): void {
    ctx.beginPath();
    ctx.strokeStyle = this.TrackPrimaryColor;
    ctx.lineWidth = this.TrackWidth7;
    ctx.translate(this.centerX, this.centerY);
    ctx.scale(1, -1);
    ctx.translate(-this.centerX, -this.centerY);
    if (this.rotation == 0) {
      ctx.moveTo(this.posLeft, this.centerY);
      ctx.lineTo(this.posRight, this.centerY);
      ctx.moveTo(this.centerX, this.centerY);
      ctx.lineTo(this.posRight, this.posBottom);
    } else if (this.rotation == 45) {
      ctx.moveTo(this.posLeft, this.posTop);
      ctx.lineTo(this.posRight, this.posBottom);
      ctx.moveTo(this.centerX, this.centerY);
      ctx.lineTo(this.centerX, this.posBottom);
    } else if (this.rotation == 90) {
      ctx.moveTo(this.centerX, this.posTop);
      ctx.lineTo(this.centerX, this.posBottom);
      ctx.moveTo(this.centerX, this.centerY);
      ctx.lineTo(this.posLeft, this.posBottom);
    } else if (this.rotation == 135) {
      ctx.moveTo(this.posRight, this.posTop);
      ctx.lineTo(this.posLeft, this.posBottom);
      ctx.moveTo(this.centerX, this.centerY);
      ctx.lineTo(this.posLeft, this.centerY);
    } else if (this.rotation == 180) {
      ctx.moveTo(this.posLeft, this.centerY);
      ctx.lineTo(this.posRight, this.centerY);
      ctx.moveTo(this.centerX, this.centerY);
      ctx.lineTo(this.posLeft, this.posTop);
    } else if (this.rotation == 225) {
      ctx.moveTo(this.posLeft, this.posTop);
      ctx.lineTo(this.posRight, this.posBottom);
      ctx.moveTo(this.centerX, this.centerY);
      ctx.lineTo(this.centerX, this.posTop);
    } else if (this.rotation == 270) {
      ctx.moveTo(this.centerX, this.posTop);
      ctx.lineTo(this.centerX, this.posBottom);
      ctx.moveTo(this.centerX, this.centerY);
      ctx.lineTo(this.posRight, this.posTop);
    } else if (this.rotation == 315) {
      ctx.moveTo(this.posRight, this.posTop);
      ctx.lineTo(this.posLeft, this.posBottom);
      ctx.moveTo(this.centerX, this.centerY);
      ctx.lineTo(this.posRight, this.centerY);
    }
    ctx.stroke();
    ctx.lineWidth = this.TrackWidth3;
    ctx.strokeStyle = this.stateColor;
    if (closed) {
      ctx.beginPath();
      const dx = this.width / 5;
      if (this.rotation == 0) {
        ctx.moveTo(this.posLeft + dx, this.centerY);
        ctx.lineTo(this.posRight - dx, this.centerY);
      } else if (this.rotation == 45) {
        ctx.moveTo(this.posLeft + dx, this.posTop + dx);
        ctx.lineTo(this.posRight - dx, this.posBottom - dx);
      } else if (this.rotation == 90) {
        ctx.moveTo(this.centerX, this.posTop + dx);
        ctx.lineTo(this.centerX, this.posBottom - dx);
      } else if (this.rotation == 135) {
        ctx.moveTo(this.posRight - dx, this.posTop + dx);
        ctx.lineTo(this.posLeft + dx, this.posBottom - dx);
      } else if (this.rotation == 180) {
        ctx.moveTo(this.posLeft + dx, this.centerY);
        ctx.lineTo(this.posRight - dx, this.centerY);
      } else if (this.rotation == 225) {
        ctx.moveTo(this.posLeft + dx, this.posTop + dx);
        ctx.lineTo(this.posRight - dx, this.posBottom - dx);
      } else if (this.rotation == 270) {
        ctx.moveTo(this.centerX, this.posTop + dx);
        ctx.lineTo(this.centerX, this.posBottom - dx);
      } else if (this.rotation == 315) {
        ctx.moveTo(this.posRight - dx, this.posTop + dx);
        ctx.lineTo(this.posLeft + dx, this.posBottom - dx);
      }
      ctx.stroke();
    } else {
      ctx.beginPath();
      const dx = this.width / 5;
      const dx2 = this.width / 5;
      if (this.rotation == 0) {
        ctx.moveTo(this.posLeft + dx, this.centerY);
        ctx.lineTo(this.centerX, this.centerY);
        ctx.lineTo(this.posRight - dx2, this.posBottom - dx2);
      } else if (this.rotation == 45) {
        ctx.moveTo(this.posLeft + dx, this.posTop + dx);
        ctx.lineTo(this.centerX, this.centerY);
        ctx.lineTo(this.centerX, this.posBottom - dx2);
      } else if (this.rotation == 90) {
        ctx.moveTo(this.centerX, this.posTop + dx);
        ctx.lineTo(this.centerX, this.centerY);
        ctx.lineTo(this.posLeft + dx2, this.posBottom - dx2);
      } else if (this.rotation == 135) {
        ctx.moveTo(this.posRight - dx2, this.posTop + dx2);
        ctx.lineTo(this.centerX, this.centerY);
        ctx.lineTo(this.posLeft + dx, this.centerY);
      } else if (this.rotation == 180) {
        ctx.moveTo(this.posLeft + dx2, this.posTop + dx2);
        ctx.lineTo(this.centerX, this.centerY);
        ctx.lineTo(this.posRight - dx, this.centerY);
      } else if (this.rotation == 225) {
        ctx.moveTo(this.centerX, this.posTop + dx);
        ctx.lineTo(this.centerX, this.centerY);
        ctx.lineTo(this.posRight - dx2, this.posBottom - dx2);
      } else if (this.rotation == 270) {
        ctx.moveTo(this.posRight - dx2, this.posTop + dx2);
        ctx.lineTo(this.centerX, this.centerY);
        ctx.lineTo(this.centerX, this.posBottom - dx);
      } else if (this.rotation == 315) {
        ctx.moveTo(this.posRight - dx, this.centerY);
        ctx.lineTo(this.centerX, this.centerY);
        ctx.lineTo(this.posLeft + dx2, this.posBottom - dx2);
      }
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "black";
    ctx.fillStyle = this.locked ? this.turnoutLockedColor : this.turnoutUnLockedColor;
    ctx.arc(this.centerX, this.centerY, 3, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
  override toJSON(): ITrackTurnoutLeftElement {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.TRACK_TURNOUT_LEFT,
      address: this.address,
      length: this.length,
      turnoutAddress: this.turnoutAddress,
      turnoutClosedValue: this.turnoutClosedValue,
    };
  }
  static fromJSON(data: ITrackTurnoutLeftElement): TrackTurnoutLeftElement {
    const element = new TrackTurnoutLeftElement(data.x, data.y);
    element.id = data.id;
    element.name = data.name;
    element.layerName = data.layerName;
    element.rotation = data.rotation;
    element.rotationStep = data.rotationStep;
    element.address = data.address;
    element.length = data.length;
    element.turnoutAddress = data.turnoutAddress ?? 0;
    element.outputMode = data.outputMode === "vpin" ? "vpin" : "accessory";
    element.turnoutClosedValue = data.turnoutClosedValue;
    element.bg = data.bg;
    element.fg = data.fg;
    element.readTurnoutConfiguration(data);
    return element;
  }
  override clone(): TrackTurnoutLeftElement {
    const copy = new TrackTurnoutLeftElement(this.x, this.y);
    copy.id = generateId();
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.selected = this.selected;
    copy.address = this.address;
    copy.length = this.length;
    copy.turnoutAddress = this.turnoutAddress;
    copy.outputMode = this.outputMode;
    copy.turnoutClosed = this.turnoutClosed;
    copy.turnoutClosedValue = this.turnoutClosedValue;
    copy.readTurnoutConfiguration(this);
    return copy;
  }
}
