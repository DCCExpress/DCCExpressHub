import type { LayoutElementId } from "../layout/layoutDto.js";
import type { TravelDirection } from "./topology.js";

export type TurnoutStateRequirement = {
  address: number;
  closed: boolean;
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
  blocks: SectionBlock[] = [];
  elementIds: LayoutElementId[] = [];

  constructor(
    name: string,
    trackName: string,
    x: number,
    y: number,
    detectors: SectionDetector[] = [],
    signals: SectionSignal[] = [],
    blocks: SectionBlock[] = [],
    elementIds: LayoutElementId[] = []
  ) {
    this.name = name;
    this.trackName = trackName;
    this.x = x;
    this.y = y;
    this.detectors = detectors;
    this.signals = signals;
    this.blocks = blocks;
    this.elementIds = elementIds;
  }
}

export class Edge {
  constructor(
    public from: GraphNode,
    public to: GraphNode,
    public turnoutStates: TurnoutStateRequirement[] = [],
    public locoDirection: TravelDirection = "unknown"
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

  findNodeContainingBlock(blockId: LayoutElementId): GraphNode | null {
    return this.nodes.find(node => node.blocks.some(block => block.id === blockId)) ?? null;
  }

  findBlockById(blockId: LayoutElementId): SectionBlock | null {
    for (const node of this.nodes) {
      const block = node.blocks.find(item => item.id === blockId);
      if (block) return block;
    }
    return null;
  }

  findBlockByName(blockName: string): SectionBlock | null {
    const normalized = blockName.trim();
    for (const node of this.nodes) {
      const block = node.blocks.find(item => item.name === normalized);
      if (block) return block;
    }
    return null;
  }

  findRouteBetweenBlocks(fromBlockId: LayoutElementId, toBlockId: LayoutElementId): BlockRouteSolution | null {
    const fromNode = this.findNodeContainingBlock(fromBlockId);
    const toNode = this.findNodeContainingBlock(toBlockId);
    const fromBlock = this.findBlockById(fromBlockId);
    const toBlock = this.findBlockById(toBlockId);
    if (!fromNode || !toNode || !fromBlock || !toBlock) return null;

    const segmentRoute = this.findRoute(fromNode.name, toNode.name);
    if (!segmentRoute) return null;

    const path: BlockRoutePathItem[] = [{ type: "block", block: fromBlock, node: fromNode }];
    for (const node of segmentRoute.nodes) {
      path.push({ type: "segment", node });
      for (const block of node.blocks) {
        if (block.id === fromBlock.id || block.id === toBlock.id) continue;
        path.push({ type: "block", block, node });
      }
    }
    path.push({ type: "block", block: toBlock, node: toNode });

    return { ...segmentRoute, fromBlock, toBlock, path };
  }

  findRouteBetweenBlockNames(fromBlockName: string, toBlockName: string): BlockRouteSolution | null {
    const fromBlock = this.findBlockByName(fromBlockName);
    const toBlock = this.findBlockByName(toBlockName);
    if (!fromBlock || !toBlock) return null;
    return this.findRouteBetweenBlocks(fromBlock.id, toBlock.id);
  }

  getRunnableBlockRoutes(): RunnableBlockRoute[] {
    const result: RunnableBlockRoute[] = [];
    const blocks = this.nodes.flatMap(node => node.blocks);
    for (const fromBlock of blocks) {
      for (const toBlock of blocks) {
        if (fromBlock.id === toBlock.id) continue;
        const solution = this.findRouteBetweenBlocks(fromBlock.id, toBlock.id);
        if (solution) result.push({ fromBlock, toBlock, solution });
      }
    }
    return result;
  }

  getRunnableBlockTransitions(): RunnableBlockTransition[] {
    return this.getRunnableBlockRoutes().filter(route => {
      const solution = route.solution;
      if (solution.nodes.length < 2) return false;
      return !solution.nodes.slice(1, -1).some(node => node.blocks.length > 0);
    });
  }
}
