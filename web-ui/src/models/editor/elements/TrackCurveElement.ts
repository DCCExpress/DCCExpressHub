import { getDirectionXy } from "../../../domain/helpers";
import { ELEMENT_TYPES } from "../../../domain/layout/elementTypes";
import { Point } from "../../../domain/Rect";
import { drawTextWithRoundedBackground } from "../../../graphics";
import { generateId } from "../../../helpers";
import { TrackElement } from "../core/TrackElement";
import { DrawOptions, ITrackCurveElement } from "../types/EditorTypes";
export class TrackCurveElement extends TrackElement {
  override getNextItemXy(): Point {
    return getDirectionXy(this.pos, this.rotation);
  }
  override getPrevItemXy(): Point {
    return getDirectionXy(this.pos, this.rotation + 225);
  }
  override type: typeof ELEMENT_TYPES.TRACK_CURVE = ELEMENT_TYPES.TRACK_CURVE;
  constructor(x: number, y: number) {
    super(x, y);
    this.type = ELEMENT_TYPES.TRACK_CURVE;
    this.rotationStep = 45;
  }
  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;
    this.beginDraw(ctx, options);
    if (!this.enabled) {
      ctx.globalAlpha = this.alpha;
    }
    ctx.lineWidth = this.TrackWidth7;
    ctx.strokeStyle = this.TrackPrimaryColor;
    this.drawCurvePath(ctx);
    ctx.stroke();
    ctx.lineWidth = this.TrackWidth3;
    ctx.strokeStyle = this.stateColor;
    const w2 = this.GridSizeX / 3;
    ctx.lineDashOffset = -w2 / 3;
    ctx.setLineDash([w2, w2]);
    this.drawCurvePath(ctx);
    ctx.stroke();
    if (options?.showOccupancySensorAddress) {
      drawTextWithRoundedBackground(
        ctx,
        this.posLeft,
        this.posBottom - 10,
        "#" + this.address.toString(),
      );
    }
    this.drawSectionInfo(ctx, options);
    this.endDraw(ctx);
    this.drawSelection(ctx);
  }
  private drawCurvePath(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    if (this.rotation == 0) {
      ctx.moveTo(this.PositionX, this.PositionY);
      ctx.lineTo(this.centerX, this.centerY);
      ctx.lineTo(this.PositionX + this.GridSizeX, this.centerY);
    } else if (this.rotation == 45) {
      ctx.moveTo(this.PositionX + this.GridSizeX / 2, this.PositionY);
      ctx.lineTo(this.centerX, this.centerY);
      ctx.lineTo(this.PositionX + this.GridSizeX, this.PositionY + this.GridSizeY);
    } else if (this.rotation == 90) {
      ctx.moveTo(this.PositionX + this.GridSizeX, this.PositionY);
      ctx.lineTo(this.centerX, this.centerY);
      ctx.lineTo(this.centerX, this.PositionY + this.GridSizeY);
    } else if (this.rotation == 135) {
      ctx.moveTo(this.PositionX, this.PositionY + this.GridSizeY);
      ctx.lineTo(this.centerX, this.centerY);
      ctx.lineTo(this.PositionX + this.GridSizeX, this.centerY);
    } else if (this.rotation == 180) {
      ctx.moveTo(this.PositionX, this.centerY);
      ctx.lineTo(this.centerX, this.centerY);
      ctx.lineTo(this.PositionX + this.GridSizeX, this.PositionY + this.GridSizeY);
    } else if (this.rotation == 225) {
      ctx.moveTo(this.PositionX, this.PositionY);
      ctx.lineTo(this.centerX, this.centerY);
      ctx.lineTo(this.centerX, this.PositionY + this.GridSizeY);
    } else if (this.rotation == 270) {
      ctx.moveTo(this.PositionX, this.PositionY + this.GridSizeY);
      ctx.lineTo(this.centerX, this.centerY);
      ctx.lineTo(this.centerX, this.PositionY);
    } else if (this.rotation == 315) {
      ctx.moveTo(this.PositionX, this.centerY);
      ctx.lineTo(this.centerX, this.centerY);
      ctx.lineTo(this.PositionX + this.GridSizeX, this.PositionY);
    }
  }
  override hitTest(px: number, py: number): boolean {
    return this.x == px && this.y == py;
  }
  override toJSON(): ITrackCurveElement {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.TRACK_CURVE,
      address: this.address,
      length: this.length,
    };
  }
  static fromJSON(data: ITrackCurveElement): TrackCurveElement {
    const curve = new TrackCurveElement(data.x, data.y);
    curve.id = data.id;
    curve.name = data.name;
    curve.layerName = data.layerName;
    curve.rotation = data.rotation;
    curve.rotationStep = data.rotationStep;
    curve.address = data.address;
    curve.length = data.length;
    curve.bg = data.bg;
    curve.fg = data.fg;
    return curve;
  }
  override clone(): TrackCurveElement {
    const copy = new TrackCurveElement(this.x, this.y);
    copy.id = generateId();
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.selected = this.selected;
    copy.address = this.address;
    copy.length = this.length;
    return copy;
  }
}
