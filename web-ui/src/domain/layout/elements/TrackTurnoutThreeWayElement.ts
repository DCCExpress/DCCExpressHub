import {
  getDirectionXy,
} from "../../helpers.js";
import {
  Point,
} from "../../Rect.js";
import {
  ELEMENT_TYPES,
} from "../elementTypes.js";
import type {
  OutputCommandModeDto,
  RotationStepDto,
  TrackTurnoutThreeWayElementDto,
} from "../layoutDto.js";
import type {
  NeighborPointPair,
} from "../model/BaseElement.js";
import {
  TrackElement,
} from "../model/TrackElement.js";

export type ThreeWayTurnoutPosition =
  | "left"
  | "straight"
  | "right"
  | "invalid";

export type ThreeWayTurnoutSide =
  | "entry"
  | "left"
  | "straight"
  | "right";

export type ThreeWayTurnoutConnections = Record<
  ThreeWayTurnoutSide,
  Point
>;

export type ThreeWayTurnoutRoute = {
  from: ThreeWayTurnoutSide;
  to: ThreeWayTurnoutSide;
  turnoutStates: [
    { address: number; closed: boolean },
    { address: number; closed: boolean },
  ];
};

function physicalState(
  closedValue: boolean,
  logicalClosed: boolean
): boolean {
  return logicalClosed
    ? closedValue
    : !closedValue;
}

export class TrackTurnoutThreeWayElement extends TrackElement {
  override type: typeof ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY =
    ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY;

  name: string = ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY;
  rotationStep: RotationStepDto = 45;

  outputMode: OutputCommandModeDto = "accessory";
  turnout1Address: number = 0;
  turnout2Address: number = 0;
  turnout1ClosedValue: boolean = true;
  turnout2ClosedValue: boolean = true;

  /** Physical runtime feedback values for the two turnout motors. */
  turnout1Closed: boolean = false;
  turnout2Closed: boolean = false;

  constructor(x: number, y: number) {
    super(x, y);
  }

  get firstLogicalClosed(): boolean {
    return this.turnout1Closed === this.turnout1ClosedValue;
  }

  get secondLogicalClosed(): boolean {
    return this.turnout2Closed === this.turnout2ClosedValue;
  }

  get position(): ThreeWayTurnoutPosition {
    if (this.firstLogicalClosed && !this.secondLogicalClosed) {
      return "left";
    }

    if (!this.firstLogicalClosed && !this.secondLogicalClosed) {
      return "straight";
    }

    if (!this.firstLogicalClosed && this.secondLogicalClosed) {
      return "right";
    }

    return "invalid";
  }

  setLogicalPosition(position: Exclude<ThreeWayTurnoutPosition, "invalid">): void {
    const firstLogicalClosed = position === "left";
    const secondLogicalClosed = position === "right";

    this.turnout1Closed = physicalState(
      this.turnout1ClosedValue,
      firstLogicalClosed
    );

    this.turnout2Closed = physicalState(
      this.turnout2ClosedValue,
      secondLogicalClosed
    );
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
    const c = this.getConnections();
    void c;

    const statesFor = (
      firstLogicalClosed: boolean,
      secondLogicalClosed: boolean
    ): ThreeWayTurnoutRoute["turnoutStates"] => [
      {
        address: this.turnout1Address,
        closed: physicalState(
          this.turnout1ClosedValue,
          firstLogicalClosed
        ),
      },
      {
        address: this.turnout2Address,
        closed: physicalState(
          this.turnout2ClosedValue,
          secondLogicalClosed
        ),
      },
    ];

    return [
      {
        from: "entry",
        to: "left",
        turnoutStates: statesFor(true, false),
      },
      {
        from: "entry",
        to: "straight",
        turnoutStates: statesFor(false, false),
      },
      {
        from: "entry",
        to: "right",
        turnoutStates: statesFor(false, true),
      },
    ];
  }

  getSideConnectedToPoint(
    point: Point
  ): ThreeWayTurnoutSide | undefined {
    for (const [side, connection] of Object.entries(this.getConnections())) {
      if (connection.isEqual(point)) {
        return side as ThreeWayTurnoutSide;
      }
    }

    return undefined;
  }

  getOppositeRoutesFromSide(
    side: ThreeWayTurnoutSide
  ): ThreeWayTurnoutRoute[] {
    return this.getAllowedRoutes().filter(
      route => route.from === side || route.to === side
    );
  }

  getRouteExitSide(
    route: ThreeWayTurnoutRoute,
    enteredSide: ThreeWayTurnoutSide
  ): ThreeWayTurnoutSide | undefined {
    if (route.from === enteredSide) return route.to;
    if (route.to === enteredSide) return route.from;
    return undefined;
  }

  static fromJSON(
    data: TrackTurnoutThreeWayElementDto
  ): TrackTurnoutThreeWayElement {
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

    return element;
  }

  override toJSON(): TrackTurnoutThreeWayElementDto {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY,
      outputMode: this.outputMode,
      turnout1Address: this.turnout1Address,
      turnout2Address: this.turnout2Address,
      turnout1ClosedValue: this.turnout1ClosedValue,
      turnout2ClosedValue: this.turnout2ClosedValue,
    };
  }
}
