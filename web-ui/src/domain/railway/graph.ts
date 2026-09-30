import type { LayoutElementId } from "../layout/layoutDto.js";
import type { TravelDirection } from "./topology.js";

export type TurnoutStateRequirement = {
  address: number;
  closed: boolean;
};

export type RouteTurnoutPassage = {
  elementId: LayoutElementId;
  name: string;
  turnoutStates: TurnoutStateRequirement[];
};

export type SectionDetector = {
  id: LayoutElementId;
  address: number;
  label: string;
};

export type SectionSignal = {
  id: LayoutElementId;
  address: number;
  label: string;
};

export type SectionBlock = {
  id: LayoutElementId;
  name: string;
  trackName: string;
  label: string;
  sensorAddress?: number;
  nodeName: string;
};

export type SectionPart = {
  key: string;
  index: number;
  elementIds: LayoutElementId[];
  fromSensor: number | null;
  toSensor: number | null;
  detectors: number[];
  circular: boolean;
  locoDirection: TravelDirection;
};

export type RouteSolution = {
  nodes: GraphNode[];
  edges: Edge[];
  turnoutStates: TurnoutStateRequirement[];
  locoDirection: TravelDirection;
};

export type BlockRoutePathItem =
  | { type: "block"; block: SectionBlock; node: GraphNode }
  | { type: "segment"; node: GraphNode };

export type BlockRouteSolution = RouteSolution & {
  fromBlock: SectionBlock;
  toBlock: SectionBlock;
  path: BlockRoutePathItem[];
};

export type RunnableBlockRoute = {
  fromBlock: SectionBlock;
  toBlock: SectionBlock;
  solution: BlockRouteSolution;
};

export type RunnableBlockTransition = RunnableBlockRoute;

export class GraphNode {
  name = "";
  trackName = "";
  x = 0;
  y = 0;
  isVirtual = false;
  busy = false;
  detectors: SectionDetector[] = [];
  signals: SectionSignal[] = [];
  elementIds: LayoutElementId[] = [];
  sectionParts: SectionPart[] = [];

  constructor(
    name: string,
    trackName: string,
    x: number,
    y: number,
    detectors: SectionDetector[] = [],
    signals: SectionSignal[] = [],
    elementIds: LayoutElementId[] = [],
    sectionParts: SectionPart[] = []
  ) {
    this.name = name;
    this.trackName = trackName;
    this.x = x;
    this.y = y;
    this.detectors = detectors;
    this.signals = signals;
    this.elementIds = elementIds;
    this.sectionParts = sectionParts;
  }
}

export class Edge {
  constructor(
    public from: GraphNode,
    public to: GraphNode,
    public turnoutStates: TurnoutStateRequirement[] = [],
    public locoDirection: TravelDirection = "unknown",
    public turnoutPath: RouteTurnoutPassage[] = []
  ) {}
}

type TurnoutRequirementMap = Map<number, boolean>;

export class Graph {
  nodes: GraphNode[] = [];
  edges: Edge[] = [];

  addNode(node: GraphNode): GraphNode {
    this.nodes.push(node);
    return node;
  }

  addEdge(edge: Edge): Edge {
    this.edges.push(edge);
    return edge;
  }

  private mergeLocoDirection(current: TravelDirection, next: TravelDirection): TravelDirection | null {
    if (current === "unknown") return next;
    if (next === "unknown") return current;
    if (current === next) return current;
    return null;
  }

  private mergeTurnoutRequirements(
    current: TurnoutRequirementMap,
    edgeRequirements: TurnoutStateRequirement[]
  ): TurnoutRequirementMap | null {
    const merged = new Map(current);

    for (const requirement of edgeRequirements) {
      const existing = merged.get(requirement.address);
      if (existing !== undefined && existing !== requirement.closed) return null;
      merged.set(requirement.address, requirement.closed);
    }

    return merged;
  }

  private turnoutRequirementMapToArray(requirements: TurnoutRequirementMap): TurnoutStateRequirement[] {
    return [...requirements.entries()]
      .sort(([a], [b]) => a - b)
      .map(([address, closed]) => ({ address, closed }));
  }

  private createRouteVisitedKey(
    node: GraphNode,
    requirements: TurnoutRequirementMap,
    locoDirection: TravelDirection
  ): string {
    const turnoutPart = this.turnoutRequirementMapToArray(requirements)
      .map(item => `${item.address}:${item.closed ? "C" : "T"}`)
      .join("|");
    return `${node.name}__${turnoutPart}__${locoDirection}`;
  }

  findRoute(fromNodeName: string, toNodeName: string): RouteSolution | null {
    const fromNode = this.nodes.find(node => node.name === fromNodeName);
    const toNode = this.nodes.find(node => node.name === toNodeName);
    if (!fromNode || !toNode) return null;

    if (fromNode === toNode) {
      return { nodes: [fromNode], edges: [], turnoutStates: [], locoDirection: "unknown" };
    }

    type SearchState = {
      node: GraphNode;
      nodes: GraphNode[];
      edges: Edge[];
      requirements: TurnoutRequirementMap;
      locoDirection: TravelDirection;
    };

    const queue: SearchState[] = [{
      node: fromNode,
      nodes: [fromNode],
      edges: [],
      requirements: new Map(),
      locoDirection: "unknown",
    }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentKey = this.createRouteVisitedKey(current.node, current.requirements, current.locoDirection);
      if (visited.has(currentKey)) continue;
      visited.add(currentKey);

      for (const edge of this.edges.filter(candidate => candidate.from === current.node)) {
        const mergedRequirements = this.mergeTurnoutRequirements(current.requirements, edge.turnoutStates);
        const mergedLocoDirection = this.mergeLocoDirection(current.locoDirection, edge.locoDirection);
        if (!mergedRequirements || !mergedLocoDirection) continue;

        const nextNodes = [...current.nodes, edge.to];
        const nextEdges = [...current.edges, edge];
        if (edge.to === toNode) {
          return {
            nodes: nextNodes,
            edges: nextEdges,
            turnoutStates: this.turnoutRequirementMapToArray(mergedRequirements),
            locoDirection: mergedLocoDirection,
          };
        }

        queue.push({
          node: edge.to,
          nodes: nextNodes,
          edges: nextEdges,
          requirements: mergedRequirements,
          locoDirection: mergedLocoDirection,
        });
      }
    }
    return null;
  }

}
