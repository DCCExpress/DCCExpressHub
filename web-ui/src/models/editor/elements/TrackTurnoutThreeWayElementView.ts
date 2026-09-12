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
  TrackTurnoutThreeWayElement as CommonTrackTurnoutThreeWayElement,
  type ThreeWayTurnoutPosition,
} from "@domain/layout/elements/TrackTurnoutThreeWayElement";
import {
  ELEMENT_TYPES,
} from "@domain/layout/elementTypes";
import {
  generateId,
} from "../../../helpers";
import type {
  DrawOptions,
  ITrackTurnoutThreeWayElement,
} from "../types/EditorTypes";
import type {
  IEditableProperty,
} from "./PropertyDescriptor";
import {
  OUTPUT_COMMAND_MODE_OPTIONS,
  sendTurnoutOutput,
} from "../../../services/layoutOutput";

function physicalState(
  closedValue: boolean,
  logicalClosed: boolean
): boolean {
  return logicalClosed ? closedValue : !closedValue;
}

export class TrackTurnoutThreeWayElementView
  extends CommonTrackTurnoutThreeWayElement
  implements ITrackTurnoutThreeWayElement {
  selected: boolean = false;
  marked: boolean = false;
  enabled: boolean = true;
  alpha: number = 0.5;
  debug: boolean = false;

  type: typeof ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY =
    ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY;

  turnoutLocked: string | CanvasGradient | CanvasPattern = "red";
  turnoutUnLocked: string | CanvasGradient | CanvasPattern = "white";

  constructor(x: number, y: number) {
    super(x, y);
  }

  get stateColor(): string { return getTrackStateColor(this); }
  get GridSizeX(): number { return getGridSizeX(); }
  get GridSizeY(): number { return getGridSizeY(); }
  get PositionX(): number { return getPositionX(this); }
  get PositionY(): number { return getPositionY(this); }
  get posLeft(): number { return getPosLeft(this); }
  get posRight(): number { return getPosRight(this); }
  get posTop(): number { return getPosTop(this); }
  get posBottom(): number { return getPosBottom(this); }
  get centerX(): number { return getCenterX(this); }
  get centerY(): number { return getCenterY(this); }
  get width(): number { return getWidth(this); }
  get height(): number { return getHeight(this); }
  get TrackWidth7(): number { return 7; }
  get TrackWidth3(): number { return 3; }
  get TrackPrimaryColor(): string { return "black"; }

  beginDraw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    beginElementDraw(this, ctx, options);
  }

  endDraw(ctx: CanvasRenderingContext2D): void { endElementDraw(this, ctx); }

  drawIconPath(
    ctx: CanvasRenderingContext2D,
    path: string,
    x: number,
    y: number,
    size: number,
    color = "black",
    strokeWidth = 2
  ): void {
    drawElementIconPath(ctx, path, x, y, size, color, strokeWidth);
  }

  drawMarked(ctx: CanvasRenderingContext2D): void { drawElementMarked(this, ctx); }
  drawOccupied(ctx: CanvasRenderingContext2D): void { drawElementOccupied(this, ctx); }
  drawSelection(ctx: CanvasRenderingContext2D): void { drawElementSelection(this, ctx); }
  drawEnabled(_ctx: CanvasRenderingContext2D): void { return; }
  mouseUp(ev: MouseEvent): void { noopMouseHandler(ev); }
  fromJSON(data: any): void { noopFromJSON(data); }
  degreesToRadians(degrees: number): number { return degreesToRadians(degrees); }
  drawBounds(ctx: CanvasRenderingContext2D): void { drawElementBounds(this, ctx); }
  drawNeighbors(ctx: CanvasRenderingContext2D): void { drawElementNeighbors(this, ctx); }

  drawSectionInfo(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    drawTrackSectionInfo(this, ctx, options);
  }

  getTravelDirectionArrow(): string { return getTrackTravelDirectionArrow(this); }

  getEditableProperties(): IEditableProperty[] {
    return [
      ...getBaseEditableProperties(),
      {
        label: "Output type",
        key: "outputMode",
        type: "select",
        readonly: false,
        options: OUTPUT_COMMAND_MODE_OPTIONS,
      },
      {
        label: "Left motor address / VPIN",
        key: "turnout1Address",
        type: "number",
        readonly: false,
        validate: () => true,
      },
      {
        label: "Right motor address / VPIN",
        key: "turnout2Address",
        type: "number",
        readonly: false,
        validate: () => true,
      },
      {
        label: "Three-way turnout positions",
        key: "turnout1ClosedValue",
        type: "bittoggle",
        readonly: false,
        validate: () => true,
      },
      {
        label: "Right motor closed value",
        key: "turnout2ClosedValue",
        type: "bittoggle",
        readonly: false,
        validate: () => true,
      },
    ];
  }

  getHelp(): string { return getBaseHelp(); }

  setPositionAndSend(
    position: Exclude<ThreeWayTurnoutPosition, "invalid">
  ): void {
    if (this.locked || !this.enabled) return;

    const bits =
      this.getBitsForPosition(
        position
      );

    this.turnout1Closed =
      bits.first;

    this.turnout2Closed =
      bits.second;

    sendTurnoutOutput(
      String(this.outputMode),
      this.turnout1Address,
      bits.first,
      {
        closedValue:
          this.turnout1ClosedValue,
      }
    );

    sendTurnoutOutput(
      String(this.outputMode),
      this.turnout2Address,
      bits.second,
      {
        closedValue:
          this.turnout2ClosedValue,
      }
    );
  }

  mouseDown(_ev: MouseEvent): void {
    const next: Exclude<ThreeWayTurnoutPosition, "invalid"> =
      this.position === "left"
        ? "straight"
        : this.position === "straight"
          ? "right"
          : "left";

    this.setPositionAndSend(next);
  }

  draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;

    this.beginDraw(ctx, options);
    this.drawTurnout(ctx, this.position);
    this.endDraw(ctx);

    this.beginDraw(ctx);
    if (options?.showTurnoutAddress) {
      this.drawAddressLabels(ctx);
    }
    this.drawSectionInfo(ctx, options);
    this.endDraw(ctx);

    this.drawSelection(ctx);
  }

  drawTurnout(
    ctx: CanvasRenderingContext2D,
    position: ThreeWayTurnoutPosition
  ): void {
    const dx = this.width / 5;

    ctx.translate(this.centerX, this.centerY);
    ctx.rotate(this.rotation * Math.PI / 180);
    ctx.translate(-this.centerX, -this.centerY);

    ctx.beginPath();
    ctx.strokeStyle = this.TrackPrimaryColor;
    ctx.lineWidth = this.TrackWidth7;

    ctx.moveTo(this.posLeft, this.centerY);
    ctx.lineTo(this.centerX, this.centerY);
    ctx.lineTo(this.posRight, this.posTop);
    ctx.moveTo(this.centerX, this.centerY);
    ctx.lineTo(this.posRight, this.centerY);
    ctx.moveTo(this.centerX, this.centerY);
    ctx.lineTo(this.posRight, this.posBottom);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = this.stateColor;
    ctx.lineWidth = this.TrackWidth3;
    ctx.moveTo(this.posLeft + dx, this.centerY);
    ctx.lineTo(this.centerX, this.centerY);

    if (position === "left") {
      ctx.lineTo(this.posRight - dx, this.posTop + dx);
    } else if (position === "right") {
      ctx.lineTo(this.posRight - dx, this.posBottom - dx);
    } else if (position === "straight") {
      ctx.lineTo(this.posRight - dx, this.centerY);
    }

    ctx.stroke();

    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "black";
    ctx.fillStyle = this.locked ? this.turnoutLocked : this.turnoutUnLocked;
    ctx.arc(this.centerX, this.centerY, 3, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }

  private drawAddressLabels(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = "black";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`#${this.turnout1Address}`, this.posLeft + this.width * 0.28, this.posBottom - 7);
    ctx.fillText(`#${this.turnout2Address}`, this.posLeft + this.width * 0.72, this.posBottom - 7);
    ctx.restore();
  }

  toJSON(): ITrackTurnoutThreeWayElement {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY,
      outputMode: this.outputMode,
      turnout1Address: this.turnout1Address,
      turnout2Address: this.turnout2Address,
      turnout1ClosedValue: this.turnout1ClosedValue,
      turnout2ClosedValue: this.turnout2ClosedValue,
      leftMotor1Value: this.leftMotor1Value,
      leftMotor2Value: this.leftMotor2Value,
      straightMotor1Value: this.straightMotor1Value,
      straightMotor2Value: this.straightMotor2Value,
      rightMotor1Value: this.rightMotor1Value,
      rightMotor2Value: this.rightMotor2Value,
    };
  }

  static fromJSON(
    data: ITrackTurnoutThreeWayElement
  ): TrackTurnoutThreeWayElementView {
    const element = new TrackTurnoutThreeWayElementView(data.x, data.y);

    element.id = data.id;
    element.name = data.name;
    element.layerName = data.layerName;
    element.rotation = data.rotation;
    element.rotationStep = data.rotationStep;
    element.address = data.address;
    element.length = data.length;
    element.bg = data.bg;
    element.fg = data.fg;
    element.outputMode = data.outputMode === "vpin" ? "vpin" : "accessory";
    element.turnout1Address = data.turnout1Address ?? 0;
    element.turnout2Address = data.turnout2Address ?? 0;
    element.turnout1ClosedValue = data.turnout1ClosedValue ?? true;
    element.turnout2ClosedValue = data.turnout2ClosedValue ?? true;

    const legacyFirstClosed = element.turnout1ClosedValue;
    const legacyFirstOpened = !element.turnout1ClosedValue;
    const legacySecondClosed = element.turnout2ClosedValue;
    const legacySecondOpened = !element.turnout2ClosedValue;

    element.leftMotor1Value =
      data.leftMotor1Value ?? legacyFirstClosed;
    element.leftMotor2Value =
      data.leftMotor2Value ?? legacySecondOpened;
    element.straightMotor1Value =
      data.straightMotor1Value ?? legacyFirstOpened;
    element.straightMotor2Value =
      data.straightMotor2Value ?? legacySecondOpened;
    element.rightMotor1Value =
      data.rightMotor1Value ?? legacyFirstOpened;
    element.rightMotor2Value =
      data.rightMotor2Value ?? legacySecondClosed;

    return element;
  }

  clone(): TrackTurnoutThreeWayElementView {
    const copy = new TrackTurnoutThreeWayElementView(this.x, this.y);

    copy.id = generateId();
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.selected = this.selected;
    copy.address = this.address;
    copy.length = this.length;
    copy.outputMode = this.outputMode;
    copy.turnout1Address = this.turnout1Address;
    copy.turnout2Address = this.turnout2Address;
    copy.turnout1ClosedValue = this.turnout1ClosedValue;
    copy.turnout2ClosedValue = this.turnout2ClosedValue;
    copy.leftMotor1Value = this.leftMotor1Value;
    copy.leftMotor2Value = this.leftMotor2Value;
    copy.straightMotor1Value = this.straightMotor1Value;
    copy.straightMotor2Value = this.straightMotor2Value;
    copy.rightMotor1Value = this.rightMotor1Value;
    copy.rightMotor2Value = this.rightMotor2Value;
    copy.turnout1Closed = this.turnout1Closed;
    copy.turnout2Closed = this.turnout2Closed;

    return copy;
  }
}
