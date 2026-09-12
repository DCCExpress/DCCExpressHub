import "../doubleTurnoutDtoAugmentation.js";

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
  TrackTurnoutDoubleElementDto,
  RotationStepDto,
} from "../layoutDto.js";
import type {
  NeighborPointPair,
} from "../model/BaseElement.js";
import {
  TrackElement,
} from "../model/TrackElement.js";

export type DoubleTurnoutSide =
  | "aStraight"
  | "aDiv"
  | "bStraight"
  | "bDiv";

export type DoubleTurnoutConnections =
  Record<DoubleTurnoutSide, Point>;

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

export default class TrackTurnoutDoubleElement
  extends TrackElement {
  override type:
    typeof ELEMENT_TYPES.TRACK_TURNOUT_DOUBLE =
      ELEMENT_TYPES.TRACK_TURNOUT_DOUBLE;

  name: string =
    ELEMENT_TYPES.TRACK_TURNOUT_DOUBLE;

  rotationStep:
    RotationStepDto = 45;

  turnout1Address:
    number = 0;

  outputMode:
    OutputCommandModeDto =
      "accessory";

  turnout2Address:
    number = 0;

  turnout1ClosedValue:
    boolean = true;

  turnout2ClosedValue:
    boolean = true;

  /**
   * Explicit physical two-bit output table for all four displayed positions.
   * Every row is fully independent.
   */
  ooMotor1Value:
    boolean = false;
  ooMotor2Value:
    boolean = false;

  ocMotor1Value:
    boolean = false;
  ocMotor2Value:
    boolean = true;

  coMotor1Value:
    boolean = true;
  coMotor2Value:
    boolean = false;

  ccMotor1Value:
    boolean = true;
  ccMotor2Value:
    boolean = true;

  /** Runtime physical feedback values. */
  turnout1Closed:
    boolean = false;

  turnout2Closed:
    boolean = false;

  get turnoutAddress():
    number {
    return this.turnout1Address;
  }

  set turnoutAddress(
    value: number
  ) {
    this.turnout1Address =
      value;
  }

  get turnoutClosedValue():
    boolean {
    return (
      this.turnout1ClosedValue
    );
  }

  set turnoutClosedValue(
    value: boolean
  ) {
    this.turnout1ClosedValue =
      value;
  }

  get turnoutClosed():
    boolean {
    return this.turnout1Closed;
  }

  set turnoutClosed(
    value: boolean
  ) {
    this.turnout1Closed =
      value;
  }

  get firstLogicalClosed():
    boolean {
    return (
      this.turnout1Closed ===
      this.turnout1ClosedValue
    );
  }

  get secondLogicalClosed():
    boolean {
    return (
      this.turnout2Closed ===
      this.turnout2ClosedValue
    );
  }

  constructor(
    x: number,
    y: number
  ) {
    super(x, y);
  }

  getBitsForRoute(
    from: DoubleTurnoutSide,
    to: DoubleTurnoutSide
  ): DoubleStateBits {
    const pair =
      `${from}->${to}`;

    const reverse =
      `${to}->${from}`;

    if (
      pair ===
        "aStraight->bDiv" ||
      reverse ===
        "aStraight->bDiv"
    ) {
      return {
        first:
          this.ocMotor1Value,
        second:
          this.ocMotor2Value,
      };
    }

    if (
      pair ===
        "aDiv->bStraight" ||
      reverse ===
        "aDiv->bStraight"
    ) {
      return {
        first:
          this.coMotor1Value,
        second:
          this.coMotor2Value,
      };
    }

    if (
      pair ===
        "aDiv->bDiv" ||
      reverse ===
        "aDiv->bDiv"
    ) {
      return {
        first:
          this.ccMotor1Value,
        second:
          this.ccMotor2Value,
      };
    }

    return {
      first:
        this.ooMotor1Value,
      second:
        this.ooMotor2Value,
    };
  }

  getConnections():
    DoubleTurnoutConnections {
    return {
      aStraight:
        getDirectionXy(
          this.pos,
          this.rotation + 180
        ),
      aDiv:
        getDirectionXy(
          this.pos,
          this.rotation + 225
        ),
      bStraight:
        getDirectionXy(
          this.pos,
          this.rotation
        ),
      bDiv:
        getDirectionXy(
          this.pos,
          this.rotation + 45
        ),
    };
  }

  override getNeighborPointPairs():
    NeighborPointPair[] {
    const c =
      this.getConnections();

    return [
      [
        c.aStraight,
        c.bStraight,
      ],
      [
        c.aDiv,
        c.bDiv,
      ],
    ];
  }

  override getNeigbordsXy():
    Point[] {
    const c =
      this.getConnections();

    return [
      c.aStraight,
      c.aDiv,
      c.bStraight,
      c.bDiv,
    ];
  }

  getAllowedRoutes():
    DoubleTurnoutRoute[] {
    const route = (
      from:
        DoubleTurnoutSide,
      to:
        DoubleTurnoutSide
    ): DoubleTurnoutRoute => {
      const bits =
        this.getBitsForRoute(
          from,
          to
        );

      return {
        from,
        to,
        turnoutStates: [
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
        ],
      };
    };

    return [
      route(
        "aStraight",
        "bStraight"
      ),
      route(
        "aStraight",
        "bDiv"
      ),
      route(
        "aDiv",
        "bStraight"
      ),
      route(
        "aDiv",
        "bDiv"
      ),
    ];
  }

  getSideConnectedToPoint(
    point: Point
  ):
    | DoubleTurnoutSide
    | undefined {
    const c =
      this.getConnections();

    for (
      const [
        side,
        connectionPoint,
      ] of Object.entries(c)
    ) {
      if (
        connectionPoint.isEqual(
          point
        )
      ) {
        return (
          side as
            DoubleTurnoutSide
        );
      }
    }

    return undefined;
  }

  getOppositeRoutesFromSide(
    side:
      DoubleTurnoutSide
  ):
    DoubleTurnoutRoute[] {
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
      DoubleTurnoutRoute,
    enteredSide:
      DoubleTurnoutSide
  ):
    | DoubleTurnoutSide
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
      TrackTurnoutDoubleElementDto
  ):
    TrackTurnoutDoubleElement {
    const element =
      new TrackTurnoutDoubleElement(
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

    element.turnout1Address =
      data.turnout1Address;
    element.turnout2Address =
      data.turnout2Address;

    element.outputMode =
      data.outputMode ===
        "vpin"
        ? "vpin"
        : "accessory";

    element.turnout1ClosedValue =
      data.turnout1ClosedValue ??
      element.turnout1ClosedValue;

    element.turnout2ClosedValue =
      data.turnout2ClosedValue ??
      element.turnout2ClosedValue;

    const firstClosed =
      element.turnout1ClosedValue;
    const firstOpened =
      !element.turnout1ClosedValue;
    const secondClosed =
      element.turnout2ClosedValue;
    const secondOpened =
      !element.turnout2ClosedValue;

    element.ooMotor1Value =
      data.ooMotor1Value ??
      firstOpened;
    element.ooMotor2Value =
      data.ooMotor2Value ??
      secondOpened;

    element.ocMotor1Value =
      data.ocMotor1Value ??
      firstOpened;
    element.ocMotor2Value =
      data.ocMotor2Value ??
      secondClosed;

    element.coMotor1Value =
      data.coMotor1Value ??
      firstClosed;
    element.coMotor2Value =
      data.coMotor2Value ??
      secondOpened;

    element.ccMotor1Value =
      data.ccMotor1Value ??
      firstClosed;
    element.ccMotor2Value =
      data.ccMotor2Value ??
      secondClosed;

    return element;
  }

  override toJSON():
    TrackTurnoutDoubleElementDto {
    return {
      ...super.toJSON(),
      type:
        ELEMENT_TYPES
          .TRACK_TURNOUT_DOUBLE,
      turnout1Address:
        this.turnout1Address,
      turnout2Address:
        this.turnout2Address,
      outputMode:
        this.outputMode,
      turnout1ClosedValue:
        this.turnout1ClosedValue,
      turnout2ClosedValue:
        this.turnout2ClosedValue,
      ooMotor1Value:
        this.ooMotor1Value,
      ooMotor2Value:
        this.ooMotor2Value,
      ocMotor1Value:
        this.ocMotor1Value,
      ocMotor2Value:
        this.ocMotor2Value,
      coMotor1Value:
        this.coMotor1Value,
      coMotor2Value:
        this.coMotor2Value,
      ccMotor1Value:
        this.ccMotor1Value,
      ccMotor2Value:
        this.ccMotor2Value,
    };
  }
}
