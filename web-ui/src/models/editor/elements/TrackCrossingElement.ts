import { getDirectionXy } from "../../../domain/helpers";
import { ELEMENT_TYPES } from "../../../domain/layout/elementTypes";
import type { Point } from "../../../domain/Rect";
import { drawTextWithRoundedBackground } from "../../../graphics";
import { generateId } from "../../../helpers";
import { type NeighborPointPair } from "../core/BaseElement";
import { TrackElement } from "../core/TrackElement";
import { DrawOptions, ITrackCrossingElement } from "../types/EditorTypes";
export class TrackCrossingElement extends TrackElement {
  override getNeighborPointPairs(): NeighborPointPair[] {
    const [straightAngle, crossingAngle] = this.getCrossingLineAngles();
    return [
      [getDirectionXy(this.pos, straightAngle + 180), getDirectionXy(this.pos, straightAngle)],
      [getDirectionXy(this.pos, crossingAngle + 180), getDirectionXy(this.pos, crossingAngle)],
    ];
  }
  override getNeigbordsXy(): Point[] {
    return this.getNeighborPointPairs().flat();
  }
  private getCrossingLineAngles(): [number, number] {
    const rotation = this.normalizeRotation(this.rotation);
    switch (rotation) {
      case 0:
      case 180:
        return [0, 45];
      case 45:
      case 225:
        return [90, 45];
      case 90:
      case 270:
        return [90, 135];
      case 135:
      case 315:
        return [0, 135];
      default:
        return [rotation, rotation + 45];
    }
  }
  override type: typeof ELEMENT_TYPES.TRACK_CROSSING = ELEMENT_TYPES.TRACK_CROSSING;
  constructor(x: number, y: number) {
    super(x, y);
    this.type = ELEMENT_TYPES.TRACK_CROSSING;
    this.rotationStep = 45;
  }
  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;
    this.beginDraw(ctx, options);
    if (!this.enabled) {
      ctx.globalAlpha = this.alpha;
    }
    ctx.beginPath();
    ctx.strokeStyle = this.TrackPrimaryColor;
    ctx.lineWidth = this.TrackWidth7;
    this.drawCrossingPath(ctx, 0);
    ctx.stroke();
    ctx.lineWidth = this.TrackWidth3;
    const dx = this.width / 5;
    for (const [index, [from, to]] of this.getNeighborPointPairs().entries()) {
      ctx.beginPath();
      ctx.strokeStyle = this.getStateColor(this.routeConnectionIndices.includes(index));
      ctx.moveTo(
        this.centerX + (from.x - this.x) * (this.width / 2 - dx),
        this.centerY + (from.y - this.y) * (this.height / 2 - dx),
      );
      ctx.lineTo(
        this.centerX + (to.x - this.x) * (this.width / 2 - dx),
        this.centerY + (to.y - this.y) * (this.height / 2 - dx),
      );
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
    this.endDraw(ctx);
    this.drawSelection(ctx);
  }
  private drawCrossingPath(ctx: CanvasRenderingContext2D, dx: number): void {
    if (this.rotation == 0 || this.rotation == 180) {
      ctx.moveTo(this.posLeft + dx, this.centerY);
      ctx.lineTo(this.posRight - dx, this.centerY);
      ctx.moveTo(this.posLeft + dx, this.posTop + dx);
      ctx.lineTo(this.posRight - dx, this.posBottom - dx);
    } else if (this.rotation == 45 || this.rotation == 225) {
      ctx.moveTo(this.centerX, this.posTop + dx);
      ctx.lineTo(this.centerX, this.posBottom - dx);
      ctx.moveTo(this.posLeft + dx, this.posTop + dx);
      ctx.lineTo(this.posRight - dx, this.posBottom - dx);
    } else if (this.rotation == 90 || this.rotation == 270) {
      ctx.moveTo(this.centerX, this.posTop + dx);
      ctx.lineTo(this.centerX, this.posBottom - dx);
      ctx.moveTo(this.posRight - dx, this.posTop + dx);
      ctx.lineTo(this.posLeft + dx, this.posBottom - dx);
    } else if (this.rotation == 135 || this.rotation == 315) {
      ctx.moveTo(this.posLeft + dx, this.centerY);
      ctx.lineTo(this.posRight - dx, this.centerY);
      ctx.moveTo(this.posRight - dx, this.posTop + dx);
      ctx.lineTo(this.posLeft + dx, this.posBottom - dx);
    }
  }
  override hitTest(px: number, py: number): boolean {
    return this.x == px && this.y == py;
  }
  override toJSON(): ITrackCrossingElement {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.TRACK_CROSSING,
      address: this.address,
      length: this.length,
    };
  }
  static fromJSON(data: ITrackCrossingElement): TrackCrossingElement {
    const element = new TrackCrossingElement(data.x, data.y);
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
  override clone(): TrackCrossingElement {
    const copy = new TrackCrossingElement(this.x, this.y);
    copy.id = generateId();
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.selected = this.selected;
    copy.address = this.address;
    copy.length = this.length;
    return copy;
  }

  override debug: boolean = true;
}
