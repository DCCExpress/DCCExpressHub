import {
  drawTurnoutElement,
  getTurnoutEditableProperties,
  mouseDownTurnout,
  toggleTurnout,
} from "../core/view/support/TrackTurnoutElementViewSupport";
import {
  beginElementDraw,
  degreesToRadians,
  drawElementBounds,
  drawElementIconPath,
  drawElementMarked,
  drawElementNeighbors,
  drawElementOccupied,
  drawElementSelection,
  endElementDraw,
  getBaseEditableProperties,
  getBaseHelp,
  getCenterX,
  getCenterY,
  getGridSizeX,
  getGridSizeY,
  getHeight,
  getPosBottom,
  getPosLeft,
  getPosRight,
  getPosTop,
  getPositionX,
  getPositionY,
  getWidth,
  noopFromJSON,
  noopMouseHandler,
} from "../core/view/support/BaseElementViewSupport";
import {
  drawTrackSectionInfo,
  getTrackStateColor,
  getTrackTravelDirectionArrow,
} from "../core/view/support/TrackElementViewSupport";
import {
  TrackTurnoutTwoWayElement as CommonTrackTurnoutTwoWayElement,
} from "@domain/layout/elements/TrackTurnoutTwoWayElement";
import {
  ELEMENT_TYPES,
} from "@domain/layout/elementTypes";
import {
  generateId,
} from "../../../helpers";
import type {
  DrawOptions,
  ITrackTurnoutTwoWayElement,
} from "../types/EditorTypes";

export class TrackTurnoutTwoWayElementView
  extends CommonTrackTurnoutTwoWayElement
  implements ITrackTurnoutTwoWayElement {
  turnoutLockedColor: string | CanvasGradient | CanvasPattern = "red";
  turnoutUnLockedColor: string | CanvasGradient | CanvasPattern = "white";

  selected: boolean = false;
  marked: boolean = false;
  enabled: boolean = true;
  alpha: number = 0.5;
  debug: boolean = false;

  type: typeof ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY =
    ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY;

  constructor(x: number, y: number) {
    super(x, y);
  }

  get stateColor(): string {
    return getTrackStateColor(this);
  }

  get GridSizeX(): number {
    return getGridSizeX();
  }

  get GridSizeY(): number {
    return getGridSizeY();
  }

  get PositionX(): number {
    return getPositionX(this);
  }

  get PositionY(): number {
    return getPositionY(this);
  }

  get posLeft(): number {
    return getPosLeft(this);
  }

  get posRight(): number {
    return getPosRight(this);
  }

  get posTop(): number {
    return getPosTop(this);
  }

  get posBottom(): number {
    return getPosBottom(this);
  }

  get centerX(): number {
    return getCenterX(this);
  }

  get centerY(): number {
    return getCenterY(this);
  }

  get width(): number {
    return getWidth(this);
  }

  get height(): number {
    return getHeight(this);
  }

  get TrackWidth7(): number {
    return 7;
  }

  get TrackWidth3(): number {
    return 3;
  }

  get TrackPrimaryColor(): string {
    return "black";
  }

  beginDraw(
    ctx: CanvasRenderingContext2D,
    options?: DrawOptions
  ): void {
    beginElementDraw(this, ctx, options);
  }

  endDraw(ctx: CanvasRenderingContext2D): void {
    endElementDraw(this, ctx);
  }

  drawIconPath(
    ctx: CanvasRenderingContext2D,
    path: string,
    x: number,
    y: number,
    size: number,
    color = "black",
    strokeWidth = 2
  ): void {
    drawElementIconPath(
      ctx,
      path,
      x,
      y,
      size,
      color,
      strokeWidth
    );
  }

  drawMarked(ctx: CanvasRenderingContext2D): void {
    drawElementMarked(this, ctx);
  }

  drawOccupied(ctx: CanvasRenderingContext2D): void {
    drawElementOccupied(this, ctx);
  }

  drawSelection(ctx: CanvasRenderingContext2D): void {
    drawElementSelection(this, ctx);
  }

  drawEnabled(_ctx: CanvasRenderingContext2D): void {
    return;
  }

  mouseDown(ev: MouseEvent): void {
    mouseDownTurnout(this, ev);
  }

  mouseUp(ev: MouseEvent): void {
    noopMouseHandler(ev);
  }

  fromJSON(data: any): void {
    noopFromJSON(data);
  }

  degreesToRadians(degrees: number): number {
    return degreesToRadians(degrees);
  }

  drawBounds(ctx: CanvasRenderingContext2D): void {
    drawElementBounds(this, ctx);
  }

  drawNeighbors(ctx: CanvasRenderingContext2D): void {
    drawElementNeighbors(this, ctx);
  }

  drawSectionInfo(
    ctx: CanvasRenderingContext2D,
    options?: DrawOptions
  ): void {
    drawTrackSectionInfo(this, ctx, options);
  }

  getTravelDirectionArrow(): string {
    return getTrackTravelDirectionArrow(this);
  }

  getEditableProperties() {
    return getTurnoutEditableProperties(
      getBaseEditableProperties()
    );
  }

  getHelp(): string {
    return getBaseHelp();
  }

  toggle(): void {
    toggleTurnout(this);
  }

  draw(
    ctx: CanvasRenderingContext2D,
    options?: DrawOptions
  ): void {
    drawTurnoutElement(this, ctx, options);
  }

  drawTurnout(
    ctx: CanvasRenderingContext2D,
    closed: boolean
  ): void {
    const dx = this.width / 5;

    ctx.beginPath();
    ctx.strokeStyle = this.TrackPrimaryColor;
    ctx.lineWidth = this.TrackWidth7;

    if (this.rotation % 90 === 0) {
      ctx.translate(this.centerX, this.centerY);
      ctx.rotate(this.rotation * Math.PI / 180);
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
      ctx.rotate((this.rotation + 45) * Math.PI / 180);
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
    ctx.fillStyle =
      this.locked
        ? this.turnoutLockedColor
        : this.turnoutUnLockedColor;

    ctx.arc(this.centerX, this.centerY, 3, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }

  toJSON(): ITrackTurnoutTwoWayElement {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY,
      address: this.address,
      length: this.length,
      turnoutAddress: this.turnoutAddress,
      outputMode: this.outputMode,
      turnoutClosedValue: this.turnoutClosedValue,
    };
  }

  static fromJSON(
    data: ITrackTurnoutTwoWayElement
  ): TrackTurnoutTwoWayElementView {
    const element = new TrackTurnoutTwoWayElementView(
      data.x,
      data.y
    );

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

  clone(): TrackTurnoutTwoWayElementView {
    const copy = new TrackTurnoutTwoWayElementView(
      this.x,
      this.y
    );

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

    return copy;
  }
}
