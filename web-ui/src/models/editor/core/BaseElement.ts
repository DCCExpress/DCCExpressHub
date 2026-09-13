import { getDirectionXy } from "../../../domain/helpers";
import { ELEMENT_TYPES, type ElementType } from "../../../domain/layout/elementTypes";
import type {
  BaseElementDto,
  LayoutElementId,
  RotationStepDto,
} from "../../../domain/layout/layoutDto";
import { INVALID_LAYOUT_ELEMENT_ID, MAX_LAYOUT_ELEMENT_ID } from "../../../domain/layout/layoutDto";
import { type IRect, Point } from "../../../domain/Rect";
import type { IEditableProperty } from "../elements/PropertyDescriptor";
import { sampleLayout } from "../sample/sampleLayout";
import type { DrawOptions } from "../types/EditorTypes";

export type NeighborPointPair = [Point, Point];

function normalizeAssignedId(value: number | string): LayoutElementId {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_LAYOUT_ELEMENT_ID
  ) {
    return value;
  }

  // Old clone() implementations still assign generateId() strings. Those are
  // deliberately treated as "unassigned" so Layout.addElement() can issue the
  // next stable uint16 ID. Legacy persisted UUIDs are migrated before fromJSON.
  return INVALID_LAYOUT_ELEMENT_ID;
}
/** Common canvas element: geometry, persistence and overridable editor behavior. */
export abstract class BaseElement {
  private _id: LayoutElementId = INVALID_LAYOUT_ELEMENT_ID;

  get id(): LayoutElementId {
    return this._id;
  }

  set id(value: LayoutElementId | string) {
    this._id = normalizeAssignedId(value);
  }

  type: ElementType = ELEMENT_TYPES.GENERAL;

  name: string = "element";

  layerName: string = "track";

  x: number;

  y: number;

  w: number = 1;

  h: number = 1;

  rotation: number = 0;

  rotationStep: RotationStepDto = 0;

  locked: boolean = false;

  visible: boolean = true;

  bg: string = "black";

  fg: string = "white";

  occupied: boolean = false;

  isVisited: boolean = false;

  trackName: string = "";

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  rotateRight(): void {
    if (this.locked) return;
    this.rotation = this.normalizeRotation(this.rotation + this.rotationStep);
  }

  rotateLeft(): void {
    if (this.locked) return;
    this.rotation = this.normalizeRotation(this.rotation - this.rotationStep);
  }

  setRotation(rotation: number): void {
    if (this.locked) return;
    this.rotation = this.normalizeRotation(rotation);
  }

  moveBy(dx: number, dy: number): void {
    if (this.locked) return;
    this.x += dx;
    this.y += dy;
  }

  setPosition(x: number, y: number): void {
    if (this.locked) return;
    this.x = x;
    this.y = y;
  }

  public normalizeRotation(value: number): number {
    let result = value % 360;
    if (result < 0) result += 360;
    return result;
  }

