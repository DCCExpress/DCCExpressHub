import type {
  SerializedLayoutDto,
} from "../domain/layout/layoutDto";

import type {
  MovementPage,
  MovementSensorCondition,
} from "../domain/movement";

type RawTurnoutState = {
  address: number;
  closed: boolean;
};

type RawTurnoutPassage = {
  elementId?: number;
  name?: string;
  turnoutStates?: RawTurnoutState[];
};

type RawRouteEdge = {
  from: string;
  to: string;
  turnoutStates?: RawTurnoutState[];
  turnoutPath?: RawTurnoutPassage[];
  locoDirection?:
    | "unknown"
    | "forward"
    | "reverse";
};

type RawBlockPathEntry = {
  id: number;
  name: string;
  nodeIndex: number;
};

type RawRouteEntry = {
  fromBlockId: number;
  fromBlockName: string;
  toBlockId: number;
  toBlockName: string;
  blockPath: RawBlockPathEntry[];
  nodes: string[];
  edgePath: RawRouteEdge[];
  locoDirection:
    | "unknown"
    | "forward"
    | "reverse";
};

type RawGraphNode = {
  name: string;
  trackName?: string;
  elementIds?: number[];
  detectors?: Array<{
    id: number;
    address: number;
    label: string;
  }>;
};

type RawRouteTopology = {
  version: number;
  fingerprint?: string;
  graph?: {
    ready?: boolean;
    nodes?: RawGraphNode[];
  };
  routeTable?: RawRouteEntry[];
};

export type MovementPlanResourceKind =
  | "block"
  | "segment"
  | "turnout";

export type MovementPlanResource = {
  key: string;
  kind:
    MovementPlanResourceKind;
  name: string;
  label: string;
  blockId: number | null;
  sensorAddress: number | null;
  nodeIndex: number | null;
  detectors: number[];
  turnoutStates:
    RawTurnoutState[];
};

export type MovementPlanLeg = {
  index: number;
  from:
    MovementPlanResource;
  to:
    MovementPlanResource;
  resources:
    MovementPlanResource[];
  turnoutStates:
    RawTurnoutState[];
  approachWhen:
    MovementSensorCondition[];
  approachDelayMs: number;
  departWhen:
    MovementSensorCondition[];
  leaveWhen:
    MovementSensorCondition[];
  leaveWhenExplicit:
    boolean;
  leaveDelayMs: number;
  arrivedWhen:
    MovementSensorCondition[];
  arrivedDelayMs: number;
};

export type MovementPlan = {
  topologyVersion: number;
  topologyFingerprint: string;
  direction:
    | "unknown"
    | "forward"
    | "reverse";
  resources:
    MovementPlanResource[];
  blocks:
    MovementPlanResource[];
  legs:
    MovementPlanLeg[];
};

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value ===
      "object" &&
    value !==
      null &&
    !Array.isArray(
      value
    )
  );
}

function asPositiveInteger(
  value: unknown
): number | null {
  const numeric =
    Number(value);

  return (
    Number.isInteger(
      numeric
    ) &&
    numeric >= 1 &&
    numeric <= 65535
  )
    ? numeric
    : null;
}

function trackAddressMap(
  layout:
    SerializedLayoutDto
): Map<number, number> {
  const result =
    new Map<
      number,
      number
    >();

  for (
    const layer of
    layout.layers ??
    []
  ) {
    for (
      const element of
      layer.elements ??
      []
    ) {
      const type =
        String(
          element.type ??
          ""
        );

      if (
        !type.startsWith(
          "track"
        ) ||
        type ===
          "tracksignal" ||
        type ===
          "tracksignal2" ||
        type ===
          "tracksignal3" ||
        type ===
          "tracksignal4"
      ) {
        continue;
      }

      const id =
        asPositiveInteger(
          element.id
        );

      const address =
        asPositiveInteger(
          element.address
        );

      if (
        id !== null &&
        address !== null
      ) {
        result.set(
          id,
          address
        );
      }
    }
  }

  return result;
}

