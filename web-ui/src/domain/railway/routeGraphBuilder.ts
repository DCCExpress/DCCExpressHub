import {
  Edge,
  Graph,
  GraphNode,
  type SectionDetector,
  type SectionSignal,
  type SectionPart,
  type TurnoutStateRequirement,
  type RouteTurnoutPassage,
} from "./graph";

import {
  RailwayTopologyLayout,
  type TopologyBlockElement,
  type TopologyPoint,
  type TopologyTrackElement,
  type TopologyTurnoutElement,
  isTopologyTurnoutElement,
  type TravelDirection,
} from "./topology";

import TrackTurnoutDoubleElement from "../../models/editor/elements/TrackTurnoutDoubleElement";
import { TrackTurnoutThreeWayElement } from "../../models/editor/elements/TrackTurnoutThreeWayElement";
import { TrackTravelDirectionResolver } from "./trackTravelDirectionResolver";

type TurnoutSide = string;

type TurnoutExit = {
  exitSide: TurnoutSide;
  turnoutStates: TurnoutStateRequirement[];
};

type TrackConnectionGroup = {
  index: number;
  endpoints: TopologyPoint[];
};

type LinearConnectionSide =
  | "prev"
  | "next";

export class RouteGraphBuilder {
  private readonly graph = new Graph();

  private readonly sectionNodes =
    new Map<number, GraphNode>();

  private readonly createdEdgeKeys =
    new Set<string>();

  private readonly sectionByTrackConnectionKey =
    new Map<string, number>();

  private readonly visitedTrackConnectionKeys =
    new Set<string>();

  private turnouts: TopologyTurnoutElement[] = [];
  private nextSectionNumber = 1;

  constructor(
    private readonly topology: RailwayTopologyLayout
  ) {}

  build(): Graph {
    this.resetRoutes();

    new TrackTravelDirectionResolver(
      this.topology
    ).resolve();

    this.turnouts = this.topology.getTurnouts();

    this.markTurnoutsVisited();
    this.discoverPhysicalSections();
    this.discoverSectionsFromDirectionElements();
    this.discoverRemainingTrackConnectionSections();
    this.createRouteEdges();

    return this.graph;
  }

  private resetRoutes(): void {
    const elems =
      this.topology.getPhysicalTrackElements();

    this.sectionNodes.clear();
    this.createdEdgeKeys.clear();
    this.sectionByTrackConnectionKey.clear();
    this.visitedTrackConnectionKeys.clear();

    this.nextSectionNumber = 1;
    this.turnouts = [];

    for (const elem of elems) {
      elem.isVisited = false;
      elem.isRoute = false;
      elem.section = 0;
      elem.travelDirection = "unknown";
    }
  }

  private markTurnoutsVisited(): void {
    for (const turnout of this.turnouts) {
      turnout.isVisited = true;
    }
  }

  private discoverPhysicalSections(): void {
    for (const turnout of this.turnouts) {
      const connections = this.getTurnoutConnectionPoints(turnout);

      for (const pos of Object.values(connections)) {
        const firstElem =
          this.topology.getPhysicalTrackAt(pos);

        if (
          !firstElem ||
          isTopologyTurnoutElement(firstElem)
        ) {
          continue;
        }

        if (!this.hasTrackConnectionAt(firstElem, turnout.pos)) {
          continue;
        }

        if (this.isTrackConnectionVisited(firstElem, turnout.pos)) {
          continue;
        }

        this.createPhysicalSection(firstElem, turnout.pos);
      }
    }
  }

  private discoverSectionsFromDirectionElements(): void {
    for (const directionElement of this.topology.getDirectionElements()) {
      if (this.areAllTrackConnectionsVisited(directionElement)) {
        continue;
      }

      this.createPhysicalSection(directionElement);
    }
  }

  private discoverRemainingTrackConnectionSections(): void {
    for (const elem of this.topology.getPhysicalTrackElements()) {
      if (
        isTopologyTurnoutElement(elem) ||
        this.areAllTrackConnectionsVisited(elem)
      ) {
        continue;
      }

      this.createPhysicalSection(elem);
    }
  }

