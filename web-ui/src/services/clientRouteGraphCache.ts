import type {
  SerializedLayoutDto,
  SerializedLayoutElementDto,
} from "@domain/layout/layoutDto";

import type {
  RouteGraphDto,
} from "@domain/railway/routeGraphDto";

import type {
  Edge,
  GraphNode,
  SectionBlock,
  TurnoutStateRequirement,
  RouteTurnoutPassage,
} from "@domain/railway/graph";

import type {
  LayoutView,
} from "@/models/editor/core/LayoutView";

import {
  buildClientRouteGraph,
  type ClientRouteGraphBuildResult,
} from "@/services/clientRouteGraphBuilder";

import {
  createClientGraphFromRouteGraphDto,
} from "@/services/routeGraphDtoMapper";

const ROUTE_TOPOLOGY_VERSION = 3;

const ROUTE_TOPOLOGY_FIELD =
  "routeTopology";

export type PersistedRouteBlockEntry = {
  id: number;
  name: string;
  nodeIndex: number;
};

export type PersistedRouteEdgeEntry = {
  from: string;
  to: string;
  turnoutStates: TurnoutStateRequirement[];
  turnoutPath: RouteTurnoutPassage[];
  locoDirection:
    | "unknown"
    | "forward"
    | "reverse";
};

export type PersistedRouteTableEntry = {
  fromBlockId: number;
  fromBlockName: string;
  toBlockId: number;
  toBlockName: string;
  /**
   * Ordered route blocks including source and destination.
   *
   * Example:
   *   A1 -> C1 through B1
   *   [A1, B1, C1]
   *
   * Dispatcher uses every entry after index 0 as a protected/target block.
   */
  blockPath: PersistedRouteBlockEntry[];
  nodes: string[];
  edgePath: PersistedRouteEdgeEntry[];
  turnoutStates: TurnoutStateRequirement[];
  locoDirection:
    | "unknown"
    | "forward"
    | "reverse";
};

export type PersistedClientRouteTopology = {
  version: typeof ROUTE_TOPOLOGY_VERSION;
  fingerprint: string;
  topologyRevision: number;
  graphRevision: number;
  graph: RouteGraphDto;
  routeTable: PersistedRouteTableEntry[];
};

type RouteGraphCacheEntry = {
  fingerprint: string;
  topologyRevision: number;
  graphRevision: number;
  result: ClientRouteGraphBuildResult | null;
  persisted: PersistedClientRouteTopology | null;
};

export type ClientRouteGraphEnsureResult = {
  result: ClientRouteGraphBuildResult;
  rebuilt: boolean;
  topologyRevision: number;
  graphRevision: number;
  fingerprint: string;
};

const cache =
  new WeakMap<
    LayoutView,
    RouteGraphCacheEntry
  >();

const TOPOLOGY_FIELDS =
  new Set<string>([
    "id",
    "type",
    "name",
    "x",
    "y",
    "w",
    "h",
    "rotation",
    "rotationStep",
    "length",
    "address",

    // Block / detector / signal metadata used by graph nodes.
    "sensorAddress",
    "blockType",
    "signalOutput",
    "addressLength",
    "dispalyAsSingleLamp",
    "valueGreen",
    "valueRed",
    "valueYellow",
    "valueWhite",

    // Single turnout configuration.
    "outputMode",
    "turnoutAddress",
    "turnoutClosedValue",
    "turnoutClosedAspect",
    "turnoutOpenedAspect",

    // Multi-motor base configuration.
    "turnout1Address",
    "turnout2Address",
    "turnout1ClosedValue",
    "turnout2ClosedValue",
    "turnout1ClosedAspect",
    "turnout1OpenedAspect",
    "turnout2ClosedAspect",
    "turnout2OpenedAspect",

    // Double explicit physical position table.
    "ooMotor1Value",
    "ooMotor2Value",
    "ocMotor1Value",
    "ocMotor2Value",
    "coMotor1Value",
    "coMotor2Value",
    "ccMotor1Value",
    "ccMotor2Value",

    // 3-way explicit physical position table.
    "leftMotor1Value",
    "leftMotor2Value",
    "straightMotor1Value",
    "straightMotor2Value",
    "rightMotor1Value",
    "rightMotor2Value",
  ]);