  toJSON(): BaseElementDto {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      layerName: this.layerName,
      x: this.x,
      y: this.y,
      w: this.w,
      h: this.h,
      rotation: this.rotation,
      rotationStep: this.rotationStep,
      bg: this.bg,
      fg: this.fg,
    };
  }

  getBounds(): IRect {
    return { x: this.x, y: this.y, width: this.w, height: this.h };
  }

  getCollisionBounds(): IRect {
    return this.getBounds();
  }

  hitTest(px: number, py: number): boolean {
    const bounds = this.getBounds();
    const x2 = bounds.x + bounds.width;
    const y2 = bounds.y + bounds.height;
    return px >= bounds.x && py >= bounds.y && px < x2 && py < y2;
  }

  get pos(): Point {
    return new Point(this.x, this.y);
  }

  getNextItemXy(): Point {
    return getDirectionXy(this.pos, this.rotation);
  }

  getPrevItemXy(): Point {
    return getDirectionXy(this.pos, this.rotation + 180);
  }

  getNeighborPointPairs(): NeighborPointPair[] {
    return [[this.getPrevItemXy(), this.getNextItemXy()]];
  }

  getNeigbordsXy(): Point[] {
    return this.getNeighborPointPairs().flat();
  }

  selected: boolean = false;

  marked: boolean = false;

  enabled: boolean = true;

  alpha: number = 0.5;

  debug: boolean = false;

  get GridSizeX(): number {
    return sampleLayout.settings.gridSize;
  }

  get GridSizeY(): number {
    return sampleLayout.settings.gridSize;
  }

  get PositionX(): number {
    return this.x * this.GridSizeX;
  }

  get PositionY(): number {
    return this.y * this.GridSizeY;
  }

  get posLeft(): number {
    return this.x * this.GridSizeX;
  }

  get posRight(): number {
    return this.x * this.GridSizeX + this.w * this.GridSizeX;
  }

  get posTop(): number {
    return this.y * this.GridSizeY;
  }

  get posBottom(): number {
    return this.y * this.GridSizeY + this.h * this.GridSizeY;
  }

  get centerX(): number {
    return this.x * this.GridSizeX + (this.w * this.GridSizeX) / 2;
  }

  get centerY(): number {
    return this.y * this.GridSizeY + (this.h * this.GridSizeY) / 2;
  }

  get width(): number {
    return this.posRight - this.posLeft;
  }

  get height(): number {
    return this.posBottom - this.posTop;
  }

  beginDraw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    const scale = options?.scale ?? 1;
    const offsetX = options?.offsetX ?? 0;
    const offsetY = options?.offsetY ?? 0;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    if (options?.ghost) {
      ctx.globalAlpha = 0.5;
    }
  }

  endDraw(ctx: CanvasRenderingContext2D): void {
    ctx.restore();

    if (this.debug) {
      this.drawNeighbors(ctx);
    }
  }

  drawIconPath(
    ctx: CanvasRenderingContext2D,
    path: string,
    x: number,
    y: number,
    size: number,
    color = "black",
    strokeWidth = 2,
  ): void {
    ctx.save();

    const scale = size / 24;

    ctx.translate(x, y);
    ctx.scale(scale, scale);

    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const iconPath = new Path2D(path);
    ctx.stroke(iconPath);

    ctx.restore();
  }

  drawMarked(ctx: CanvasRenderingContext2D): void {
    if (!this.marked) {
      return;
    }

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#f6b83b";
    ctx.fillStyle = "#f6b83b33";
    ctx.strokeRect(this.posLeft, this.posTop, this.width, this.height);
    ctx.fillRect(this.posLeft, this.posTop, this.width, this.height);
    ctx.restore();
  }

  drawOccupied(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = "#403b82f6";
    ctx.fillRect(this.posLeft, this.posTop, this.width, this.height);
    ctx.restore();
  }

  drawSelection(ctx: CanvasRenderingContext2D): void {
    this.drawEnabled(ctx);

    if (!this.selected) {
      return;
    }

    this.beginDraw(ctx);

    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "red";
    ctx.strokeRect(this.posLeft, this.posTop, this.width, this.height);

    this.endDraw(ctx);
  }

  drawEnabled(_ctx: CanvasRenderingContext2D): void {
    return;
  }

  mouseDown(ev: MouseEvent): void {
    // Default: no-op.
  }

  mouseUp(ev: MouseEvent): void {
    // Default: no-op.
  }
  abstract draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void;

  degreesToRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  drawBounds(ctx: CanvasRenderingContext2D): void {
    const bounds = this.getBounds();

    ctx.strokeStyle = "lime";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 2]);
    ctx.strokeRect(
      bounds.x * this.GridSizeX,
      bounds.y * this.GridSizeX,
      bounds.width * this.GridSizeX,
      bounds.height * this.GridSizeX,
    );

    ctx.strokeStyle = "blue";
    ctx.strokeRect(
      bounds.x * this.GridSizeX,
      bounds.y * this.GridSizeY,
      this.GridSizeX,
      this.GridSizeY,
    );
  }

  drawNeighbors(ctx: CanvasRenderingContext2D): void {
    ctx.save();

    const neighbors = this.getNeigbordsXy();

    ctx.fillStyle = "blue";

    neighbors.forEach((point) => {
      ctx.beginPath();
      ctx.arc(
        point.x * this.GridSizeX + this.GridSizeX / 2,
        point.y * this.GridSizeY + this.GridSizeY / 2,
        5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    });

    ctx.restore();
  }

  getEditableProperties(): IEditableProperty[] {
    return [
      {
        label: "Name",
        key: "name",
        type: "string",
        readonly: false,
      },
    ];
  }

  getHelp(): string {
    return `
    <h3 style="margin-top:0;">Base element</h3>
      `;
  }

  abstract clone(): BaseElement;
}
