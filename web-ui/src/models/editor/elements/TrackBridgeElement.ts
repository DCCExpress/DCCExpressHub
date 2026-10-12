import { ELEMENT_TYPES } from "../../../domain/layout/elementTypes";
import type { TrackBridgeElementDto } from "../../../domain/layout/layoutDto";
import { drawTextWithRoundedBackground } from "../../../graphics";
import { generateId } from "../../../helpers";
import { TrackElement } from "../core/TrackElement";
import { DrawOptions, ITrackBridgeElement } from "../types/EditorTypes";
export class TrackBridgeElement extends TrackElement {
  override toJSON(): TrackBridgeElementDto {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.TRACK_BRIDGE,
    };
  }
  override type: typeof ELEMENT_TYPES.TRACK_BRIDGE = ELEMENT_TYPES.TRACK_BRIDGE;
  constructor(x: number, y: number) {
    super(x, y);
    this.type = ELEMENT_TYPES.TRACK_BRIDGE;
    this.rotationStep = 0;
    this.name = "Bridge";
    this.length = 200;
  }
  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;
    this.beginDraw(ctx, options);
    if (!this.enabled) {
      ctx.globalAlpha = this.alpha;
    }
    ctx.lineWidth = 7;
    ctx.strokeStyle = "black";
    if (this.rotation == 0 || this.rotation == 180) {
      ctx.beginPath();
      ctx.moveTo(this.posLeft, this.centerY);
      ctx.lineTo(this.posLeft + this.GridSizeX, this.centerY);
      ctx.stroke();
    } else if (this.rotation == 45 || this.rotation == 225) {
      ctx.beginPath();
      ctx.moveTo(this.PositionX, this.PositionY);
      ctx.lineTo(this.PositionX + this.GridSizeX, this.PositionY + this.GridSizeY);
      ctx.stroke();
    } else if (this.rotation == 90 || this.rotation == 270) {
      ctx.beginPath();
      ctx.moveTo(this.centerX, this.PositionY);
      ctx.lineTo(this.centerX, this.PositionY + this.GridSizeY);
      ctx.stroke();
    } else if (this.rotation == 135 || this.rotation == 315) {
      ctx.beginPath();
      ctx.moveTo(this.PositionX + this.GridSizeX, this.PositionY);
      ctx.lineTo(this.PositionX, this.PositionY + this.GridSizeY);
      ctx.stroke();
    }
    ctx.lineWidth = this.TrackWidth3;
    ctx.strokeStyle = this.stateColor;
    const w4 = this.GridSizeX / 4;
    if (this.rotation == 0 || this.rotation == 180) {
      ctx.beginPath();
      ctx.moveTo(this.posLeft + w4, this.centerY);
      ctx.lineTo(this.posRight - w4, this.centerY);
      ctx.stroke();
    } else if (this.rotation == 45 || this.rotation == 225) {
      ctx.beginPath();
      ctx.moveTo(this.posLeft + w4, this.posTop + w4);
      ctx.lineTo(this.posRight - w4, this.posBottom - w4);
      ctx.stroke();
    } else if (this.rotation == 90 || this.rotation == 270) {
      ctx.beginPath();
      ctx.moveTo(this.centerX, this.posTop + w4);
      ctx.lineTo(this.centerX, this.posBottom - w4);
      ctx.stroke();
    } else if (this.rotation == 135 || this.rotation == 315) {
      ctx.beginPath();
      ctx.moveTo(this.posRight - w4, this.posTop + w4);
      ctx.lineTo(this.posLeft + w4, this.posBottom - w4);
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
    // Two bridge piers, perpendicular to the raised rails.
    ctx.save();
    ctx.translate(this.centerX, this.centerY);
    ctx.rotate(this.rotation * Math.PI / 180);
    ctx.fillStyle = "#90969c";
    ctx.strokeStyle = "#343a40";
    ctx.lineWidth = 1.5;
    for (const offset of [-this.GridSizeX * 0.3, this.GridSizeX * 0.3]) {
      ctx.fillRect(offset - 4, -this.GridSizeY * 0.42, 8, this.GridSizeY * 0.84);
      ctx.strokeRect(offset - 4, -this.GridSizeY * 0.42, 8, this.GridSizeY * 0.84);
    }
    ctx.restore();
    this.drawSelection(ctx);
  }
  static fromJSON(data: ITrackBridgeElement): TrackBridgeElement {
    const track = new TrackBridgeElement(data.x, data.y);
    track.id = data.id;
    track.name = data.name;
    track.layerName = data.layerName;
    track.rotation = data.rotation;
    track.rotationStep = 0;
    track.address = data.address;
    track.length = data.length;
    track.bg = data.bg;
    track.fg = data.fg;
    return track;
  }
  override clone(): TrackBridgeElement {
    const copy = new TrackBridgeElement(this.x, this.y);
    copy.id = generateId();
    copy.rotation = this.rotation;
    copy.rotationStep = 0;
    copy.selected = this.selected;
    copy.address = this.address;
    copy.length = this.length;
    return copy;
  }
  override getHelp(): string {
    return `
    <h3 style="margin-top:0;">Track element</h3>
    <p>Bridge: only on an existing straight track, at right angles.</p>
    <ul>
      <li>Rotation is locked to the underlying track</li>
      <li>You can move it by drag and drop</li>
    </ul>
  `;
  }
}
