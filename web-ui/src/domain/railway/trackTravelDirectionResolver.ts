import {
  RailwayTopologyLayout,
  TopologyDirectionElement,
  type TopologyTrackElement,
  isTopologyTurnoutElement,
  type TravelDirection,
} from "./topology";

import TrackTurnoutDoubleElement from "../../models/editor/elements/TrackTurnoutDoubleElement";
import { TrackTurnoutThreeWayElement } from "../../models/editor/elements/TrackTurnoutThreeWayElement";

type SingleTurnoutSide = "entry" | "straight" | "div";
type ThreeWaySide = "entry" | "left" | "straight" | "right";
type LinearSide = "next" | "prev";
type ConnectionSide = SingleTurnoutSide | ThreeWaySide | LinearSide;
type FlowSide = "forward" | "backward";

type ConnectionPoint = {
  side: ConnectionSide;
  point: {
    isEqual(other: { x: number; y: number }): boolean;
  };
};

export class TrackTravelDirectionResolver {
  constructor(
    private readonly topology: RailwayTopologyLayout
  ) {}

  resolve(): void {
    const physicalTracks =
      this.topology.getPhysicalTrackElements();

    this.resetRuntimeState(physicalTracks);

    const networks =
      this.findConnectedTrackNetworks(physicalTracks);

    for (const network of networks) {
      const directionElements =
        network.filter(
          (elem): elem is TopologyDirectionElement =>
            elem instanceof TopologyDirectionElement
        );

      if (directionElements.length === 0) {
        throw new Error(
          "A connected track network has no TrackDirection element."
        );
      }

      if (directionElements.length > 1) {
        throw new Error(
          "A connected track network has more than one TrackDirection element."
        );
      }

      const directionElement = directionElements[0]!;

      this.assignTrackNameToNetwork(
        network,
        directionElement.name.trim()
      );

      this.propagateTravelDirection(
        directionElement,
        network
      );
    }
  }

  private resetRuntimeState(
    elements: TopologyTrackElement[]
  ): void {
    for (const elem of elements) {
      elem.travelDirection = "unknown";
      elem.trackName = "";
    }
  }

  private findConnectedTrackNetworks(
    elements: TopologyTrackElement[]
  ): TopologyTrackElement[][] {
    const result: TopologyTrackElement[][] = [];
    const visited = new Set<number>();

    for (const elem of elements) {
      if (visited.has(elem.id)) {
        continue;
      }

      const network: TopologyTrackElement[] = [];
      const stack: TopologyTrackElement[] = [elem];

      while (stack.length > 0) {
        const current = stack.pop()!;

        if (visited.has(current.id)) {
          continue;
        }

        visited.add(current.id);
        network.push(current);

        for (const neighbor of this.getConnectedNeighbors(current)) {
          if (!visited.has(neighbor.id)) {
            stack.push(neighbor);
          }
        }
      }

      result.push(network);
    }

    return result;
  }

  private assignTrackNameToNetwork(
    network: TopologyTrackElement[],
    trackName: string
  ): void {
    for (const elem of network) {
      elem.trackName = trackName;
    }
  }

  private propagateTravelDirection(
    directionElement: TopologyDirectionElement,
    network: TopologyTrackElement[]
  ): void {
    const networkIds = new Set(
      network.map(elem => elem.id)
    );

    directionElement.travelDirection = "forward";

    const queue: TopologyTrackElement[] = [
      directionElement,
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;

      for (const neighbor of this.getConnectedNeighbors(current)) {
        if (!networkIds.has(neighbor.id)) {
          continue;
        }

        const currentSide =
          this.getSideTowards(current, neighbor);

        const neighborSide =
          this.getSideTowards(neighbor, current);

        if (!currentSide || !neighborSide) {
          continue;
        }

        const currentFlowSide =
          this.getFlowSideForConnection(
            current,
            currentSide
          );

        if (!currentFlowSide) {
          continue;
        }

        const desiredNeighborFlowSide: FlowSide =
          currentFlowSide === "forward"
            ? "backward"
            : "forward";

        const proposedNeighborDirection =
          this.getTravelDirectionForFlowSide(
            neighbor,
            neighborSide,
            desiredNeighborFlowSide
          );

        if (neighbor.travelDirection === "unknown") {
          neighbor.travelDirection =
            proposedNeighborDirection;

          queue.push(neighbor);
          continue;
        }

        if (
          neighbor.travelDirection !==
          proposedNeighborDirection
        ) {
          throw new Error(
            "Track travel direction conflict detected. Check TrackDirection placement and track topology."
          );
        }
      }
    }
  }

