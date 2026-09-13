import { getDirectionXy } from "../../../domain/helpers";
import { ELEMENT_TYPES } from "../../../domain/layout/elementTypes";
import type { OutputCommandModeDto } from "../../../domain/layout/layoutDto";
import "../../../domain/layout/threeWayTurnoutDtoAugmentation";
import { Point } from "../../../domain/Rect";
import { generateId } from "../../../helpers";
import { OUTPUT_COMMAND_MODE_OPTIONS, sendTurnoutOutput } from "../../../services/layoutOutput";
import type { NeighborPointPair } from "../core/BaseElement";
import type { ITrackTurnoutThreeWayElement } from "../types/EditorTypes";
import type { IEditableProperty } from "./PropertyDescriptor";
import { TrackMultiMotorTurnoutElement } from "./TrackMultiMotorTurnoutElement";
export type ThreeWayTurnoutPosition = "left" | "straight" | "right" | "invalid";
export type ThreeWayTurnoutSide = "entry" | "left" | "straight" | "right";
export type ThreeWayTurnoutConnections = Record<ThreeWayTurnoutSide, Point>;
export type ThreeWayTurnoutRoute = {
  from: ThreeWayTurnoutSide;
  to: ThreeWayTurnoutSide;
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
type ThreeWayStateBits = {
  first: boolean;
  second: boolean;
};
function physicalState(closedValue: boolean, logicalClosed: boolean): boolean {
  return logicalClosed ? closedValue : !closedValue;
}
export class TrackTurnoutThreeWayElement extends TrackMultiMotorTurnoutElement {
  override name: string = ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY;
  outputMode: OutputCommandModeDto = "accessory";
  /**
   * Physical output bits for each of the three logical W positions.
   *
   * These are intentionally independent. Any of the four possible
   * two-bit combinations can be assigned to any logical position.
   */
  leftMotor1Value: boolean = true;
  leftMotor2Value: boolean = false;
  straightMotor1Value: boolean = false;
  straightMotor2Value: boolean = false;
  rightMotor1Value: boolean = false;
  rightMotor2Value: boolean = true;
  getBitsForPosition(position: Exclude<ThreeWayTurnoutPosition, "invalid">): ThreeWayStateBits {
    switch (position) {
      case "left":
        return {
          first: this.leftMotor1Value,
          second: this.leftMotor2Value,
        };
      case "right":
        return {
          first: this.rightMotor1Value,
          second: this.rightMotor2Value,
        };
      case "straight":
      default:
        return {
          first: this.straightMotor1Value,
          second: this.straightMotor2Value,
        };
    }
  }
  get position(): ThreeWayTurnoutPosition {
    const positions: Array<Exclude<ThreeWayTurnoutPosition, "invalid">> = [
      "left",
      "straight",
      "right",
    ];
    for (const candidate of positions) {
      const bits = this.getBitsForPosition(candidate);
      if (this.turnout1Closed === bits.first && this.turnout2Closed === bits.second) {
        return candidate;
      }
    }
    return "invalid";
  }
  setLogicalPosition(position: Exclude<ThreeWayTurnoutPosition, "invalid">): void {
    const bits = this.getBitsForPosition(position);
    this.turnout1Closed = bits.first;
    this.turnout2Closed = bits.second;
  }
  getConnections(): ThreeWayTurnoutConnections {
    return {
      entry: getDirectionXy(this.pos, -this.rotation + 180),
      left: getDirectionXy(this.pos, -this.rotation - 45),
      straight: getDirectionXy(this.pos, -this.rotation),
      right: getDirectionXy(this.pos, -this.rotation + 45),
    };
  }
  override getNextItemXy(): Point {
    const connections = this.getConnections();
    switch (this.position) {
      case "left":
        return connections.left;
      case "right":
        return connections.right;
      case "straight":
      case "invalid":
      default:
        return connections.straight;
    }
  }
  override getPrevItemXy(): Point {
    return this.getConnections().entry;
  }
  override getNeighborPointPairs(): NeighborPointPair[] {
    const c = this.getConnections();
    return [
      [c.entry, c.left],
      [c.entry, c.straight],
      [c.entry, c.right],
    ];
  }
  override getNeigbordsXy(): Point[] {
    const c = this.getConnections();
    return [c.entry, c.left, c.straight, c.right];
  }
  getAllowedRoutes(): ThreeWayTurnoutRoute[] {
    const statesFor = (
      position: Exclude<ThreeWayTurnoutPosition, "invalid">,
    ): ThreeWayTurnoutRoute["turnoutStates"] => {
      const bits = this.getBitsForPosition(position);
      return [
        {
          address: this.turnout1Address,
          closed: bits.first,
        },
        {
          address: this.turnout2Address,
          closed: bits.second,
        },
      ];
    };
    return [
      {
        from: "entry",
        to: "left",
        turnoutStates: statesFor("left"),
      },
      {
        from: "entry",
        to: "straight",
        turnoutStates: statesFor("straight"),
      },
      {
        from: "entry",
        to: "right",
        turnoutStates: statesFor("right"),
      },
    ];
  }
  getSideConnectedToPoint(point: Point): ThreeWayTurnoutSide | undefined {
    for (const [side, connection] of Object.entries(this.getConnections())) {
      if (connection.isEqual(point)) {
        return side as ThreeWayTurnoutSide;
      }
    }
    return undefined;
  }
  getOppositeRoutesFromSide(side: ThreeWayTurnoutSide): ThreeWayTurnoutRoute[] {
    return this.getAllowedRoutes().filter((route) => route.from === side || route.to === side);
  }
  getRouteExitSide(
    route: ThreeWayTurnoutRoute,
    enteredSide: ThreeWayTurnoutSide,
  ): ThreeWayTurnoutSide | undefined {
    if (route.from === enteredSide) {
      return route.to;
    }
    if (route.to === enteredSide) {
      return route.from;
    }
    return undefined;
  }
  override type: typeof ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY =
    ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY;
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
  setPositionAndSend(position: Exclude<ThreeWayTurnoutPosition, "invalid">): void {
    if (this.locked || !this.enabled) return;
    const bits = this.getBitsForPosition(position);
    this.turnout1Closed = bits.first;
    this.turnout2Closed = bits.second;
    sendTurnoutOutput(String(this.outputMode), this.turnout1Address, bits.first, {
      closedValue: this.turnout1ClosedValue,
    });
    sendTurnoutOutput(String(this.outputMode), this.turnout2Address, bits.second, {
      closedValue: this.turnout2ClosedValue,
    });
  }
  override mouseDown(_ev: MouseEvent): void {
    const next: Exclude<ThreeWayTurnoutPosition, "invalid"> =
      this.position === "left" ? "straight" : this.position === "straight" ? "right" : "left";
    this.setPositionAndSend(next);
  }
  protected override drawTrack(ctx: CanvasRenderingContext2D): void {
    this.drawTurnout(ctx, this.position);
  }
  drawTurnout(ctx: CanvasRenderingContext2D, position: ThreeWayTurnoutPosition): void {
    const dx = this.width / 5;
    ctx.translate(this.centerX, this.centerY);
    ctx.rotate((this.rotation * Math.PI) / 180);
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
  protected override drawAddressLabels(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = "black";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`#${this.turnout1Address}`, this.posLeft + this.width * 0.28, this.posBottom - 7);
    ctx.fillText(`#${this.turnout2Address}`, this.posLeft + this.width * 0.72, this.posBottom - 7);
    ctx.restore();
  }
  override toJSON(): ITrackTurnoutThreeWayElement {
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
  static fromJSON(data: ITrackTurnoutThreeWayElement): TrackTurnoutThreeWayElement {
    const element = new TrackTurnoutThreeWayElement(data.x, data.y);
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
    element.leftMotor1Value = data.leftMotor1Value ?? legacyFirstClosed;
    element.leftMotor2Value = data.leftMotor2Value ?? legacySecondOpened;
    element.straightMotor1Value = data.straightMotor1Value ?? legacyFirstOpened;
    element.straightMotor2Value = data.straightMotor2Value ?? legacySecondOpened;
    element.rightMotor1Value = data.rightMotor1Value ?? legacyFirstOpened;
    element.rightMotor2Value = data.rightMotor2Value ?? legacySecondClosed;
    return element;
  }
  override clone(): TrackTurnoutThreeWayElement {
    const copy = new TrackTurnoutThreeWayElement(this.x, this.y);
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

  override get TrackWidth7(): number {
    return 7;
  }

  override get TrackWidth3(): number {
    return 3;
  }

  override get TrackPrimaryColor(): string {
    return "black";
  }
}
