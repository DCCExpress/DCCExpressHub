import { getDirectionXy } from "../../../domain/helpers";
import "../../../domain/layout/doubleTurnoutDtoAugmentation";
import { ELEMENT_TYPES } from "../../../domain/layout/elementTypes";
import type { TurnoutOutputModeDto } from "../../../domain/layout/layoutDto";
import { Point } from "../../../domain/Rect";
import { generateId } from "../../../helpers";
import { TURNOUT_OUTPUT_MODE_OPTIONS } from "../../../services/layoutOutput";
import type { NeighborPointPair } from "../core/BaseElement";
import {
  normalizeTurnoutAspect,
  normalizeTurnoutOutputMode,
} from "../turnout/turnoutAccessoryHelpers";
import type { ITrackTurnoutDoubleElement } from "../types/EditorTypes";
import type { IEditableProperty } from "./PropertyDescriptor";
import { TrackMultiMotorTurnoutElement } from "./TrackMultiMotorTurnoutElement";
export type DoubleTurnoutSide = "aStraight" | "aDiv" | "bStraight" | "bDiv";
export type DoubleTurnoutConnections = Record<DoubleTurnoutSide, Point>;
export type DoubleTurnoutRoute = {
  from: DoubleTurnoutSide;
  to: DoubleTurnoutSide;
  turnoutStates: [
    {
      address: number;
      closed: boolean;
    },
    {
      address: number;
      closed: boolean;
    },
  ];
};
type DoubleStateBits = {
  first: boolean;
  second: boolean;
};
type CanvasPoint = {
  x: number;
  y: number;
};
export default class TrackTurnoutDoubleElement extends TrackMultiMotorTurnoutElement {
  override name: string = ELEMENT_TYPES.TRACK_TURNOUT_DOUBLE;
  outputMode: TurnoutOutputModeDto = "accessory";
  /**
   * Explicit physical two-bit output table for all four displayed positions.
   * Every row is fully independent.
   */
  ooMotor1Value: boolean = false;
  ooMotor2Value: boolean = false;
  ocMotor1Value: boolean = false;
  ocMotor2Value: boolean = true;
  coMotor1Value: boolean = true;
  coMotor2Value: boolean = false;
  ccMotor1Value: boolean = true;
  ccMotor2Value: boolean = true;
  get turnoutAddress(): number {
    return this.turnout1Address;
  }
  set turnoutAddress(value: number) {
    this.turnout1Address = value;
  }
  get turnoutClosedValue(): boolean {
    return this.turnout1ClosedValue;
  }
  set turnoutClosedValue(value: boolean) {
    this.turnout1ClosedValue = value;
  }
  get turnoutClosed(): boolean {
    return this.turnout1Closed;
  }
  set turnoutClosed(value: boolean) {
    this.turnout1Closed = value;
  }
  private getConfiguredLogicalState(): {
    firstClosed: boolean;
    secondClosed: boolean;
  } | null {
    const first = this.turnout1Closed;
    const second = this.turnout2Closed;
    if (first === this.ooMotor1Value && second === this.ooMotor2Value) {
      return {
        firstClosed: false,
        secondClosed: false,
      };
    }
    if (first === this.ocMotor1Value && second === this.ocMotor2Value) {
      return {
        firstClosed: false,
        secondClosed: true,
      };
    }
    if (first === this.coMotor1Value && second === this.coMotor2Value) {
      return {
        firstClosed: true,
        secondClosed: false,
      };
    }
    if (first === this.ccMotor1Value && second === this.ccMotor2Value) {
      return {
        firstClosed: true,
        secondClosed: true,
      };
    }
    return null;
  }
  get firstLogicalClosed(): boolean {
    const configured = this.getConfiguredLogicalState();
    if (configured) {
      return configured.firstClosed;
    }
    // Backward-compatible fallback for a runtime bit pair
    // that does not match any configured Double position.
    return this.turnout1Closed === this.turnout1ClosedValue;
  }
  get secondLogicalClosed(): boolean {
    const configured = this.getConfiguredLogicalState();
    if (configured) {
      return configured.secondClosed;
    }
    // Backward-compatible fallback for a runtime bit pair
    // that does not match any configured Double position.
    return this.turnout2Closed === this.turnout2ClosedValue;
  }
  getBitsForRoute(from: DoubleTurnoutSide, to: DoubleTurnoutSide): DoubleStateBits {
    const pair = `${from}->${to}`;
    const reverse = `${to}->${from}`;
    if (pair === "aStraight->bDiv" || reverse === "aStraight->bDiv") {
      return {
        first: this.ocMotor1Value,
        second: this.ocMotor2Value,
      };
    }
    if (pair === "aDiv->bStraight" || reverse === "aDiv->bStraight") {
      return {
        first: this.coMotor1Value,
        second: this.coMotor2Value,
      };
    }
    if (pair === "aDiv->bDiv" || reverse === "aDiv->bDiv") {
      return {
        first: this.ccMotor1Value,
        second: this.ccMotor2Value,
      };
    }
    return {
      first: this.ooMotor1Value,
      second: this.ooMotor2Value,
    };
  }
  getConnections(): DoubleTurnoutConnections {
    return {
      aStraight: getDirectionXy(this.pos, this.rotation + 180),
      aDiv: getDirectionXy(this.pos, this.rotation + 225),
      bStraight: getDirectionXy(this.pos, this.rotation),
      bDiv: getDirectionXy(this.pos, this.rotation + 45),
    };
  }
  override getNeighborPointPairs(): NeighborPointPair[] {
    const c = this.getConnections();
    return [
      [c.aStraight, c.bStraight],
      [c.aDiv, c.bDiv],
    ];
  }
  override getNeigbordsXy(): Point[] {
    const c = this.getConnections();
    return [c.aStraight, c.aDiv, c.bStraight, c.bDiv];
  }
  getAllowedRoutes(): DoubleTurnoutRoute[] {
    const route = (from: DoubleTurnoutSide, to: DoubleTurnoutSide): DoubleTurnoutRoute => {
      const bits = this.getBitsForRoute(from, to);
      return {
        from,
        to,
        turnoutStates: [
          {
            address: this.turnout1Address,
            closed: bits.first,
          },
          {
            address: this.turnout2Address,
            closed: bits.second,
          },
        ],
      };
    };
    return [
      route("aStraight", "bStraight"),
      route("aStraight", "bDiv"),
      route("aDiv", "bStraight"),
      route("aDiv", "bDiv"),
    ];
  }
  getSideConnectedToPoint(point: Point): DoubleTurnoutSide | undefined {
    const c = this.getConnections();
    for (const [side, connectionPoint] of Object.entries(c)) {
      if (connectionPoint.isEqual(point)) {
        return side as DoubleTurnoutSide;
      }
    }
    return undefined;
  }
  getOppositeRoutesFromSide(side: DoubleTurnoutSide): DoubleTurnoutRoute[] {
    return this.getAllowedRoutes().filter((route) => route.from === side || route.to === side);
  }
  getRouteExitSide(
    route: DoubleTurnoutRoute,
    enteredSide: DoubleTurnoutSide,
  ): DoubleTurnoutSide | undefined {
    if (route.from === enteredSide) {
      return route.to;
    }
    if (route.to === enteredSide) {
      return route.from;
    }
    return undefined;
  }
  override type: typeof ELEMENT_TYPES.TRACK_TURNOUT_DOUBLE = ELEMENT_TYPES.TRACK_TURNOUT_DOUBLE;
  constructor(x: number, y: number) {
    super(x, y);
  }
  override getEditableProperties(): IEditableProperty[] {
    return [
      ...super.getEditableProperties(),
      {
        label: "Output type",
        key: "outputMode",
        type: "select",
        readonly: false,
        options: TURNOUT_OUTPUT_MODE_OPTIONS,
      },
      {
        label: "Turnout 1 accessory address",
        key: "turnout1Address",
        type: "number",
        readonly: false,
        min: 1,
        max: 2048,
        validate: () => true,
      },
      {
        label: "Turnout 2 accessory address",
        key: "turnout2Address",
        type: "number",
        readonly: false,
        min: 1,
        max: 2048,
        validate: () => true,
      },
      {
        label: "Double Turnout Positions",
        key: "turnout1ClosedValue",
        type: "bittoggle",
        readonly: false,
        validate: () => true,
      },
      {
        label: "Turnout 2 Closed Value",
        key: "turnout2ClosedValue",
        type: "bittoggle",
        readonly: false,
        validate: () => true,
      },
    ];
  }
  protected override drawTrack(ctx: CanvasRenderingContext2D): void {
    this.drawTurnout(ctx, this.firstLogicalClosed, this.secondLogicalClosed);
  }
  drawTurnout(ctx: CanvasRenderingContext2D, firstClosed: boolean, secondClosed: boolean): void {
    ctx.beginPath();
    ctx.strokeStyle = this.TrackPrimaryColor;
    ctx.lineWidth = this.TrackWidth7;
    this.drawBaseTrack(ctx);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = this.stateColor;
    ctx.lineWidth = this.TrackWidth3;
    const firstTarget = this.getFirstArmTarget(firstClosed);
    ctx.moveTo(this.centerX, this.centerY);
    ctx.lineTo(firstTarget.x, firstTarget.y);
    ctx.stroke();
    ctx.beginPath();
    const secondTarget = this.getSecondArmTarget(secondClosed);
    ctx.moveTo(this.centerX, this.centerY);
    ctx.lineTo(secondTarget.x, secondTarget.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "black";
    ctx.fillStyle = this.locked ? this.turnoutLocked : this.turnoutUnLocked;
    ctx.arc(this.centerX, this.centerY, 3, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
  private drawBaseTrack(ctx: CanvasRenderingContext2D): void {
    if (this.rotation == 0 || this.rotation == 180) {
      ctx.moveTo(this.posLeft, this.centerY);
      ctx.lineTo(this.posRight, this.centerY);
      ctx.moveTo(this.posLeft, this.posTop);
      ctx.lineTo(this.posRight, this.posBottom);
    } else if (this.rotation == 45 || this.rotation == 225) {
      ctx.moveTo(this.centerX, this.posTop);
      ctx.lineTo(this.centerX, this.posBottom);
      ctx.moveTo(this.posLeft, this.posTop);
      ctx.lineTo(this.posRight, this.posBottom);
    } else if (this.rotation == 90 || this.rotation == 270) {
      ctx.moveTo(this.centerX, this.posTop);
      ctx.lineTo(this.centerX, this.posBottom);
      ctx.moveTo(this.posRight, this.posTop);
      ctx.lineTo(this.posLeft, this.posBottom);
    } else if (this.rotation == 135 || this.rotation == 315) {
      ctx.moveTo(this.posLeft, this.centerY);
      ctx.lineTo(this.posRight, this.centerY);
      ctx.moveTo(this.posRight, this.posTop);
      ctx.lineTo(this.posLeft, this.posBottom);
    }
  }
  private getFirstArmTarget(closed: boolean): CanvasPoint {
    const dx = this.width / 5;
    switch (this.rotation) {
      case 0:
        return closed
          ? { x: this.posLeft + dx, y: this.posTop + dx }
          : { x: this.posLeft + dx, y: this.centerY };
      case 45:
        return closed
          ? { x: this.centerX, y: this.posTop + dx }
          : { x: this.posLeft + dx, y: this.posTop + dx };
      case 90:
        return closed
          ? { x: this.posRight - dx, y: this.posTop + dx }
          : { x: this.centerX, y: this.posTop + dx };
      case 135:
        return closed
          ? { x: this.posRight - dx, y: this.centerY }
          : { x: this.posRight - dx, y: this.posTop + dx };
      case 180:
        return closed
          ? { x: this.posRight - dx, y: this.posBottom - dx }
          : { x: this.posRight - dx, y: this.centerY };
      case 225:
        return closed
          ? { x: this.centerX, y: this.posBottom - dx }
          : { x: this.posRight - dx, y: this.posBottom - dx };
      case 270:
        return closed
          ? { x: this.posLeft + dx, y: this.posBottom - dx }
          : { x: this.centerX, y: this.posBottom - dx };
      case 315:
        return closed
          ? { x: this.posLeft + dx, y: this.centerY }
          : { x: this.posLeft + dx, y: this.posBottom - dx };
      default:
        return { x: this.centerX, y: this.centerY };
    }
  }
  private getSecondArmTarget(closed: boolean): CanvasPoint {
    const dx = this.width / 5;
    switch (this.rotation) {
      case 0:
        return closed
          ? { x: this.posRight - dx, y: this.posBottom - dx }
          : { x: this.posRight - dx, y: this.centerY };
      case 45:
        return closed
          ? { x: this.centerX, y: this.posBottom - dx }
          : { x: this.posRight - dx, y: this.posBottom - dx };
      case 90:
        return closed
          ? { x: this.posLeft + dx, y: this.posBottom - dx }
          : { x: this.centerX, y: this.posBottom - dx };
      case 135:
        return closed
          ? { x: this.posLeft + dx, y: this.centerY }
          : { x: this.posLeft + dx, y: this.posBottom - dx };
      case 180:
        return closed
          ? { x: this.posLeft + dx, y: this.posTop + dx }
          : { x: this.posLeft + dx, y: this.centerY };
      case 225:
        return closed
          ? { x: this.centerX, y: this.posTop + dx }
          : { x: this.posLeft + dx, y: this.posTop + dx };
      case 270:
        return closed
          ? { x: this.posRight - dx, y: this.posTop + dx }
          : { x: this.centerX, y: this.posTop + dx };
      case 315:
        return closed
          ? { x: this.posRight - dx, y: this.centerY }
          : { x: this.posRight - dx, y: this.posTop + dx };
      default:
        return { x: this.centerX, y: this.centerY };
    }
  }
  protected override drawAddressLabels(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = "black";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`#${this.turnout1Address}`, this.posLeft + this.width * 0.25, this.posBottom - 8);
    ctx.fillText(`#${this.turnout2Address}`, this.posLeft + this.width * 0.75, this.posBottom - 8);
    ctx.restore();
  }
  /*
   * IMPORTANT:
   * The domain class already serializes all Double-position bit pairs.
   * Do not rebuild the DTO here and accidentally drop the augmented fields.
   */
  override toJSON(): ITrackTurnoutDoubleElement {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.TRACK_TURNOUT_DOUBLE,
      turnout1Address: this.turnout1Address,
      turnout2Address: this.turnout2Address,
      outputMode: normalizeTurnoutOutputMode(this.outputMode),
      turnout1ClosedAspect: normalizeTurnoutAspect(this.turnout1ClosedAspect, 0),
      turnout1OpenedAspect: normalizeTurnoutAspect(this.turnout1OpenedAspect, 1),
      turnout2ClosedAspect: normalizeTurnoutAspect(this.turnout2ClosedAspect, 0),
      turnout2OpenedAspect: normalizeTurnoutAspect(this.turnout2OpenedAspect, 1),
      turnout1ClosedValue: this.turnout1ClosedValue,
      turnout2ClosedValue: this.turnout2ClosedValue,
      ooMotor1Value: this.ooMotor1Value,
      ooMotor2Value: this.ooMotor2Value,
      ocMotor1Value: this.ocMotor1Value,
      ocMotor2Value: this.ocMotor2Value,
      coMotor1Value: this.coMotor1Value,
      coMotor2Value: this.coMotor2Value,
      ccMotor1Value: this.ccMotor1Value,
      ccMotor2Value: this.ccMotor2Value,
    };
  }
  static fromJSON(data: ITrackTurnoutDoubleElement): TrackTurnoutDoubleElement {
    const element = new TrackTurnoutDoubleElement(data.x, data.y);
    element.id = data.id;
    element.name = data.name;
    element.layerName = data.layerName;
    element.rotation = data.rotation;
    element.rotationStep = data.rotationStep;
    element.address = data.address;
    element.length = data.length;
    element.bg = data.bg;
    element.fg = data.fg;
    element.turnout1Address = data.turnout1Address;
    element.outputMode = data.outputMode === "vpin" ? "vpin" : "accessory";
    element.turnout2Address = data.turnout2Address;
    element.turnout1ClosedValue = data.turnout1ClosedValue ?? element.turnout1ClosedValue;
    element.turnout2ClosedValue = data.turnout2ClosedValue ?? element.turnout2ClosedValue;
    /*
     * Preserve the complete explicit Double-position table.
     * Legacy files without these fields keep the same fallback mapping as earlier layout files.
     */
    const firstClosed = element.turnout1ClosedValue;
    const firstOpened = !element.turnout1ClosedValue;
    const secondClosed = element.turnout2ClosedValue;
    const secondOpened = !element.turnout2ClosedValue;
    element.ooMotor1Value = data.ooMotor1Value ?? firstOpened;
    element.ooMotor2Value = data.ooMotor2Value ?? secondOpened;
    element.ocMotor1Value = data.ocMotor1Value ?? firstOpened;
    element.ocMotor2Value = data.ocMotor2Value ?? secondClosed;
    element.coMotor1Value = data.coMotor1Value ?? firstClosed;
    element.coMotor2Value = data.coMotor2Value ?? secondOpened;
    element.ccMotor1Value = data.ccMotor1Value ?? firstClosed;
    element.ccMotor2Value = data.ccMotor2Value ?? secondClosed;
    element.readTurnoutConfiguration(data);
    return element;
  }
  override clone(): TrackTurnoutDoubleElement {
    const copy = new TrackTurnoutDoubleElement(this.x, this.y);
    copy.id = generateId();
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.selected = this.selected;
    copy.address = this.address;
    copy.length = this.length;
    copy.turnout1Address = this.turnout1Address;
    copy.outputMode = this.outputMode;
    copy.turnout2Address = this.turnout2Address;
    copy.turnout1ClosedValue = this.turnout1ClosedValue;
    copy.turnout2ClosedValue = this.turnout2ClosedValue;
    copy.ooMotor1Value = this.ooMotor1Value;
    copy.ooMotor2Value = this.ooMotor2Value;
    copy.ocMotor1Value = this.ocMotor1Value;
    copy.ocMotor2Value = this.ocMotor2Value;
    copy.coMotor1Value = this.coMotor1Value;
    copy.coMotor2Value = this.coMotor2Value;
    copy.ccMotor1Value = this.ccMotor1Value;
    copy.ccMotor2Value = this.ccMotor2Value;
    copy.turnout1Closed = this.turnout1Closed;
    copy.turnout2Closed = this.turnout2Closed;
    copy.readTurnoutConfiguration(this);
    return copy;
  }

  turnout1ClosedAspect = 0;
  turnout1OpenedAspect = 1;
  turnout2ClosedAspect = 0;
  turnout2OpenedAspect = 1;

  private readTurnoutConfiguration(data: {
    outputMode?: TurnoutOutputModeDto;
    turnout1ClosedAspect?: number;
    turnout1OpenedAspect?: number;
    turnout2ClosedAspect?: number;
    turnout2OpenedAspect?: number;
  }): void {
    this.outputMode = normalizeTurnoutOutputMode(data.outputMode);
    this.turnout1ClosedAspect = normalizeTurnoutAspect(data.turnout1ClosedAspect, 0);
    this.turnout1OpenedAspect = normalizeTurnoutAspect(data.turnout1OpenedAspect, 1);
    this.turnout2ClosedAspect = normalizeTurnoutAspect(data.turnout2ClosedAspect, 0);
    this.turnout2OpenedAspect = normalizeTurnoutAspect(data.turnout2OpenedAspect, 1);
  }
}
