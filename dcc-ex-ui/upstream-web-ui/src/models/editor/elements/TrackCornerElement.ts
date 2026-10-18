import { getDirectionXy } from "../../../domain/helpers";
import { ELEMENT_TYPES } from "../../../domain/layout/elementTypes";
import { Point } from "../../../domain/Rect";
import { drawTextWithRoundedBackground } from "../../../graphics";
import { generateId } from "../../../helpers";
import { TrackElement } from "../core/TrackElement";
import { DrawOptions, ITrackCornerElement } from "../types/EditorTypes";
export class TrackCornerElement extends TrackElement {
  override getNextItemXy(): Point {
    return getDirectionXy(this.pos, this.rotation + 90);
  }
  override getPrevItemXy(): Point {
    return getDirectionXy(this.pos, this.rotation - 180);
  }
  override type: typeof ELEMENT_TYPES.TRACK_CORNER = ELEMENT_TYPES.TRACK_CORNER;
  constructor(x: number, y: number) {
    super(x, y);
    this.type = ELEMENT_TYPES.TRACK_CORNER;
    this.rotationStep = 90;
  }
  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;
    this.beginDraw(ctx, options);
    if (!this.enabled) {
      ctx.globalAlpha = this.alpha;
    }
    const w = this.GridSizeX / 4.0;
    const h = this.GridSizeY / 4.0;
    ctx.lineWidth = this.TrackWidth7;
    ctx.strokeStyle = this.TrackPrimaryColor;
    if (this.rotation == 0) {
      ctx.beginPath();
      ctx.moveTo(this.PositionX, this.centerY);
      ctx.lineTo(this.PositionX + 1 * w, this.centerY);
      ctx.lineTo(this.centerX, this.centerY + 1 * h);
      ctx.lineTo(this.centerX, this.PositionY + this.GridSizeY);
      ctx.stroke();
    } else if (this.rotation == 90) {
      ctx.beginPath();
      ctx.moveTo(this.PositionX, this.centerY);
      ctx.lineTo(this.PositionX + 1 * w, this.centerY);
      ctx.lineTo(this.centerX, this.centerY - 1 * h);
      ctx.lineTo(this.centerX, this.PositionY);
      ctx.stroke();
    } else if (this.rotation == 180) {
      ctx.beginPath();
      ctx.moveTo(this.centerX, this.PositionY);
      ctx.lineTo(this.centerX, this.PositionY + h);
      ctx.lineTo(this.centerX + w, this.centerY);
      ctx.lineTo(this.PositionX + this.GridSizeX, this.centerY);
      ctx.stroke();
    } else if (this.rotation == 270) {
      ctx.beginPath();
      ctx.moveTo(this.PositionX + this.GridSizeX, this.centerY);
      ctx.lineTo(this.centerX + w, this.centerY);
      ctx.lineTo(this.centerX, this.centerY + h);
      ctx.lineTo(this.centerX, this.PositionY + this.GridSizeY);
      ctx.stroke();
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.stateColor;
    if (this.rotation == 0) {
      ctx.beginPath();
      ctx.moveTo(this.PositionX + 1 * w, this.centerY);
      ctx.lineTo(this.centerX, this.centerY + 1 * h);
      ctx.stroke();
    } else if (this.rotation == 90) {
      ctx.beginPath();
      ctx.moveTo(this.PositionX + 1 * w, this.centerY);
      ctx.lineTo(this.centerX, this.centerY - 1 * h);
      ctx.stroke();
    } else if (this.rotation == 180) {
      ctx.beginPath();
      ctx.moveTo(this.centerX, this.PositionY + h);
      ctx.lineTo(this.centerX + w, this.centerY);
      ctx.stroke();
    } else if (this.rotation == 270) {
      ctx.beginPath();
      ctx.moveTo(this.centerX + w, this.centerY);
      ctx.lineTo(this.centerX, this.centerY + h);
      ctx.stroke();
    }
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
  override hitTest(px: number, py: number): boolean {
    return this.x == px && this.y == py;
  }
  override toJSON(): ITrackCornerElement {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.TRACK_CORNER,
      address: this.address,
      length: this.length,
    };
  }
  static fromJSON(data: ITrackCornerElement): TrackCornerElement {
    const corner = new TrackCornerElement(data.x, data.y);
    corner.id = data.id;
    corner.name = data.name;
    corner.layerName = data.layerName;
    corner.rotation = data.rotation;
    corner.rotationStep = data.rotationStep;
    corner.address = data.address;
    corner.length = data.length;
    corner.bg = data.bg;
    corner.fg = data.fg;
    return corner;
  }
  override clone(): TrackCornerElement {
    const copy = new TrackCornerElement(this.x, this.y);
    copy.id = generateId();
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.selected = this.selected;
    copy.address = this.address;
    copy.length = this.length;
    return copy;
  }
}
