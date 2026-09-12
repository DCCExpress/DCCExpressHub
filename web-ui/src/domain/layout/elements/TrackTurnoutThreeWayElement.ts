import "../threeWayTurnoutDtoAugmentation.js";
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

export type ThreeWayTurnoutConnections =
  Record<
    ThreeWayTurnoutSide,
    Point
  >;

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

export class TrackTurnoutThreeWayElement
  extends TrackElement {
  override type:
    typeof ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY =
      ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY;

  name: string =
    ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY;

  rotationStep:
    RotationStepDto = 45;

  outputMode:
    OutputCommandModeDto =
      "accessory";

  turnout1Address:
    number = 0;

  turnout2Address:
    number = 0;

  /**
   * Legacy motor polarity fields.
   *
   * They are retained for old layouts and signal-logic channel semantics.
   * New three-way position output uses the explicit per-position bit pairs
   * below instead of deriving all three positions from these two values.
   */
  turnout1ClosedValue:
    boolean = true;

  turnout2ClosedValue:
    boolean = true;

  /**
   * Physical output bits for each of the three logical W positions.
   *
   * These are intentionally independent. Any of the four possible
   * two-bit combinations can be assigned to any logical position.
   */
  leftMotor1Value:
    boolean = true;

  leftMotor2Value:
    boolean = false;

  straightMotor1Value:
    boolean = false;

  straightMotor2Value:
    boolean = false;

  rightMotor1Value:
    boolean = false;

  rightMotor2Value:
    boolean = true;

  /** Physical runtime feedback values for the two turnout motors. */
  turnout1Closed:
    boolean = false;

  turnout2Closed:
    boolean = false;

  constructor(
    x: number,
    y: number
  ) {
    super(x, y);
  }

  getBitsForPosition(
    position:
      Exclude<
        ThreeWayTurnoutPosition,
        "invalid"
      >
  ): ThreeWayStateBits {
    switch (position) {
      case "left":
        return {
          first:
            this.leftMotor1Value,
          second:
            this.leftMotor2Value,
        };

      case "right":
        return {
          first:
            this.rightMotor1Value,
          second:
            this.rightMotor2Value,
        };

      case "straight":
      default:
        return {
          first:
            this.straightMotor1Value,
          second:
            this.straightMotor2Value,
        };
    }
  }

  get position():
    ThreeWayTurnoutPosition {
    const positions:
      Array<
        Exclude<
          ThreeWayTurnoutPosition,
          "invalid"
        >
      > = [
        "left",
        "straight",
        "right",
      ];

    for (
      const candidate
      of positions
    ) {
      const bits =
        this.getBitsForPosition(
          candidate
        );

      if (
        this.turnout1Closed ===
          bits.first &&
        this.turnout2Closed ===
          bits.second
      ) {
        return candidate;
      }
    }

    return "invalid";
  }

  setLogicalPosition(
    position:
      Exclude<
        ThreeWayTurnoutPosition,
        "invalid"
      >
  ): void {
    const bits =
      this.getBitsForPosition(
        position
      );

    this.turnout1Closed =
      bits.first;

    this.turnout2Closed =
      bits.second;
  }

  getConnections():
    ThreeWayTurnoutConnections {
    return {
      entry:
        getDirectionXy(
          this.pos,
          -this.rotation + 180
        ),
      left:
        getDirectionXy(
          this.pos,
          -this.rotation - 45
        ),
      straight:
        getDirectionXy(
          this.pos,
          -this.rotation
        ),
      right:
        getDirectionXy(
          this.pos,
          -this.rotation + 45
        ),
    };
  }

  override getNextItemXy():
    Point {
    const connections =
      this.getConnections();

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

  override getPrevItemXy():
    Point {
    return (
      this.getConnections()
        .entry
    );
  }

  override getNeighborPointPairs():
    NeighborPointPair[] {
    const c =
      this.getConnections();

    return [
      [c.entry, c.left],
      [c.entry, c.straight],
      [c.entry, c.right],
    ];
  }

  override getNeigbordsXy():
    Point[] {
    const c =
      this.getConnections();

    return [
      c.entry,
      c.left,
      c.straight,
      c.right,
    ];
  }

  getAllowedRoutes():
    ThreeWayTurnoutRoute[] {
    const statesFor = (
      position:
        Exclude<
          ThreeWayTurnoutPosition,
          "invalid"
        >
    ): ThreeWayTurnoutRoute[
      "turnoutStates"
    ] => {
      const bits =
        this.getBitsForPosition(
          position
        );

      return [
        {
          address:
            this.turnout1Address,
          closed:
            bits.first,
        },
        {
          address:
            this.turnout2Address,
          closed:
            bits.second,
        },
      ];
    };

    return [
      {
        from: "entry",
        to: "left",
        turnoutStates:
          statesFor("left"),
      },
      {
        from: "entry",
        to: "straight",
        turnoutStates:
          statesFor(
            "straight"
          ),
      },
      {
        from: "entry",
        to: "right",
        turnoutStates:
          statesFor("right"),
      },
    ];
  }

  getSideConnectedToPoint(
    point: Point
  ):
    | ThreeWayTurnoutSide
    | undefined {
    for (
      const [
        side,
        connection,
      ] of Object.entries(
        this.getConnections()
      )
    ) {
      if (
        connection.isEqual(
          point
        )
      ) {
        return (
          side as
            ThreeWayTurnoutSide
        );
      }
    }

    return undefined;
  }

  getOppositeRoutesFromSide(
    side:
      ThreeWayTurnoutSide
  ):
    ThreeWayTurnoutRoute[] {
    return (
      this.getAllowedRoutes()
        .filter(
          route =>
            route.from === side ||
            route.to === side
        )
    );
  }

  getRouteExitSide(
    route:
      ThreeWayTurnoutRoute,
    enteredSide:
      ThreeWayTurnoutSide
  ):
    | ThreeWayTurnoutSide
    | undefined {
    if (
      route.from ===
      enteredSide
    ) {
      return route.to;
    }

    if (
      route.to ===
      enteredSide
    ) {
      return route.from;
    }

    return undefined;
  }

  static fromJSON(
    data:
      TrackTurnoutThreeWayElementDto
  ):
    TrackTurnoutThreeWayElement {
    const element =
      new TrackTurnoutThreeWayElement(
        data.x,
        data.y
      );

    element.id =
      data.id;
    element.name =
      data.name;
    element.layerName =
      data.layerName;
    element.rotation =
      data.rotation;
    element.rotationStep =
      data.rotationStep;
    element.address =
      data.address;
    element.length =
      data.length;
    element.bg =
      data.bg;
    element.fg =
      data.fg;

    element.outputMode =
      data.outputMode ===
        "vpin"
        ? "vpin"
        : "accessory";

    element.turnout1Address =
      data.turnout1Address ??
      0;

    element.turnout2Address =
      data.turnout2Address ??
      0;

    element.turnout1ClosedValue =
      data.turnout1ClosedValue ??
      true;

    element.turnout2ClosedValue =
      data.turnout2ClosedValue ??
      true;

    /**
     * Backward-compatible defaults reproduce the old logical mapping:
     * left     = C/O
     * straight = O/O
     * right    = O/C
     *
     * but converted to the actual physical bits implied by the old
     * per-motor closed values.
     */
    const legacyFirstClosed =
      element.turnout1ClosedValue;
    const legacyFirstOpened =
      !element.turnout1ClosedValue;
    const legacySecondClosed =
      element.turnout2ClosedValue;
    const legacySecondOpened =
      !element.turnout2ClosedValue;

    element.leftMotor1Value =
      data.leftMotor1Value ??
      legacyFirstClosed;

    element.leftMotor2Value =
      data.leftMotor2Value ??
      legacySecondOpened;

    element.straightMotor1Value =
      data.straightMotor1Value ??
      legacyFirstOpened;

    element.straightMotor2Value =
      data.straightMotor2Value ??
      legacySecondOpened;

    element.rightMotor1Value =
      data.rightMotor1Value ??
      legacyFirstOpened;

    element.rightMotor2Value =
      data.rightMotor2Value ??
      legacySecondClosed;

    return element;
  }

  override toJSON():
    TrackTurnoutThreeWayElementDto {
    return {
      ...super.toJSON(),
      type:
        ELEMENT_TYPES
          .TRACK_TURNOUT_THREE_WAY,
      outputMode:
        this.outputMode,
      turnout1Address:
        this.turnout1Address,
      turnout2Address:
        this.turnout2Address,
      turnout1ClosedValue:
        this.turnout1ClosedValue,
      turnout2ClosedValue:
        this.turnout2ClosedValue,
      leftMotor1Value:
        this.leftMotor1Value,
      leftMotor2Value:
        this.leftMotor2Value,
      straightMotor1Value:
        this.straightMotor1Value,
      straightMotor2Value:
        this.straightMotor2Value,
      rightMotor1Value:
        this.rightMotor1Value,
      rightMotor2Value:
        this.rightMotor2Value,
    };
  }
}