function asRecord(
  value: unknown
): Record<string, unknown> | null {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value as Record<string, unknown>
    : null;
}

function isTopologyElement(
  element: SerializedLayoutElementDto
): boolean {
  return (
    typeof element.type === "string" &&
    element.type.startsWith("track")
  );
}

function stableValue(
  value: unknown
): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  const record =
    asRecord(value);

  if (!record) {
    return value;
  }

  const result:
    Record<string, unknown> = {};

  for (
    const key
    of Object.keys(record).sort()
  ) {
    result[key] =
      stableValue(
        record[key]
      );
  }

  return result;
}

function topologyProjection(
  layout: LayoutView
): unknown {
  const serialized =
    JSON.parse(
      JSON.stringify(layout)
    ) as SerializedLayoutDto;

  return (
    serialized.layers ?? []
  ).map(layer => ({
    elements:
      (layer.elements ?? [])
        .filter(isTopologyElement)
        .map(element => {
          const projected:
            Record<string, unknown> = {};

          for (const key of TOPOLOGY_FIELDS) {
            if (
              Object.prototype.hasOwnProperty.call(
                element,
                key
              )
            ) {
              projected[key] =
                stableValue(
                  element[key]
                );
            }
          }

          return projected;
        }),
  }));
}

function hash32(
  text: string,
  seed: number
): number {
  let hash =
    seed >>> 0;

  for (
    let index = 0;
    index < text.length;
    index += 1
  ) {
    hash ^=
      text.charCodeAt(index);

    hash =
      Math.imul(
        hash,
        16777619
      ) >>> 0;
  }

  return hash >>> 0;
}

export function computeClientTopologyFingerprint(
  layout: LayoutView
): string {
  const canonical =
    JSON.stringify(
      stableValue(
        topologyProjection(layout)
      )
    );

  const first =
    hash32(
      canonical,
      0x811c9dc5
    );

  const second =
    hash32(
      canonical,
      0x9e3779b9
    );

  return [
    "rt1",
    first
      .toString(16)
      .padStart(8, "0"),
    second
      .toString(16)
      .padStart(8, "0"),
    canonical.length.toString(16),
  ].join("-");
}

function graphToDto(
  result: ClientRouteGraphBuildResult
): RouteGraphDto {
  return {
    ready: true,
    nodes:
      result.graph.nodes.map(
        node => ({
          name: node.name,
          trackName:
            node.trackName,
          x: node.x,
          y: node.y,
          isVirtual:
            node.isVirtual,
          busy: node.busy,
          detectors:
            node.detectors.map(
              detector => ({
                ...detector,
              })
            ),
          signals:
            node.signals.map(
              signal => ({
                ...signal,
              })
            ),
          blocks:
            node.blocks.map(
              block => ({
                ...block,
              })
            ),
          elementIds: [
            ...node.elementIds,
          ],
        })
      ),
    edges:
      result.graph.edges.map(
        edge => ({
          from: edge.from.name,
          to: edge.to.name,
          turnoutStates:
            edge.turnoutStates.map(
              state => ({
                ...state,
              })
            ),
          turnoutPath:
            edge.turnoutPath.map(
              passage => ({
                elementId:
                  passage.elementId,
                name:
                  passage.name,
                turnoutStates:
                  passage.turnoutStates.map(
                    state => ({
                      ...state,
                    })
                  ),
              })
            ),
          locoDirection:
            edge.locoDirection,
        })
      ),
    trackRuntime:
      result.trackRuntime.map(
        item => ({
          ...item,
        })
      ),
  };
}

const MAX_ROUTE_VARIANTS_PER_BLOCK_PAIR = 128;
const MAX_PERSISTED_ROUTE_TABLE_ENTRIES = 10000;

function mergeRouteDirection(
  current: "unknown" | "forward" | "reverse",
  next: "unknown" | "forward" | "reverse"
): "unknown" | "forward" | "reverse" | null {
  if (current === "unknown") {
    return next;
  }

  if (next === "unknown") {
    return current;
  }

  return current === next
    ? current
    : null;
}