  private getConnectedNeighbors(
    element: TopologyTrackElement
  ): TopologyTrackElement[] {
    const result: TopologyTrackElement[] = [];

    for (const connection of this.getConnectionPoints(element)) {
      const candidate =
        this.topology.getPhysicalTrackAt(
          connection.point as any
        );

      if (!candidate || candidate.id === element.id) {
        continue;
      }

      if (!this.getSideTowards(candidate, element)) {
        continue;
      }

      if (result.some(existing => existing.id === candidate.id)) {
        continue;
      }

      result.push(candidate);
    }

    return result;
  }

  private getConnectionPoints(
    element: TopologyTrackElement
  ): ConnectionPoint[] {
    if (element instanceof TrackTurnoutThreeWayElement) {
      const c = element.getConnections();

      return [
        { side: "entry", point: c.entry },
        { side: "left", point: c.left },
        { side: "straight", point: c.straight },
        { side: "right", point: c.right },
      ];
    }

    if (
      isTopologyTurnoutElement(element) &&
      !(element instanceof TrackTurnoutDoubleElement)
    ) {
      const c = element.getConnections() as {
        entry: ConnectionPoint["point"];
        straight: ConnectionPoint["point"];
        div: ConnectionPoint["point"];
      };

      return [
        { side: "entry", point: c.entry },
        { side: "straight", point: c.straight },
        { side: "div", point: c.div },
      ];
    }

    return element.getNeighborPointPairs().flatMap(pair => [
      {
        side: "prev" as const,
        point: pair[0],
      },
      {
        side: "next" as const,
        point: pair[1],
      },
    ]);
  }

  private getSideTowards(
    element: TopologyTrackElement,
    other: TopologyTrackElement
  ): ConnectionSide | undefined {
    for (const connection of this.getConnectionPoints(element)) {
      if (connection.point.isEqual(other.pos)) {
        return connection.side;
      }
    }

    return undefined;
  }

  private getFlowSideForConnection(
    element: TopologyTrackElement,
    side: ConnectionSide
  ): FlowSide | null {
    const direction = element.travelDirection;

    if (direction === "unknown") {
      return null;
    }

    const branchingTurnout =
      isTopologyTurnoutElement(element) &&
      !(element instanceof TrackTurnoutDoubleElement);

    if (branchingTurnout) {
      if (direction === "forward") {
        return side === "entry"
          ? "backward"
          : "forward";
      }

      return side === "entry"
        ? "forward"
        : "backward";
    }

    if (direction === "forward") {
      return side === "next"
        ? "forward"
        : "backward";
    }

    return side === "next"
      ? "backward"
      : "forward";
  }

  private getTravelDirectionForFlowSide(
    element: TopologyTrackElement,
    side: ConnectionSide,
    desiredFlowSide: FlowSide
  ): TravelDirection {
    const branchingTurnout =
      isTopologyTurnoutElement(element) &&
      !(element instanceof TrackTurnoutDoubleElement);

    if (branchingTurnout) {
      if (desiredFlowSide === "forward") {
        return side === "entry"
          ? "reverse"
          : "forward";
      }

      return side === "entry"
        ? "forward"
        : "reverse";
    }

    if (desiredFlowSide === "forward") {
      return side === "next"
        ? "forward"
        : "reverse";
    }

    return side === "next"
      ? "reverse"
      : "forward";
  }
}