  private createPhysicalSection(
    firstElem: TopologyTrackElement,
    incomingPos?: TopologyPoint
  ): void {
    const sectionNumber =
      this.nextSectionNumber++;

    const sectionElements: TopologyTrackElement[] = [];

    this.walkTrackSection(
      firstElem,
      incomingPos,
      sectionNumber,
      sectionElements
    );

    if (sectionElements.length === 0) {
      this.nextSectionNumber--;
      return;
    }

    const node = this.createSectionGraphNode(
      sectionNumber,
      sectionElements
    );

    this.graph.addNode(node);
    this.sectionNodes.set(sectionNumber, node);
  }

  private walkTrackSection(
    obj: TopologyTrackElement,
    incomingPos: TopologyPoint | undefined,
    section: number,
    sectionElements: TopologyTrackElement[]
  ): void {
    const groups =
      this.getTrackConnectionGroupsForIncoming(
        obj,
        incomingPos
      );

    for (const group of groups) {
      const key =
        this.getTrackConnectionKey(obj, group.index);

      if (this.visitedTrackConnectionKeys.has(key)) {
        continue;
      }

      this.visitedTrackConnectionKeys.add(key);
      this.sectionByTrackConnectionKey.set(key, section);

      if (obj.section === 0) {
        obj.section = section;
      }

      this.addSectionElementOnce(
        sectionElements,
        obj
      );

      for (const endpoint of group.endpoints) {
        if (incomingPos?.isEqual(endpoint)) {
          continue;
        }

        this.walkTrackSectionDirection(
          obj,
          endpoint,
          section,
          sectionElements
        );
      }

      obj.isVisited =
        this.areAllTrackConnectionsVisited(obj);
    }
  }

  private walkTrackSectionDirection(
    current: TopologyTrackElement,
    targetPos: TopologyPoint,
    section: number,
    sectionElements: TopologyTrackElement[]
  ): void {
    const next =
      this.topology.getPhysicalTrackAt(targetPos);

    if (
      !next ||
      isTopologyTurnoutElement(next) ||
      !this.hasTrackConnectionAt(next, current.pos) ||
      this.isTrackConnectionVisited(next, current.pos)
    ) {
      return;
    }

    this.walkTrackSection(
      next,
      current.pos,
      section,
      sectionElements
    );
  }

  private addSectionElementOnce(
    sectionElements: TopologyTrackElement[],
    elem: TopologyTrackElement
  ): void {
    if (sectionElements.some(existing => existing.id === elem.id)) {
      return;
    }

    sectionElements.push(elem);
  }

  private createSectionGraphNode(
    section: number,
    sectionElements: TopologyTrackElement[]
  ): GraphNode {
    let x = 0;
    let y = 0;

    for (const elem of sectionElements) {
      x += elem.pos.x;
      y += elem.pos.y;
    }

    if (sectionElements.length > 0) {
      x /= sectionElements.length;
      y /= sectionElements.length;
    }

    const trackName =
      this.getSectionTrackName(sectionElements);

    const detectors =
      this.collectSectionDetectors(sectionElements);

    const signals =
      this.collectSectionSignals(sectionElements);

    return new GraphNode(
      `S${section}`,
      trackName,
      x,
      y,
      detectors,
      signals,
      sectionElements.map(elem => elem.id),
      this.buildSectionParts(
        section,
        sectionElements
      )
    );
  }

  private getSectionTrackName(
    sectionElements: TopologyTrackElement[]
  ): string {
    return (
      sectionElements.find(
        elem => elem.trackName.trim().length > 0
      )?.trackName.trim() ?? ""
    );
  }