function mergeRouteTurnoutRequirements(
  current: Map<number, boolean>,
  edgeRequirements: TurnoutStateRequirement[]
): Map<number, boolean> | null {
  const merged =
    new Map(current);

  for (const requirement of edgeRequirements) {
    const existing =
      merged.get(
        requirement.address
      );

    if (
      existing !== undefined &&
      existing !== requirement.closed
    ) {
      return null;
    }

    merged.set(
      requirement.address,
      requirement.closed
    );
  }

  return merged;
}

function turnoutRequirementsToArray(
  requirements: Map<number, boolean>
): TurnoutStateRequirement[] {
  return [
    ...requirements.entries(),
  ]
    .sort(
      ([a], [b]) =>
        a - b
    )
    .map(
      ([address, closed]) => ({
        address,
        closed,
      })
    );
}

function buildPersistedBlockPath(
  nodes: GraphNode[],
  fromBlock: SectionBlock,
  toBlock: SectionBlock
): PersistedRouteBlockEntry[] {
  const result:
    PersistedRouteBlockEntry[] = [];

  const seen =
    new Set<number>();

  const push = (
    block: SectionBlock,
    nodeIndex: number
  ) => {
    if (
      seen.has(
        block.id
      )
    ) {
      return;
    }

    seen.add(
      block.id
    );

    result.push({
      id:
        block.id,
      name:
        block.name,
      nodeIndex,
    });
  };

  push(
    fromBlock,
    0
  );

  for (
    let nodeIndex = 0;
    nodeIndex < nodes.length;
    nodeIndex += 1
  ) {
    const node =
      nodes[nodeIndex];

    if (!node) {
      continue;
    }

    for (const block of node.blocks) {
      if (
        block.id === fromBlock.id ||
        block.id === toBlock.id
      ) {
        continue;
      }

      push(
        block,
        nodeIndex
      );
    }
  }

  push(
    toBlock,
    Math.max(
      0,
      nodes.length - 1
    )
  );

  return result;
}