function blockSensorMap(
  layout:
    SerializedLayoutDto
): Map<number, number> {
  const result =
    new Map<
      number,
      number
    >();

  for (
    const layer of
    layout.layers ??
    []
  ) {
    for (
      const element of
      layer.elements ??
      []
    ) {
      if (
        element.type !==
        "trackblock"
      ) {
        continue;
      }

      const id =
        asPositiveInteger(
          element.id
        );

      const sensor =
        asPositiveInteger(
          element.sensorAddress
        );

      if (
        id !== null &&
        sensor !== null
      ) {
        result.set(
          id,
          sensor
        );
      }
    }
  }

  return result;
}

function checkpointIds(
  page:
    MovementPage
): number[] {
  if (!page.routeRef) {
    throw new Error(
      "Movement requires a selected route."
    );
  }

  return [
    page.routeRef.fromBlockId,
    ...page.routeRef.viaBlockIds,
    page.routeRef.toBlockId,
  ];
}

function containsCheckpointsInOrder(
  route:
    RawRouteEntry,
  checkpoints:
    number[]
): boolean {
  let checkpointIndex =
    0;

  for (
    const block of
    route.blockPath
  ) {
    if (
      block.id ===
      checkpoints[
        checkpointIndex
      ]
    ) {
      checkpointIndex +=
        1;

      if (
        checkpointIndex ===
        checkpoints.length
      ) {
        return true;
      }
    }
  }

  return false;
}

function parseTopology(
  layout: unknown
): RawRouteTopology {
  if (
    !isRecord(
      layout
    )
  ) {
    throw new Error(
      "Layout is not a JSON object."
    );
  }

  const raw =
    layout.routeTopology;

  if (
    !isRecord(
      raw
    )
  ) {
    throw new Error(
      "No route topology is available. Generate the route graph first."
    );
  }

  const topology =
    raw as RawRouteTopology;

  if (
    topology.version !==
      2 &&
    topology.version !==
      3
  ) {
    throw new Error(
      "Unsupported route topology. Regenerate and save the route graph."
    );
  }

  if (
    !Array.isArray(
      topology.routeTable
    ) ||
    !isRecord(
      topology.graph
    ) ||
    topology.graph.ready !==
      true ||
    !Array.isArray(
      topology.graph.nodes
    )
  ) {
    throw new Error(
      "Saved route topology is incomplete. Regenerate and save the route graph."
    );
  }

  return topology;
}

function selectRoute(
  page:
    MovementPage,
  topology:
    RawRouteTopology
): RawRouteEntry {
  const routeRef =
    page.routeRef;

  if (!routeRef) {
    throw new Error(
      "Movement requires a selected route."
    );
  }

  const routeTable =
    topology.routeTable ??
    [];

  const checkpoints =
    checkpointIds(
      page
    );

  const candidates =
    routeTable.filter(
      route =>
        route.fromBlockId ===
          routeRef.fromBlockId &&
        route.toBlockId ===
          routeRef.toBlockId &&
        route.locoDirection ===
          routeRef.direction &&
        containsCheckpointsInOrder(
          route,
          checkpoints
        )
    );

  if (
    candidates.length ===
    0
  ) {
    throw new Error(
      "The selected Movement route no longer exists in the saved route topology."
    );
  }

  if (
    candidates.length >
    1
  ) {
    throw new Error(
      "Movement route is ambiguous for the saved route reference."
    );
  }

  return candidates[0]!;
}

function uniqueTurnoutStates(
  states:
    RawTurnoutState[]
): RawTurnoutState[] {
  const result =
    new Map<
      number,
      boolean
    >();

  for (const state of states) {
    const address =
      asPositiveInteger(
        state.address
      );

    if (
      address ===
      null
    ) {
      continue;
    }

    result.set(
      address,
      state.closed ===
        true
    );
  }

  return [
    ...result.entries(),
  ].map(
    ([
      address,
      closed,
    ]) => ({
      address,
      closed,
    })
  );
}

function fallbackPassages(
  edge:
    RawRouteEdge
): RawTurnoutPassage[] {
  return (
    edge.turnoutStates ??
    []
  ).map(
    state => ({
      elementId: 0,
      name:
        `Turnout ${state.address}`,
      turnoutStates: [
        state,
      ],
    })
  );
}