  private collectSectionDetectors(
    sectionElements: TopologyTrackElement[]
  ): SectionDetector[] {
    const positions = new Set(
      sectionElements.map(
        elem => `${elem.x}:${elem.y}`
      )
    );

    return this.topology
      .getSensors()
      .filter(sensor =>
        positions.has(`${sensor.x}:${sensor.y}`)
      )
      .sort((a, b) => a.address - b.address)
      .map(sensor => ({
        id: sensor.id,
        address: sensor.address,
        label: `D${sensor.address}`,
      }));
  }

  private collectSectionSignals(
    sectionElements: TopologyTrackElement[]
  ): SectionSignal[] {
    const positions = new Set(
      sectionElements.map(
        elem => `${elem.x}:${elem.y}`
      )
    );

    return this.topology
      .getSignals()
      .filter(signal =>
        positions.has(`${signal.x}:${signal.y}`)
      )
      .sort((a, b) => a.address - b.address)
      .map(signal => ({
        id: signal.id,
        address: signal.address,
        label: `L${signal.address}`,
      }));
  }

  private sectionSensorAddressesAt(
    element: TopologyTrackElement
  ): number[] {
    const result =
      new Set<number>();

    if (
      Number.isInteger(
        element.address
      ) &&
      element.address >
        0
    ) {
      result.add(
        element.address
      );
    }

    for (
      const sensor of
      this.topology.getSensors()
    ) {
      if (
        sensor.x ===
          element.x &&
        sensor.y ===
          element.y &&
        Number.isInteger(
          sensor.address
        ) &&
        sensor.address >
          0
      ) {
        result.add(
          sensor.address
        );
      }
    }

    return [
      ...result,
    ].sort(
      (
        left,
        right
      ) =>
        left -
        right
    );
  }

  private sectionPartNeighbors(
    element:
      TopologyTrackElement,
    allowedIds:
      Set<number>
  ): TopologyTrackElement[] {
    const result =
      new Map<
        number,
        TopologyTrackElement
      >();

    for (
      const group of
      this.getTrackConnectionGroups(
        element
      )
    ) {
      for (
        const endpoint of
        group.endpoints
      ) {
        const candidate =
          this.topology.getPhysicalTrackAt(
            endpoint
          );

        if (
          !candidate ||
          candidate.id ===
            element.id ||
          !allowedIds.has(
            candidate.id
          ) ||
          isTopologyTurnoutElement(
            candidate
          ) ||
          !this.hasTrackConnectionAt(
            candidate,
            element.pos
          )
        ) {
          continue;
        }

        result.set(
          candidate.id,
          candidate
        );
      }
    }

    return [
      ...result.values(),
    ];
  }