function enumerateRouteVariantsForBlockPair(
  graph: ClientRouteGraphBuildResult["graph"],
  fromBlock: SectionBlock,
  toBlock: SectionBlock
): PersistedRouteTableEntry[] {
  const fromNode =
    graph.nodes.find(
      node =>
        node.blocks.some(
          block =>
            block.id === fromBlock.id
        )
    );

  const toNode =
    graph.nodes.find(
      node =>
        node.blocks.some(
          block =>
            block.id === toBlock.id
        )
    );

  if (
    !fromNode ||
    !toNode
  ) {
    return [];
  }

  if (
    fromNode === toNode
  ) {
    return [{
      fromBlockId:
        fromBlock.id,
      fromBlockName:
        fromBlock.name,
      toBlockId:
        toBlock.id,
      toBlockName:
        toBlock.name,
      blockPath:
        buildPersistedBlockPath(
          [fromNode],
          fromBlock,
          toBlock
        ),
      nodes: [
        fromNode.name,
      ],
      edgePath: [],
      turnoutStates: [],
      locoDirection:
        "unknown",
    }];
  }

  const result:
    PersistedRouteTableEntry[] = [];

  const seenVariants =
    new Set<string>();

  type SearchState = {
    node: GraphNode;
    nodes: GraphNode[];
    edges: Edge[];
    visited: Set<GraphNode>;
    turnoutRequirements:
      Map<number, boolean>;
    locoDirection:
      | "unknown"
      | "forward"
      | "reverse";
  };

  const stack:
    SearchState[] = [{
      node:
        fromNode,
      nodes: [
        fromNode,
      ],
      edges: [],
      visited:
        new Set([
          fromNode,
        ]),
      turnoutRequirements:
        new Map(),
      locoDirection:
        "unknown",
    }];

  while (
    stack.length > 0
  ) {
    const current =
      stack.pop()!;

    const outgoing =
      graph.edges.filter(
        edge =>
          edge.from === current.node
      );

    for (const edge of outgoing) {
      if (
        current.visited.has(
          edge.to
        )
      ) {
        continue;
      }

      const turnoutRequirements =
        mergeRouteTurnoutRequirements(
          current.turnoutRequirements,
          edge.turnoutStates
        );

      if (!turnoutRequirements) {
        continue;
      }

      const locoDirection =
        mergeRouteDirection(
          current.locoDirection,
          edge.locoDirection
        );

      /*
       * A complete route may never require forward on one part and reverse on
       * another. This is also the block-to-block direction consistency gate
       * used by Dispatcher checkpoint routes.
       */
      if (!locoDirection) {
        continue;
      }

      const nodes = [
        ...current.nodes,
        edge.to,
      ];

      const edges = [
        ...current.edges,
        edge,
      ];

      if (
        edge.to === toNode
      ) {
        const turnoutStates =
          turnoutRequirementsToArray(
            turnoutRequirements
          );

        const blockPath =
          buildPersistedBlockPath(
            nodes,
            fromBlock,
            toBlock
          );

        const variantKey =
          JSON.stringify({
            nodes:
              nodes.map(
                node =>
                  node.name
              ),
            edgePath:
              edges.map(
                routeEdge => ({
                  from:
                    routeEdge.from.name,
                  to:
                    routeEdge.to.name,
                  turnoutStates:
                    turnoutRequirementsToArray(
                      new Map(
                        routeEdge.turnoutStates.map(
                          state => [
                            state.address,
                            state.closed,
                          ] as const
                        )
                      )
                    ),
                  turnoutPath:
                    routeEdge.turnoutPath,
                  locoDirection:
                    routeEdge.locoDirection,
                })
              ),
            blockPath:
              blockPath.map(
                block =>
                  block.id
              ),
            turnoutStates,
            locoDirection,
          });

        if (
          seenVariants.has(
            variantKey
          )
        ) {
          continue;
        }

        seenVariants.add(
          variantKey
        );

        result.push({
          fromBlockId:
            fromBlock.id,
          fromBlockName:
            fromBlock.name,
          toBlockId:
            toBlock.id,
          toBlockName:
            toBlock.name,
          blockPath,
          nodes:
            nodes.map(
              node =>
                node.name
            ),
          edgePath:
            edges.map(
              routeEdge => ({
                from:
                  routeEdge.from.name,
                to:
                  routeEdge.to.name,
                turnoutStates:
                  turnoutRequirementsToArray(
                    new Map(
                      routeEdge.turnoutStates.map(
                        state => [
                          state.address,
                          state.closed,
                        ] as const
                      )
                    )
                  ),
                turnoutPath:
                  routeEdge.turnoutPath.map(
                    passage => ({
                      elementId:
                        passage.elementId,
                      name:
                        passage.name,
                      turnoutStates:
                        passage.turnoutStates.map(
                          state => ({
                            ...state,
                          })
                        ),
                    })
                  ),
                locoDirection:
                  routeEdge.locoDirection,
              })
            ),
          turnoutStates,
          locoDirection,
        });

        if (
          result.length >
            MAX_ROUTE_VARIANTS_PER_BLOCK_PAIR
        ) {
          throw new Error(
            `Too many route variants between blocks "${fromBlock.name}" and "${toBlock.name}". ` +
            `Limit is ${MAX_ROUTE_VARIANTS_PER_BLOCK_PAIR}. Add topology constraints before saving.`
          );
        }

        continue;
      }

      const visited =
        new Set(
          current.visited
        );

      visited.add(
        edge.to
      );

      stack.push({
        node:
          edge.to,
        nodes,
        edges,
        visited,
        turnoutRequirements,
        locoDirection,
      });
    }
  }

  return result;
}

function routeTableFromResult(
  result: ClientRouteGraphBuildResult
): PersistedRouteTableEntry[] {
  const blocks =
    result.graph.nodes.flatMap(
      node =>
        node.blocks
    );

  const table:
    PersistedRouteTableEntry[] = [];

  for (const fromBlock of blocks) {
    for (const toBlock of blocks) {
      if (
        fromBlock.id ===
          toBlock.id
      ) {
        continue;
      }

      const variants =
        enumerateRouteVariantsForBlockPair(
          result.graph,
          fromBlock,
          toBlock
        );

      table.push(
        ...variants
      );

      if (
        table.length >
          MAX_PERSISTED_ROUTE_TABLE_ENTRIES
      ) {
        throw new Error(
          `Generated route table is too large (${table.length} entries). ` +
          `Limit is ${MAX_PERSISTED_ROUTE_TABLE_ENTRIES}.`
        );
      }
    }
  }

  return table.sort(
    (a, b) =>
      a.fromBlockId - b.fromBlockId ||
      a.toBlockId - b.toBlockId ||
      a.blockPath.length - b.blockPath.length ||
      a.nodes.join("|").localeCompare(
        b.nodes.join("|")
      )
  );
}