function blockEventConditionsFor(
  layout:
    SerializedLayoutDto,
  blockId: number,
  direction:
    | "unknown"
    | "forward"
    | "reverse",
  event:
    | "arrival"
    | "arrived"
    | "leave"
): MovementSensorCondition[] {
  if (
    direction ===
      "unknown"
  ) {
    return [];
  }

  for (
    const layer of
    layout.layers ??
    []
  ) {
    for (
      const element of
      layer.elements ??
      []
    ) {
      if (
        element.type !==
          "trackblock" ||
        Number(
          element.id
        ) !== blockId
      ) {
        continue;
      }

      const conditions =
        element.eventConfig?.[
          direction
        ]?.[
          event
        ] ??
        [];

      return conditions.map(
        (
          condition,
          index
        ) => ({
          id:
            `block-event-${blockId}-${direction}-${event}-${index}`,
          sensor:
            condition.sensor,
          state:
            condition.state,
        })
      );
    }
  }

  return [];
}

function blockEventDelayFor(
  layout:
    SerializedLayoutDto,
  blockId: number,
  direction:
    | "unknown"
    | "forward"
    | "reverse",
  event:
    | "arrival"
    | "arrived"
    | "leave"
): number {
  if (
    direction ===
      "unknown"
  ) {
    return 0;
  }

  const key =
    event === "arrival"
      ? "arrivalDelayMs"
      : event === "arrived"
        ? "arrivedDelayMs"
        : "leaveDelayMs";

  for (
    const layer of
    layout.layers ??
    []
  ) {
    for (
      const element of
      layer.elements ??
      []
    ) {
      if (
        element.type !==
          "trackblock" ||
        Number(
          element.id
        ) !== blockId
      ) {
        continue;
      }

      const raw =
        element.eventConfig?.[
          direction
        ]?.[
          key
        ];

      const numeric =
        Math.round(
          Number(
            raw ??
            0
          )
        );

      return Number.isFinite(
        numeric
      )
        ? Math.max(
            0,
            Math.min(
              600000,
              numeric
            )
          )
        : 0;
    }
  }

  return 0;
}

function approachRuleFor(
  _page:
    MovementPage,
  blockId: number,
  layout:
    SerializedLayoutDto,
  direction:
    | "unknown"
    | "forward"
    | "reverse"
): MovementSensorCondition[] {
  return blockEventConditionsFor(
    layout,
    blockId,
    direction,
    "arrival"
  );
}

function departureRuleFor(
  _page:
    MovementPage,
  _blockId: number
): MovementSensorCondition[] {
  return [];
}

function leaveRuleFor(
  _page:
    MovementPage,
  blockId: number,
  sensors:
    Map<number, number>,
  layout:
    SerializedLayoutDto,
  direction:
    | "unknown"
    | "forward"
    | "reverse"
): {
  conditions:
    MovementSensorCondition[];
  explicit: boolean;
} {
  const configured =
    blockEventConditionsFor(
      layout,
      blockId,
      direction,
      "leave"
    );

  if (
    configured.length >
      0
  ) {
    return {
      conditions:
        configured,
      explicit:
        true,
    };
  }

  const sourceSensor =
    sensors.get(
      blockId
    );

  return {
    conditions:
      sourceSensor ===
        undefined
        ? []
        : [{
            id:
              `auto-leave-${blockId}-off`,
            sensor:
              sourceSensor,
            state:
              false,
          }],
    explicit:
      false,
  };
}

function arrivalRuleFor(
  _page:
    MovementPage,
  blockId: number,
  sensors:
    Map<number, number>,
  layout:
    SerializedLayoutDto,
  direction:
    | "unknown"
    | "forward"
    | "reverse"
): MovementSensorCondition[] {
  const configured =
    blockEventConditionsFor(
      layout,
      blockId,
      direction,
      "arrived"
    );

  if (
    configured.length >
      0
  ) {
    return configured;
  }

  const destinationSensor =
    sensors.get(
      blockId
    );

  if (
    destinationSensor ===
    undefined
  ) {
    return [];
  }

  return [{
    id:
      `auto-arrival-${blockId}-on`,
    sensor:
      destinationSensor,
    state: true,
  }];
}