  private orderSectionElementsForParts(
    sectionElements:
      TopologyTrackElement[]
  ): {
    elements:
      TopologyTrackElement[];
    circular: boolean;
  } {
    if (
      sectionElements.length <=
        1
    ) {
      return {
        elements: [
          ...sectionElements,
        ],
        circular:
          false,
      };
    }

    const allowedIds =
      new Set(
        sectionElements.map(
          element =>
            element.id
        )
      );

    const neighbors =
      new Map<
        number,
        TopologyTrackElement[]
      >();

    for (
      const element of
      sectionElements
    ) {
      neighbors.set(
        element.id,
        this.sectionPartNeighbors(
          element,
          allowedIds
        )
      );
    }

    const isSimplePath =
      sectionElements.every(
        element =>
          (
            neighbors.get(
              element.id
            )?.length ??
            0
          ) <=
            2
      );

    if (!isSimplePath) {
      /*
       * Crossings or other compound track elements may create a non-simple
       * element graph. Keep the historical section order rather than guessing
       * a physical traversal.
       */
      return {
        elements: [
          ...sectionElements,
        ],
        circular:
          false,
      };
    }

    const endpoints =
      sectionElements
        .filter(
          element =>
            (
              neighbors.get(
                element.id
              )?.length ??
              0
            ) ===
              1
        )
        .sort(
          (
            left,
            right
          ) =>
            left.id -
            right.id
        );

    const circular =
      endpoints.length ===
        0 &&
      sectionElements.every(
        element =>
          (
            neighbors.get(
              element.id
            )?.length ??
            0
          ) ===
            2
      );

    const start =
      (
        endpoints[0] ??
        [
          ...sectionElements,
        ].sort(
          (
            left,
            right
          ) =>
            left.id -
            right.id
        )[0]
      );

    if (!start) {
      return {
        elements: [],
        circular:
          false,
      };
    }

    const ordered:
      TopologyTrackElement[] =
      [];

    const visited =
      new Set<number>();

    let previous:
      TopologyTrackElement |
      null =
      null;

    let current:
      TopologyTrackElement |
      null =
      start;

    while (
      current &&
      !visited.has(
        current.id
      )
    ) {
      ordered.push(
        current
      );

      visited.add(
        current.id
      );

      const candidates:
        TopologyTrackElement[] =
        (
          neighbors.get(
            current.id
          ) ??
          []
        )
          .filter(
            candidate =>
              candidate.id !==
                previous?.id &&
              !visited.has(
                candidate.id
              )
          )
          .sort(
            (
              left,
              right
            ) =>
              left.id -
              right.id
          );

      const next:
        TopologyTrackElement |
        null =
        candidates[0] ??
        null;

      previous =
        current;

      current =
        next;
    }

    /*
     * A proper linear/circular section must be traversable exactly once.
     * Fall back instead of silently losing track elements if the topology is
     * more complex than the simple section model.
     */
    if (
      ordered.length !==
        sectionElements.length
    ) {
      return {
        elements: [
          ...sectionElements,
        ],
        circular:
          false,
      };
    }

    return {
      elements:
        ordered,
      circular,
    };
  }

  private sectionPathDirection(
    elements:
      TopologyTrackElement[]
  ): TravelDirection {
    const first =
      elements[0];

    const second =
      elements[1];

    if (!first) {
      return "unknown";
    }

    if (!second) {
      return first.travelDirection;
    }

    const side =
      this.getLinearConnectionSideTowards(
        first,
        second.pos
      );

    if (
      side ===
        "next"
    ) {
      return first.travelDirection;
    }

    if (
      side ===
        "prev"
    ) {
      return first.travelDirection ===
        "forward"
        ? "reverse"
        : first.travelDirection ===
            "reverse"
          ? "forward"
          : "unknown";
    }

    return "unknown";
  }