function createPersistedState(
  result: ClientRouteGraphBuildResult,
  fingerprint: string,
  topologyRevision: number
): PersistedClientRouteTopology {
  return {
    version:
      ROUTE_TOPOLOGY_VERSION,
    fingerprint,
    topologyRevision,
    graphRevision:
      topologyRevision,
    graph:
      graphToDto(result),
    routeTable:
      routeTableFromResult(
        result
      ),
  };
}

function validPositiveRevision(
  value: unknown
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function parsePersistedState(
  rawLayout: unknown
): PersistedClientRouteTopology | null {
  const layout =
    asRecord(rawLayout);

  const candidate =
    asRecord(
      layout?.[
        ROUTE_TOPOLOGY_FIELD
      ]
    );

  if (!candidate) {
    return null;
  }

  if (
    candidate.version !==
      ROUTE_TOPOLOGY_VERSION ||
    typeof candidate.fingerprint !==
      "string" ||
    !validPositiveRevision(
      candidate.topologyRevision
    ) ||
    !validPositiveRevision(
      candidate.graphRevision
    )
  ) {
    return null;
  }

  const graph =
    asRecord(
      candidate.graph
    );

  if (
    !graph ||
    graph.ready !== true ||
    !Array.isArray(
      graph.nodes
    ) ||
    !Array.isArray(
      graph.edges
    ) ||
    !Array.isArray(
      graph.trackRuntime
    )
  ) {
    return null;
  }

  const routeTable =
    Array.isArray(
      candidate.routeTable
    )
      ? candidate.routeTable
      : [];

  return {
    version:
      ROUTE_TOPOLOGY_VERSION,
    fingerprint:
      candidate.fingerprint,
    topologyRevision:
      candidate.topologyRevision,
    graphRevision:
      candidate.graphRevision,
    graph:
      candidate.graph as RouteGraphDto,
    routeTable:
      routeTable as PersistedRouteTableEntry[],
  };
}

function resultFromPersisted(
  persisted: PersistedClientRouteTopology
): ClientRouteGraphBuildResult {
  const graph =
    createClientGraphFromRouteGraphDto(
      persisted.graph
    );

  return {
    graph,
    trackRuntime:
      persisted.graph.trackRuntime.map(
        item => ({
          ...item,
        })
      ),
    routes:
      graph.getRunnableBlockRoutes(),
  };
}

/**
 * Hydrate the in-memory graph cache from layout.json.
 *
 * If the stored fingerprint no longer matches the actual layout, the stored
 * graph is NOT trusted. We only carry its revision forward so the next build
 * receives a newer topology revision.
 */
export function hydrateClientRouteGraphCache(
  layout: LayoutView,
  rawLayout: unknown
): boolean {
  const persisted =
    parsePersistedState(
      rawLayout
    );

  if (!persisted) {
    cache.delete(layout);
    return false;
  }

  const currentFingerprint =
    computeClientTopologyFingerprint(
      layout
    );

  if (
    persisted.fingerprint !==
      currentFingerprint ||
    persisted.graphRevision !==
      persisted.topologyRevision
  ) {
    const nextRevision =
      Math.max(
        persisted.topologyRevision,
        persisted.graphRevision
      ) + 1;

    cache.set(
      layout,
      {
        fingerprint:
          currentFingerprint,
        topologyRevision:
          nextRevision,
        graphRevision:
          persisted.graphRevision,
        result: null,
        persisted: null,
      }
    );

    return false;
  }

  const result =
    resultFromPersisted(
      persisted
    );

  /*
   * Restore section / travelDirection from the graph as well. The element DTO
   * already persists these fields, but this makes the persisted graph
   * authoritative even for older layout files that have routeTopology but no
   * per-element generated metadata.
   */
  layout.applyRouteGraphRuntime(
    result.trackRuntime
  );

  cache.set(
    layout,
    {
      fingerprint:
        currentFingerprint,
      topologyRevision:
        persisted.topologyRevision,
      graphRevision:
        persisted.graphRevision,
      result,
      persisted,
    }
  );

  return true;
}

export function isClientRouteGraphDirty(
  layout: LayoutView
): boolean {
  const entry =
    cache.get(layout);

  const fingerprint =
    computeClientTopologyFingerprint(
      layout
    );

  return (
    !entry ||
    !entry.result ||
    entry.fingerprint !==
      fingerprint ||
    entry.graphRevision !==
      entry.topologyRevision
  );
}

/**
 * Build only when the topology fingerprint changed, unless force=true.
 *
 * This is the authoritative gate used by Save and by the Routes dialog.
 */
export function ensureClientRouteGraph(
  layout: LayoutView,
  options: {
    force?: boolean;
  } = {}
): ClientRouteGraphEnsureResult {
  const fingerprint =
    computeClientTopologyFingerprint(
      layout
    );

  const previous =
    cache.get(layout);

  const fingerprintChanged =
    previous !== undefined &&
    previous.fingerprint !==
      fingerprint;

  if (
    !options.force &&
    previous?.result &&
    !fingerprintChanged &&
    previous.graphRevision ===
      previous.topologyRevision
  ) {
    return {
      result:
        previous.result,
      rebuilt: false,
      topologyRevision:
        previous.topologyRevision,
      graphRevision:
        previous.graphRevision,
      fingerprint,
    };
  }

  let topologyRevision = 1;

  if (previous) {
    topologyRevision =
      fingerprintChanged
        ? previous.topologyRevision + 1
        : Math.max(
            1,
            previous.topologyRevision
          );
  }

  const result =
    buildClientRouteGraph(
      layout
    );

  const persisted =
    createPersistedState(
      result,
      fingerprint,
      topologyRevision
    );

  cache.set(
    layout,
    {
      fingerprint,
      topologyRevision,
      graphRevision:
        topologyRevision,
      result,
      persisted,
    }
  );

  return {
    result,
    rebuilt: true,
    topologyRevision,
    graphRevision:
      topologyRevision,
    fingerprint,
  };
}

/**
 * Add the current generated graph + route table + revisions to the plain JSON
 * object that is about to be saved/exported.
 *
 * Save calls ensureClientRouteGraph() first, therefore this function normally
 * always has a fresh cache entry.
 */
export function attachClientRouteTopologyToLayoutJson(
  layout: LayoutView,
  plainLayout:
    Record<string, unknown>
): void {
  const entry =
    cache.get(layout);

  const fingerprint =
    computeClientTopologyFingerprint(
      layout
    );

  if (
    !entry?.persisted ||
    !entry.result ||
    entry.fingerprint !==
      fingerprint ||
    entry.graphRevision !==
      entry.topologyRevision
  ) {
    delete plainLayout[
      ROUTE_TOPOLOGY_FIELD
    ];

    return;
  }

  plainLayout[
    ROUTE_TOPOLOGY_FIELD
  ] =
    entry.persisted;
}


/**
 * Returns the current client graph only when it is definitely fresh for the
 * actual layout topology. Unlike ensureClientRouteGraph(), this NEVER builds.
 *
 * Used by the lightweight Paths test panel so merely opening the tab does not
 * trigger route generation.
 */
export function getFreshClientRouteGraphResult(
  layout: LayoutView
): ClientRouteGraphBuildResult | null {
  const entry =
    cache.get(layout);

  if (
    !entry?.result ||
    entry.graphRevision !==
      entry.topologyRevision
  ) {
    return null;
  }

  const fingerprint =
    computeClientTopologyFingerprint(
      layout
    );

  if (
    entry.fingerprint !==
      fingerprint
  ) {
    return null;
  }

  return entry.result;
}

export function getClientRouteGraphRevision(
  layout: LayoutView
): {
  topologyRevision: number;
  graphRevision: number;
} | null {
  const entry =
    cache.get(layout);

  if (!entry) {
    return null;
  }

  return {
    topologyRevision:
      entry.topologyRevision,
    graphRevision:
      entry.graphRevision,
  };
}