export function buildMovementPlan(
  page:
    MovementPage,
  layout:
    SerializedLayoutDto
): MovementPlan {
  const topology =
    parseTopology(
      layout
    );

  const route =
    selectRoute(
      page,
      topology
    );

  const graphNodes =
    new Map<
      string,
      RawGraphNode
    >(
      (
        topology.graph?.nodes ??
        []
      ).map(
        node => [
          node.name,
          node,
        ]
      )
    );

  const sensors =
    blockSensorMap(
      layout
    );

  const trackAddresses =
    trackAddressMap(
      layout
    );

  const resources:
    MovementPlanResource[] =
    [];

  const blocks:
    MovementPlanResource[] =
    [];

  const pushBlock =
    (
      entry:
        RawBlockPathEntry
    ): void => {
      const resource:
        MovementPlanResource = {
        key:
          `block:${entry.id}`,
        kind:
          "block",
        name:
          entry.name,
        label:
          entry.name,
        blockId:
          entry.id,
        sensorAddress:
          sensors.get(
            entry.id
          ) ??
          null,
        nodeIndex:
          entry.nodeIndex,
        detectors: [],
        turnoutStates: [],
      };

      resources.push(
        resource
      );

      blocks.push(
        resource
      );
    };

  const source =
    route.blockPath[0];

  if (!source) {
    throw new Error(
      "Movement route has no source block."
    );
  }

  pushBlock(
    source
  );

  for (
    let nodeIndex = 0;
    nodeIndex <
      route.nodes.length;
    nodeIndex += 1
  ) {
    const nodeName =
      route.nodes[
        nodeIndex
      ];

    if (!nodeName) {
      continue;
    }

    const node =
      graphNodes.get(
        nodeName
      );

    resources.push({
      key:
        `segment:${nodeName}`,
      kind:
        "segment",
      name:
        nodeName,
      label:
        node?.trackName?.trim()
          ? `${nodeName} · ${node.trackName.trim()}`
          : nodeName,
      blockId: null,
      sensorAddress: null,
      nodeIndex,
      detectors:
        [
          ...new Set([
            ...(
              node?.detectors ??
              []
            )
              .map(
                detector =>
                  detector.address
              )
              .filter(
                address =>
                  Number.isInteger(
                    address
                  ) &&
                  address > 0
              ),
            ...(
              node?.elementIds ??
              []
            )
              .map(
                elementId =>
                  trackAddresses.get(
                    elementId
                  ) ??
                  0
              )
              .filter(
                address =>
                  address > 0
              ),
          ]),
        ].sort(
          (
            a,
            b
          ) =>
            a - b
        ),
      turnoutStates: [],
    });

    for (
      const block of
      route.blockPath
    ) {
      if (
        block.nodeIndex !==
          nodeIndex ||
        block.id ===
          source.id ||
        block.id ===
          route.blockPath[
            route.blockPath.length -
            1
          ]?.id
      ) {
        continue;
      }

      if (
        blocks.some(
          existing =>
            existing.blockId ===
            block.id
        )
      ) {
        continue;
      }

      pushBlock(
        block
      );
    }

    const edge =
      route.edgePath[
        nodeIndex
      ];

    if (!edge) {
      continue;
    }

    const passages =
      edge.turnoutPath &&
      edge.turnoutPath.length >
        0
        ? edge.turnoutPath
        : fallbackPassages(
            edge
          );

    for (
      let passageIndex = 0;
      passageIndex <
        passages.length;
      passageIndex += 1
    ) {
      const passage =
        passages[
          passageIndex
        ];

      if (!passage) {
        continue;
      }

      const elementId =
        asPositiveInteger(
          passage.elementId
        );

      const turnoutStates =
        uniqueTurnoutStates(
          passage.turnoutStates ??
          []
        );

      const fallbackAddress =
        turnoutStates[0]?.address ??
        passageIndex +
          1;

      resources.push({
        key:
          elementId !==
          null
            ? `turnout:${elementId}`
            : `turnout:${edge.from}:${edge.to}:${passageIndex}`,
        kind:
          "turnout",
        name:
          String(
            passage.name ??
            `Turnout ${fallbackAddress}`
          ),
        label:
          String(
            passage.name ??
            `Turnout ${fallbackAddress}`
          ),
        blockId: null,
        sensorAddress:
          elementId !==
            null
            ? trackAddresses.get(
                elementId
              ) ??
              null
            : null,
        nodeIndex,
        detectors:
          elementId !==
            null &&
          (
            trackAddresses.get(
              elementId
            ) ??
            0
          ) >
            0
            ? [
                trackAddresses.get(
                  elementId
                )!,
              ]
            : [],
        turnoutStates,
      });
    }
  }

  const destination =
    route.blockPath[
      route.blockPath.length -
      1
    ];

  if (
    destination &&
    !blocks.some(
      block =>
        block.blockId ===
        destination.id
    )
  ) {
    pushBlock(
      destination
    );
  }

  const legs:
    MovementPlanLeg[] = [];

  for (
    let index = 0;
    index <
      blocks.length - 1;
    index += 1
  ) {
    const from =
      blocks[index];

    const to =
      blocks[index + 1];

    if (
      !from ||
      !to ||
      from.nodeIndex ===
        null ||
      to.nodeIndex ===
        null
    ) {
      continue;
    }

    const legResources =
      resources.filter(
        resource => {
          if (
            resource.nodeIndex ===
              null ||
            resource.key ===
              from.key ||
            resource.key ===
              to.key
          ) {
            return false;
          }

          if (
            resource.kind ===
            "segment"
          ) {
            /*
             * The source block's section is already occupied/entered.
             * Replaying ENTER on it at every new leg would duplicate actions.
             */
            return (
              resource.nodeIndex >
                from.nodeIndex! &&
              resource.nodeIndex <=
                to.nodeIndex!
            );
          }

          if (
            resource.kind ===
            "turnout"
          ) {
            /*
             * A turnout passage belongs to the edge leaving its node.
             */
            return (
              resource.nodeIndex >=
                from.nodeIndex! &&
              resource.nodeIndex <
                to.nodeIndex!
            );
          }

          return false;
        }
      );

    const turnoutStates =
      uniqueTurnoutStates(
        legResources.flatMap(
          resource =>
            resource.turnoutStates
        )
      );

    const leaveRule =
      leaveRuleFor(
        page,
        from.blockId!,
        sensors,
        layout,
        route.locoDirection
      );

    legs.push({
      index,
      from,
      to,
      resources:
        legResources,
      turnoutStates,
      approachWhen:
        approachRuleFor(
          page,
          to.blockId!,
          layout,
          route.locoDirection
        ),
      approachDelayMs:
        blockEventDelayFor(
          layout,
          to.blockId!,
          route.locoDirection,
          "arrival"
        ),
      departWhen:
        departureRuleFor(
          page,
          from.blockId!
        ),
      leaveWhen:
        leaveRule.conditions,
      leaveWhenExplicit:
        leaveRule.explicit,
      leaveDelayMs:
        blockEventDelayFor(
          layout,
          from.blockId!,
          route.locoDirection,
          "leave"
        ),
      arrivedWhen:
        arrivalRuleFor(
          page,
          to.blockId!,
          sensors,
          layout,
          route.locoDirection
        ),
      arrivedDelayMs:
        blockEventDelayFor(
          layout,
          to.blockId!,
          route.locoDirection,
          "arrived"
        ),
    });
  }

  return {
    topologyVersion:
      topology.version,
    topologyFingerprint:
      String(
        topology.fingerprint ??
        ""
      ),
    direction:
      route.locoDirection,
    resources,
    blocks,
    legs,
  };
}

export async function loadMovementPlan(
  page:
    MovementPage,
  layoutOverride?:
    SerializedLayoutDto
): Promise<MovementPlan> {
  if (layoutOverride) {
    return buildMovementPlan(
      page,
      layoutOverride
    );
  }

  const response =
    await fetch(
      "/api/layout",
      {
        cache:
          "no-store",
      }
    );

  if (!response.ok) {
    throw new Error(
      `Layout could not be loaded (${response.status}).`
    );
  }

  const layout =
    await response.json() as
      SerializedLayoutDto;

  return buildMovementPlan(
    page,
    layout
  );
}