  private buildSectionParts(
    section: number,
    sectionElements:
      TopologyTrackElement[]
  ): SectionPart[] {
    if (
      sectionElements.length ===
        0
    ) {
      return [];
    }

    const orderedSection =
      this.orderSectionElementsForParts(
        sectionElements
      );

    const orderedElements =
      orderedSection.elements;

    const circular =
      orderedSection.circular;

    const boundaries =
      orderedElements.flatMap(
        (
          element,
          elementIndex
        ) =>
          this.sectionSensorAddressesAt(
            element
          ).map(
            sensor => ({
              elementIndex,
              sensor,
            })
          )
      );

    const makePart =
      (
        index: number,
        fromSensor:
          number | null,
        toSensor:
          number | null,
        elements:
          TopologyTrackElement[]
      ): SectionPart => ({
        key:
          `S${section}.${index + 1}`,
        index,
        elementIds:
          elements.map(
            element =>
              element.id
          ),
        fromSensor,
        toSensor,
        detectors:
          toSensor !==
            null
            ? [
                toSensor,
              ]
            : [],
        circular,
        locoDirection:
          this.sectionPathDirection(
            elements
          ),
      });

    if (
      boundaries.length ===
        0
    ) {
      return [
        makePart(
          0,
          null,
          null,
          orderedElements
        ),
      ];
    }

    /*
     * Multiple sensor objects may occupy one physical rail element. For
     * topology slicing they are one boundary; keep the lowest address as the
     * stable boundary key while all detector addresses remain available on
     * the graph node itself.
     */
    const elementBoundaries =
      boundaries
        .filter(
          (
            boundary,
            index,
            all
          ) =>
            all.findIndex(
              candidate =>
                candidate.elementIndex ===
                  boundary.elementIndex
            ) ===
              index
        )
        .sort(
          (
            left,
            right
          ) =>
            left.elementIndex -
              right.elementIndex ||
            left.sensor -
              right.sensor
        );

    /*
     * If one detector address is assigned to several consecutive rail
     * elements, treat that as one physical detector region. The boundary is
     * the LAST element of that contiguous run, so the whole run belongs to
     * the same destination-owned SectionPart.
     */
    const uniqueBoundaries:
      Array<{
        elementIndex: number;
        sensor: number;
      }> = [];

    for (
      const boundary of
      elementBoundaries
    ) {
      const previous =
        uniqueBoundaries[
          uniqueBoundaries.length -
            1
        ];

      if (
        previous &&
        previous.sensor ===
          boundary.sensor &&
        boundary.elementIndex ===
          previous.elementIndex +
            1
      ) {
        previous.elementIndex =
          boundary.elementIndex;

        continue;
      }

      uniqueBoundaries.push({
        ...boundary,
      });
    }

    if (circular) {
      return uniqueBoundaries.map(
        (
          boundary,
          index
        ) => {
          const next =
            uniqueBoundaries[
              (
                index +
                1
              ) %
              uniqueBoundaries.length
            ]!;

          const elements =
            next.elementIndex >
              boundary.elementIndex
              ? orderedElements.slice(
                  boundary.elementIndex +
                    1,
                  next.elementIndex +
                    1
                )
              : [
                  ...orderedElements.slice(
                    boundary.elementIndex +
                      1
                  ),
                  ...orderedElements.slice(
                    0,
                    next.elementIndex +
                      1
                  ),
                ];

          return makePart(
            index,
            boundary.sensor,
            next.sensor,
            elements
          );
        }
      );
    }

    const parts:
      SectionPart[] = [];

    const first =
      uniqueBoundaries[0]!;

    parts.push(
      makePart(
        parts.length,
        null,
        first.sensor,
        orderedElements.slice(
          0,
          first.elementIndex +
            1
        )
      )
    );

    for (
      let index = 0;
      index <
        uniqueBoundaries.length -
          1;
      index += 1
    ) {
      const current =
        uniqueBoundaries[
          index
        ]!;

      const next =
        uniqueBoundaries[
          index +
            1
        ]!;

      parts.push(
        makePart(
          parts.length,
          current.sensor,
          next.sensor,
          orderedElements.slice(
            current.elementIndex +
              1,
            next.elementIndex +
              1
          )
        )
      );
    }

    const last =
      uniqueBoundaries[
        uniqueBoundaries.length -
          1
      ]!;

    if (
      last.elementIndex <
        orderedElements.length -
          1
    ) {
      parts.push(
        makePart(
          parts.length,
          last.sensor,
          null,
          orderedElements.slice(
            last.elementIndex +
              1
          )
        )
      );
    }

    return parts;
  }

  private createRouteEdges(): void {
    for (const turnout of this.turnouts) {
      const connections =
        this.getTurnoutConnectionPoints(turnout);

      for (const [side, point] of Object.entries(connections)) {
        const connectedElem =
          this.topology.getPhysicalTrackAt(point);

        if (
          !connectedElem ||
          isTopologyTurnoutElement(connectedElem)
        ) {
          continue;
        }

        const connectedSection =
          this.getSectionForTrackConnection(
            connectedElem,
            turnout.pos
          );

        if (!connectedSection) {
          continue;
        }

        const fromNode =
          this.sectionNodes.get(connectedSection);

        if (!fromNode) {
          continue;
        }

        const locoDirection =
          this.getLocoDirectionFromSectionTowardsTurnout(
            connectedElem,
            turnout
          );

        this.walkTurnoutChainToSections(
          fromNode,
          turnout,
          side,
          [],
          [],
          new Set<string>(),
          locoDirection
        );
      }
    }
  }

