import { getDirectionXy } from "../../helpers.js";
import {
  type IRect,
  Point,
} from "../../Rect.js";
import {
  ELEMENT_TYPES,
  type ElementType,
} from "../elementTypes.js";
import type {
  BaseElementDto,
  LayoutElementId,
  RotationStepDto,
} from "../layoutDto.js";
import {
  INVALID_LAYOUT_ELEMENT_ID,
  MAX_LAYOUT_ELEMENT_ID,
} from "../layoutDto.js";

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

/** Grafikamentes, szerveroldalon is használható layout elem alap. */
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
    this.rotation = this.normalizeRotation(
      this.rotation + this.rotationStep
    );
  }

  rotateLeft(): void {
    if (this.locked) return;
    this.rotation = this.normalizeRotation(
      this.rotation - this.rotationStep
    );
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
}
