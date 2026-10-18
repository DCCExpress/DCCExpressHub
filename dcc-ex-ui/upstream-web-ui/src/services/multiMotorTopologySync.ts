import type {
  RailwayTopologyLayout,
} from "@domain/railway/topology";

import type {
  LayoutView,
} from "@/models/editor/core/LayoutView";

import TrackTurnoutDoubleElement from "@/models/editor/elements/TrackTurnoutDoubleElement";
import {
  TrackTurnoutThreeWayElement,
} from "@/models/editor/elements/TrackTurnoutThreeWayElement";

function bitKey(
  first: boolean,
  second: boolean
): string {
  return `${first ? 1 : 0}${second ? 1 : 0}`;
}

function requireTwoDistinctAddresses(
  label: string,
  first: number,
  second: number
): void {
  if (
    !Number.isInteger(first) ||
    first <= 0 ||
    !Number.isInteger(second) ||
    second <= 0
  ) {
    throw new Error(
      `${label}: mindkét motorcímnek 1-nél nagyobb, érvényes címnek kell lennie.`
    );
  }

  if (first === second) {
    throw new Error(
      `${label}: a két motor címe nem lehet azonos (${first}).`
    );
  }
}

function validateDouble(
  turnout: TrackTurnoutDoubleElement
): void {
  const label =
    `Double turnout #${turnout.id}`;

  requireTwoDistinctAddresses(
    label,
    turnout.turnout1Address,
    turnout.turnout2Address
  );

  const states = [
    bitKey(
      turnout.ooMotor1Value,
      turnout.ooMotor2Value
    ),
    bitKey(
      turnout.ocMotor1Value,
      turnout.ocMotor2Value
    ),
    bitKey(
      turnout.coMotor1Value,
      turnout.coMotor2Value
    ),
    bitKey(
      turnout.ccMotor1Value,
      turnout.ccMotor2Value
    ),
  ];

  if (
    new Set(states).size !==
    states.length
  ) {
    throw new Error(
      `${label}: a négy állás motor-bit kombinációi nem egyértelműek (${states.join(", ")}).`
    );
  }
}

function validateThreeWay(
  turnout: TrackTurnoutThreeWayElement
): void {
  const label =
    `3-way turnout #${turnout.id}`;

  requireTwoDistinctAddresses(
    label,
    turnout.turnout1Address,
    turnout.turnout2Address
  );

  const states = [
    bitKey(
      turnout.leftMotor1Value,
      turnout.leftMotor2Value
    ),
    bitKey(
      turnout.straightMotor1Value,
      turnout.straightMotor2Value
    ),
    bitKey(
      turnout.rightMotor1Value,
      turnout.rightMotor2Value
    ),
  ];

  if (
    new Set(states).size !==
    states.length
  ) {
    throw new Error(
      `${label}: a LEFT / STRAIGHT / RIGHT motor-bit kombinációk nem egyértelműek (${states.join(", ")}).`
    );
  }
}

/**
 * buildRailwayTopologyFromLayout() creates lightweight topology clones.
 *
 * The current Hub topology factory copies the two motor addresses and
 * ClosedValue fields, but does NOT copy the explicit multi-motor position
 * tables:
 *
 * Double:
 *   OO / OC / CO / CC motor bit pairs
 *
 * 3-way:
 *   LEFT / STRAIGHT / RIGHT motor bit pairs
 *
 * RouteGraphBuilder calls getAllowedRoutes() on those topology clones, so
 * without this synchronization it silently uses class defaults and can build
 * completely wrong route requirements.
 *
 * Copy the authoritative configuration from the real LayoutView elements
 * before graph generation.
 */
export function synchronizeMultiMotorTurnoutTopology(
  layout: LayoutView,
  topology: RailwayTopologyLayout
): void {
  const liveById =
    new Map(
      layout
        .getAllElements()
        .map(element => [
          element.id,
          element,
        ] as const)
    );

  for (const topologyTurnout of topology.getTurnouts()) {
    const live =
      liveById.get(
        topologyTurnout.id
      );

    if (
      topologyTurnout instanceof TrackTurnoutDoubleElement
    ) {
      if (
        !(live instanceof TrackTurnoutDoubleElement)
      ) {
        throw new Error(
          `Double turnout #${topologyTurnout.id}: topology/layout type mismatch.`
        );
      }

      topologyTurnout.turnout1Address =
        live.turnout1Address;
      topologyTurnout.turnout2Address =
        live.turnout2Address;
      topologyTurnout.turnout1ClosedValue =
        live.turnout1ClosedValue;
      topologyTurnout.turnout2ClosedValue =
        live.turnout2ClosedValue;
      topologyTurnout.outputMode =
        live.outputMode;

      topologyTurnout.ooMotor1Value =
        live.ooMotor1Value;
      topologyTurnout.ooMotor2Value =
        live.ooMotor2Value;
      topologyTurnout.ocMotor1Value =
        live.ocMotor1Value;
      topologyTurnout.ocMotor2Value =
        live.ocMotor2Value;
      topologyTurnout.coMotor1Value =
        live.coMotor1Value;
      topologyTurnout.coMotor2Value =
        live.coMotor2Value;
      topologyTurnout.ccMotor1Value =
        live.ccMotor1Value;
      topologyTurnout.ccMotor2Value =
        live.ccMotor2Value;

      topologyTurnout.turnout1ClosedAspect =
        live.turnout1ClosedAspect;
      topologyTurnout.turnout1OpenedAspect =
        live.turnout1OpenedAspect;
      topologyTurnout.turnout2ClosedAspect =
        live.turnout2ClosedAspect;
      topologyTurnout.turnout2OpenedAspect =
        live.turnout2OpenedAspect;

      validateDouble(
        topologyTurnout
      );

      continue;
    }

    if (
      topologyTurnout instanceof TrackTurnoutThreeWayElement
    ) {
      if (
        !(live instanceof TrackTurnoutThreeWayElement)
      ) {
        throw new Error(
          `3-way turnout #${topologyTurnout.id}: topology/layout type mismatch.`
        );
      }

      topologyTurnout.turnout1Address =
        live.turnout1Address;
      topologyTurnout.turnout2Address =
        live.turnout2Address;
      topologyTurnout.turnout1ClosedValue =
        live.turnout1ClosedValue;
      topologyTurnout.turnout2ClosedValue =
        live.turnout2ClosedValue;
      topologyTurnout.outputMode =
        live.outputMode;

      topologyTurnout.leftMotor1Value =
        live.leftMotor1Value;
      topologyTurnout.leftMotor2Value =
        live.leftMotor2Value;
      topologyTurnout.straightMotor1Value =
        live.straightMotor1Value;
      topologyTurnout.straightMotor2Value =
        live.straightMotor2Value;
      topologyTurnout.rightMotor1Value =
        live.rightMotor1Value;
      topologyTurnout.rightMotor2Value =
        live.rightMotor2Value;

      validateThreeWay(
        topologyTurnout
      );
    }
  }
}