  private walkTurnoutChainToSections(
    fromNode: GraphNode,
    turnout: TopologyTurnoutElement,
    enteredSide: TurnoutSide,
    turnoutStates: TurnoutStateRequirement[],
    turnoutPath: RouteTurnoutPassage[],
    visitedTurnoutSides: Set<string>,
    locoDirection: TravelDirection
  ): void {
    const visitKey =
      `${turnout.id}:${enteredSide}`;

    if (visitedTurnoutSides.has(visitKey)) {
      return;
    }

    const nextVisited =
      new Set(visitedTurnoutSides);

    nextVisited.add(visitKey);

    for (const exit of this.getAllowedTurnoutExits(turnout, enteredSide)) {
      const nextTurnoutStates = [
        ...turnoutStates,
        ...exit.turnoutStates,
      ];

      const nextTurnoutPath = [
        ...turnoutPath,
        {
          elementId:
            turnout.id,
          name: (() => {
            const configuredName =
              turnout.name?.trim() ??
              "";

            if (
              configuredName &&
              configuredName !==
                "element"
            ) {
              return configuredName;
            }

            const addresses =
              exit.turnoutStates
                .map(
                  state =>
                    state.address
                )
                .join("/");

            return addresses
              ? `Turnout #${addresses}`
              : `Turnout #${turnout.id}`;
          })(),
          turnoutStates:
            this.normalizeTurnoutStates(
              exit.turnoutStates
            ),
        },
      ];

      const exitPos =
        this.getTurnoutConnectionPoints(turnout)[exit.exitSide];

      if (!exitPos) {
        continue;
      }

      const nextElem =
        this.topology.getPhysicalTrackAt(exitPos);

      if (!nextElem) {
        continue;
      }

      if (!isTopologyTurnoutElement(nextElem)) {
        this.finishRouteEdge(
          fromNode,
          nextElem,
          turnout.pos,
          nextTurnoutStates,
          nextTurnoutPath,
          locoDirection
        );

        continue;
      }

      const nextEnteredSide =
        this.getTurnoutSideConnectedToElement(
          nextElem,
          turnout
        );

      if (!nextEnteredSide) {
        continue;
      }

      this.walkTurnoutChainToSections(
        fromNode,
        nextElem,
        nextEnteredSide,
        nextTurnoutStates,
        nextTurnoutPath,
        nextVisited,
        locoDirection
      );
    }
  }

  private finishRouteEdge(
    fromNode: GraphNode,
    targetElem: TopologyTrackElement,
    connectedFrom: TopologyPoint,
    turnoutStates: TurnoutStateRequirement[],
    turnoutPath: RouteTurnoutPassage[],
    locoDirection: TravelDirection
  ): void {
    const targetSection =
      this.getSectionForTrackConnection(
        targetElem,
        connectedFrom
      );

    if (!targetSection) {
      return;
    }

    const toNode =
      this.sectionNodes.get(targetSection);

    if (!toNode || toNode === fromNode) {
      return;
    }

    this.addRouteEdgeIfMissing(
      fromNode,
      toNode,
      turnoutStates,
      turnoutPath,
      locoDirection
    );
  }

  private addRouteEdgeIfMissing(
    from: GraphNode,
    to: GraphNode,
    turnoutStates: TurnoutStateRequirement[],
    turnoutPath: RouteTurnoutPassage[],
    locoDirection: TravelDirection
  ): void {
    const normalizedStates =
      this.normalizeTurnoutStates(turnoutStates);

    const turnoutKey = normalizedStates
      .map(state =>
        `${state.address}:${state.closed ? "C" : "T"}`
      )
      .join("|");

    const turnoutPathKey =
      turnoutPath
        .map(
          passage =>
            String(
              passage.elementId
            )
        )
        .join(">");

    const edgeKey =
      `${from.name}->${to.name}:${turnoutKey}:${turnoutPathKey}:${locoDirection}`;

    if (this.createdEdgeKeys.has(edgeKey)) {
      return;
    }

    this.createdEdgeKeys.add(edgeKey);

    this.graph.addEdge(
      new Edge(
        from,
        to,
        normalizedStates,
        locoDirection,
        turnoutPath
      )
    );
  }

