import { getDirectionXy } from "../../../domain/helpers";
import { ELEMENT_TYPES } from "../../../domain/layout/elementTypes";
import { Point } from "../../../domain/Rect";
import { generateId } from "../../../helpers";
import type { ITrackTurnoutTwoWayElement } from "../types/EditorTypes";
import { TrackTurnoutElement } from "./TrackTurnoutElement";
export class TrackTurnoutTwoWayElement extends TrackTurnoutElement {
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
  override type: typeof ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY = ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY;
  constructor(x: number, y: number) {
    super(x, y);
  }
  override drawTurnout(ctx: CanvasRenderingContext2D, closed: boolean): void {
    const dx = this.width / 5;
    ctx.beginPath();
    ctx.strokeStyle = this.TrackPrimaryColor;
    ctx.lineWidth = this.TrackWidth7;
    if (this.rotation % 90 === 0) {
      ctx.translate(this.centerX, this.centerY);
      ctx.rotate((this.rotation * Math.PI) / 180);
      ctx.translate(-this.centerX, -this.centerY);
      ctx.moveTo(this.posLeft, this.centerY);
      ctx.lineTo(this.centerX, this.centerY);
      ctx.lineTo(this.posRight, this.posTop);
      ctx.moveTo(this.centerX, this.centerY);
      ctx.lineTo(this.posRight, this.posBottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = this.stateColor;
      ctx.lineWidth = this.TrackWidth3;
      ctx.moveTo(this.posLeft + dx, this.centerY);
      ctx.lineTo(this.centerX, this.centerY);
      if (closed) {
        ctx.lineTo(this.posRight - dx, this.posTop + dx);
      } else {
        ctx.lineTo(this.posRight - dx, this.posBottom - dx);
      }
      ctx.stroke();
    } else {
      ctx.translate(this.centerX, this.centerY);
      ctx.rotate(((this.rotation + 45) * Math.PI) / 180);
      ctx.translate(-this.centerX, -this.centerY);
      ctx.moveTo(this.posLeft, this.posBottom);
      ctx.lineTo(this.centerX, this.centerY);
      ctx.lineTo(this.centerX, this.posTop);
      ctx.moveTo(this.centerX, this.centerY);
      ctx.lineTo(this.posRight, this.centerY);
      ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = this.stateColor;
      ctx.lineWidth = this.TrackWidth3;
      ctx.moveTo(this.posLeft + dx, this.posBottom - dx);
      ctx.lineTo(this.centerX, this.centerY);
      if (closed) {
        ctx.lineTo(this.centerX, this.posTop + dx);
      } else {
        ctx.lineTo(this.posRight - dx, this.centerY);
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
  override toJSON(): ITrackTurnoutTwoWayElement {
    return {
      ...super.toJSON(),
      outputMode: this.outputMode,
      type: ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY,
      address: this.address,
      length: this.length,
      turnoutAddress: this.turnoutAddress,
      turnoutClosedValue: this.turnoutClosedValue,
    };
  }
  static fromJSON(data: ITrackTurnoutTwoWayElement): TrackTurnoutTwoWayElement {
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
    element.readTurnoutConfiguration(data);
    if (data.outputMode === "vpin") element.outputMode = "vpin";
    return element;
  }
  override clone(): TrackTurnoutTwoWayElement {
    const copy = new TrackTurnoutTwoWayElement(this.x, this.y);
    copy.id = generateId();
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.selected = this.selected;
    copy.address = this.address;
    copy.length = this.length;
    copy.turnoutAddress = this.turnoutAddress;
    copy.outputMode = this.outputMode;
    copy.turnoutClosedValue = this.turnoutClosedValue;
    copy.turnoutClosed = this.turnoutClosed;
    copy.readTurnoutConfiguration(this);
    copy.outputMode = this.outputMode;
    return copy;
  }
}