  private normalizeTurnoutStates(
    turnoutStates: TurnoutStateRequirement[]
  ): TurnoutStateRequirement[] {
    const byAddress = new Map<number, boolean>();

    for (const state of turnoutStates) {
      if (state.address <= 0) {
        continue;
      }

      const existing = byAddress.get(state.address);

      if (
        existing !== undefined &&
        existing !== state.closed
      ) {
        throw new Error(
          `Conflicting turnout requirement for address ${state.address}.`
        );
      }

      byAddress.set(state.address, state.closed);
    }

    return [...byAddress.entries()]
      .sort(([a], [b]) => a - b)
      .map(([address, closed]) => ({
        address,
        closed,
      }));
  }

  private getAllowedTurnoutExits(
    turnout: TopologyTurnoutElement,
    enteredSide: TurnoutSide
  ): TurnoutExit[] {
    if (turnout instanceof TrackTurnoutDoubleElement) {
      return turnout
        .getOppositeRoutesFromSide(enteredSide as any)
        .map(route => ({
          exitSide:
            turnout.getRouteExitSide(route, enteredSide as any) ?? "",
          turnoutStates:
            this.toLogicalMultiMotorStates(
              turnout,
              route.turnoutStates
            ),
        }))
        .filter(exit => Boolean(exit.exitSide));
    }

    if (turnout instanceof TrackTurnoutThreeWayElement) {
      return turnout
        .getOppositeRoutesFromSide(enteredSide as any)
        .map(route => ({
          exitSide:
            turnout.getRouteExitSide(route, enteredSide as any) ?? "",
          turnoutStates:
            this.toLogicalMultiMotorStates(
              turnout,
              route.turnoutStates
            ),
        }))
        .filter(exit => Boolean(exit.exitSide));
    }

    const single = turnout as TopologyTurnoutElement & {
      turnoutAddress: number;
    };

    const straightState: TurnoutStateRequirement = {
      address: single.turnoutAddress,
      closed: true,
    };

    const divState: TurnoutStateRequirement = {
      address: single.turnoutAddress,
      closed: false,
    };

    switch (enteredSide) {
      case "entry":
        return [
          {
            exitSide: "straight",
            turnoutStates: [straightState],
          },
          {
            exitSide: "div",
            turnoutStates: [divState],
          },
        ];

      case "straight":
        return [
          {
            exitSide: "entry",
            turnoutStates: [straightState],
          },
        ];

      case "div":
        return [
          {
            exitSide: "entry",
            turnoutStates: [divState],
          },
        ];

      default:
        return [];
    }
  }

  /**
   * Multi-motor turnout classes expose their configured position table as
   * PHYSICAL motor bits. The route graph stores LOGICAL CLOSED/THROWN states,
   * exactly like the original DCCExpressNext graph did.
   *
   * This keeps graph semantics uniform for single, Double and 3-way turnouts.
   */
  private toLogicalMultiMotorStates(
    turnout:
      | TrackTurnoutDoubleElement
      | TrackTurnoutThreeWayElement,
    physicalStates: readonly TurnoutStateRequirement[]
  ): TurnoutStateRequirement[] {
    return physicalStates.map(state => {
      if (state.address === turnout.turnout1Address) {
        return {
          address: state.address,
          closed:
            state.closed === turnout.turnout1ClosedValue,
        };
      }

      if (state.address === turnout.turnout2Address) {
        return {
          address: state.address,
          closed:
            state.closed === turnout.turnout2ClosedValue,
        };
      }

      throw new Error(
        `Unknown motor address ${state.address} in multi-motor turnout ${turnout.id}.`
      );
    });
  }

  private getTurnoutConnectionPoints(
    turnout: TopologyTurnoutElement
  ): Record<string, TopologyPoint> {
    return turnout.getConnections() as unknown as Record<string, TopologyPoint>;
  }

  private getTurnoutSideConnectedToElement(
    turnout: TopologyTurnoutElement,
    other: TopologyTrackElement
  ): TurnoutSide | undefined {
    for (
      const [side, point]
      of Object.entries(
        this.getTurnoutConnectionPoints(turnout)
      )
    ) {
      if (point.isEqual(other.pos)) {
        return side;
      }
    }

    return undefined;
  }

  private getLocoDirectionFromSectionTowardsTurnout(
    sectionElem: TopologyTrackElement,
    turnout: TopologyTurnoutElement
  ): TravelDirection {
    if (sectionElem.travelDirection === "unknown") {
      return "unknown";
    }

    const side =
      this.getLinearConnectionSideTowards(
        sectionElem,
        turnout.pos
      );

    if (side === "next") {
      return sectionElem.travelDirection;
    }

    if (side === "prev") {
      return sectionElem.travelDirection === "forward"
        ? "reverse"
        : "forward";
    }

    return "unknown";
  }

  private getSectionForTrackConnection(
    element: TopologyTrackElement,
    connectedFrom: TopologyPoint
  ): number {
    const group =
      this.getTrackConnectionGroupsForIncoming(
        element,
        connectedFrom
      )[0];

    if (!group) {
      return 0;
    }

    return (
      this.sectionByTrackConnectionKey.get(
        this.getTrackConnectionKey(
          element,
          group.index
        )
      ) ??
      element.section ??
      0
    );
  }

  private isTrackConnectionVisited(
    element: TopologyTrackElement,
    connectedFrom: TopologyPoint
  ): boolean {
    const groups =
      this.getTrackConnectionGroupsForIncoming(
        element,
        connectedFrom
      );

    return (
      groups.length > 0 &&
      groups.every(group =>
        this.visitedTrackConnectionKeys.has(
          this.getTrackConnectionKey(
            element,
            group.index
          )
        )
      )
    );
  }

  private areAllTrackConnectionsVisited(
    element: TopologyTrackElement
  ): boolean {
    const groups =
      this.getTrackConnectionGroups(element);

    return (
      groups.length > 0 &&
      groups.every(group =>
        this.visitedTrackConnectionKeys.has(
          this.getTrackConnectionKey(
            element,
            group.index
          )
        )
      )
    );
  }

  private hasTrackConnectionAt(
    element: TopologyTrackElement,
    point: TopologyPoint
  ): boolean {
    return this.getTrackConnectionGroupsForIncoming(
      element,
      point
    ).length > 0;
  }

  private getLinearConnectionSideTowards(
    element: TopologyTrackElement,
    point: TopologyPoint
  ): LinearConnectionSide | undefined {
    for (const pair of element.getNeighborPointPairs()) {
      if (pair[0].isEqual(point)) {
        return "prev";
      }

      if (pair[1].isEqual(point)) {
        return "next";
      }
    }

    return undefined;
  }

  private getTrackConnectionGroupsForIncoming(
    element: TopologyTrackElement,
    incomingPos?: TopologyPoint
  ): TrackConnectionGroup[] {
    const groups =
      this.getTrackConnectionGroups(element);

    if (!incomingPos) {
      return groups;
    }

    return groups.filter(group =>
      group.endpoints.some(endpoint =>
        endpoint.isEqual(incomingPos)
      )
    );
  }

  private getTrackConnectionGroups(
    element: TopologyTrackElement
  ): TrackConnectionGroup[] {
    return element
      .getNeighborPointPairs()
      .map((pair, index) => ({
        index,
        endpoints: [pair[0], pair[1]],
      }));
  }

  private getTrackConnectionKey(
    element: TopologyTrackElement,
    groupIndex: number
  ): string {
    return `${element.id}:${groupIndex}`;
  }
}
