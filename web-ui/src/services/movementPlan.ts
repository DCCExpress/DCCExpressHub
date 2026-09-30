import type {
  SerializedLayoutDto,
} from "../domain/layout/layoutDto";

import type {
  MovementPage,
  MovementSensorCondition,
} from "../domain/movement";

import {
  createMovementRouteKey,
} from "./movementRouteIdentity";

import {
  computeSerializedTopologyFingerprint,
} from "./clientRouteGraphCache";

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

type RawRoutePart = {
  nodeName: string;
  partKey: string;
  partIndex: number;
  fromSensor: number | null;
  toSensor: number | null;
  detectors?: number[];
  blockIds?: number[];
  locoDirection?:
    | "unknown"
    | "forward"
    | "reverse";
};

type RawRouteEntry = {
  fromBlockId: number;
  fromBlockName: string;
  toBlockId: number;
  toBlockName: string;
  blockPath: RawBlockPathEntry[];
  nodes: string[];
  partPath?: RawRoutePart[];
  edgePath: RawRouteEdge[];
  locoDirection:
    | "unknown"
    | "forward"
    | "reverse";
};

type RawGraphSectionPart = {
  key: string;
  index: number;
  fromSensor: number | null;
  toSensor: number | null;
  detectors?: number[];
  blockIds?: number[];
  locoDirection?:
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
  sectionParts?: RawGraphSectionPart[];
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
  routeOrder: number;
  partIndex: number | null;
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
  departWhen:
    MovementSensorCondition[];
  leaveWhen:
    MovementSensorCondition[];
  leaveWhenExplicit:
    boolean;
  arrivedWhen:
    MovementSensorCondition[];
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
  if (
    page.fromBlockId ===
      null ||
    page.toBlockId ===
      null
  ) {
    throw new Error(
      "Movement requires FROM and TO blocks."
    );
  }

  return [
    page.fromBlockId,
    ...page.viaBlockIds,
    page.toBlockId,
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
      3 &&
    topology.version !==
      4
  ) {
    throw new Error(
      "Unsupported route topology. Regenerate and save the route graph."
    );
  }

  const expectedFingerprint =
    String(
      topology.fingerprint ??
      ""
    );

  if (
    expectedFingerprint.length >
      0 &&
    expectedFingerprint !==
      computeSerializedTopologyFingerprint(
        layout as SerializedLayoutDto
      )
  ) {
    throw new Error(
      "Saved route graph is out of date for the current layout. Regenerate and save the route graph before starting Movement."
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
  const routeTable =
    topology.routeTable ??
    [];

  if (
    page.routeKey.trim().length >
      0
  ) {
    const exact =
      routeTable.find(
        route =>
          createMovementRouteKey(
            route
          ) ===
          page.routeKey
      );

    if (exact) {
      return exact;
    }

    throw new Error(
      "The selected Movement route no longer exists in the saved route topology. Select the route again."
    );
  }

  const checkpoints =
    checkpointIds(
      page
    );

  const first =
    checkpoints[0]!;

  const last =
    checkpoints[
      checkpoints.length -
      1
    ]!;

  const candidates =
    routeTable.filter(
      route =>
        route.fromBlockId ===
          first &&
        route.toBlockId ===
          last &&
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
      "Movement route not found for the selected FROM / VIA / TO blocks."
    );
  }

  if (
    candidates.length >
    1
  ) {
    throw new Error(
      "Movement route is ambiguous. Select an exact generated route in the Movement editor."
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

function explicitBlockRuleFor(
  page:
    MovementPage,
  blockId: number
) {
  return page.blockRules.find(
    rule =>
      rule.blockId ===
      blockId
  );
}

function approachRuleFor(
  page:
    MovementPage,
  blockId: number
): MovementSensorCondition[] {
  return (
    explicitBlockRuleFor(
      page,
      blockId
    )?.approachWhen ??
    []
  ).map(
    condition => ({
      ...condition,
    })
  );
}

function departureRuleFor(
  page:
    MovementPage,
  blockId: number
): MovementSensorCondition[] {
  return (
    explicitBlockRuleFor(
      page,
      blockId
    )?.departWhen ??
    []
  ).map(
    condition => ({
      ...condition,
    })
  );
}

function leaveRuleFor(
  page:
    MovementPage,
  blockId: number,
  sensors:
    Map<number, number>
): {
  conditions:
    MovementSensorCondition[];
  explicit: boolean;
} {
  const explicit =
    explicitBlockRuleFor(
      page,
      blockId
    );

  if (
    explicit &&
    explicit.leaveWhen.length >
      0
  ) {
    return {
      conditions:
        explicit.leaveWhen.map(
          condition => ({
            ...condition,
          })
        ),
      explicit:
        true,
    };
  }

  const sensor =
    sensors.get(
      blockId
    );

  if (
    sensor ===
    undefined
  ) {
    return {
      conditions: [],
      explicit:
        false,
    };
  }

  return {
    conditions: [{
      id:
        `auto-leave-${blockId}-off`,
      sensor,
      state:
        false,
    }],
    explicit:
      false,
  };
}

function arrivalRuleFor(
  page:
    MovementPage,
  blockId: number,
  sensors:
    Map<number, number>
): MovementSensorCondition[] {
  const explicit =
    explicitBlockRuleFor(
      page,
      blockId
    );

  if (
    explicit &&
    explicit.arrivedWhen.length >
      0
  ) {
    return explicit.arrivedWhen.map(
      condition => ({
        ...condition,
      })
    );
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
        routeOrder: 0,
        partIndex: null,
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

  const partPath =
    Array.isArray(
      route.partPath
    )
      ? route.partPath
      : [];

  const usesSectionParts =
    partPath.length >
      0;

  if (
    usesSectionParts
  ) {
    const pushPart =
      (
        part:
          RawRoutePart,
        nodeIndex:
          number
      ): void => {
        resources.push({
          key:
            `part:${part.nodeName}:${part.partKey}`,
          kind:
            "segment",
          name:
            part.partKey,
          label:
            `${part.nodeName} · ${part.partKey}`,
          blockId:
            null,
          sensorAddress:
            null,
          nodeIndex,
          detectors:
            (
              part.toSensor !==
                null
                ? [
                    part.toSensor,
                  ]
                : (
                    part.detectors ??
                    []
                  )
            )
              .filter(
                (
                  value
                ): value is number =>
                  Number.isInteger(
                    value
                  ) &&
                  Number(
                    value
                  ) >
                    0
              )
              .slice(
                0,
                1
              ),
          turnoutStates: [],
          routeOrder: 0,
          partIndex:
            Number.isInteger(
              part.partIndex
            )
              ? part.partIndex
              : null,
        });
      };

    const sourceSensor =
      sensors.get(
        source.id
      ) ??
      null;

    const sourceNodeName =
      route.nodes[
        source.nodeIndex
      ] ??
      route.nodes[0] ??
      "";

    const sourceNode =
      graphNodes.get(
        sourceNodeName
      );

    const firstRoutePart =
      partPath.find(
        part =>
          part.nodeName ===
            sourceNodeName
      );

    let sourceIncomingPart:
      RawRoutePart |
      null =
      null;

    if (
      sourceSensor !==
        null &&
      sourceNode &&
      firstRoutePart
    ) {
      const canonicalFirst =
        (
          sourceNode.sectionParts ??
          []
        ).find(
          part =>
            part.key ===
              firstRoutePart.partKey
        );

      const reversed =
        canonicalFirst
          ? (
              canonicalFirst.fromSensor ===
                firstRoutePart.toSensor &&
              canonicalFirst.toSensor ===
                firstRoutePart.fromSensor
            )
          : false;

      const incoming =
        (
          sourceNode.sectionParts ??
          []
        ).find(
          part =>
            reversed
              ? part.fromSensor ===
                  sourceSensor
              : part.toSensor ===
                  sourceSensor
        );

      if (incoming) {
        sourceIncomingPart = {
          nodeName:
            sourceNodeName,
          partKey:
            incoming.key,
          partIndex:
            incoming.index,
          fromSensor:
            reversed
              ? incoming.toSensor
              : incoming.fromSensor,
          toSensor:
            sourceSensor,
          detectors: [
            sourceSensor,
          ],
          blockIds: [
            source.id,
          ],
          locoDirection:
            reversed
              ? (
                  incoming.locoDirection ===
                    "forward"
                    ? "reverse"
                    : incoming.locoDirection ===
                        "reverse"
                      ? "forward"
                      : "unknown"
                )
              : (
                  incoming.locoDirection ??
                  "unknown"
                ),
        };
      }
    }

    if (
      sourceIncomingPart &&
      !partPath.some(
        part =>
          part.nodeName ===
            sourceIncomingPart!.nodeName &&
          part.partKey ===
            sourceIncomingPart!.partKey &&
          part.toSensor ===
            sourceIncomingPart!.toSensor
      )
    ) {
      pushPart(
        sourceIncomingPart,
        source.nodeIndex
      );
    }

    pushBlock(
      source
    );

    const pushTurnouts =
      (
        edge:
          RawRouteEdge | undefined,
        nodeIndex:
          number
      ): void => {
        if (!edge) {
          return;
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
            blockId:
              null,
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
            routeOrder:
              0,
            partIndex:
              null,
          });
        }
      };

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

      const nodeParts =
        partPath.filter(
          part =>
            part.nodeName ===
              nodeName
        );

      for (
        const part of
        nodeParts
      ) {
        pushPart(
          part,
          nodeIndex
        );

        for (
          const blockId of
          part.blockIds ??
          []
        ) {
          const block =
            route.blockPath.find(
              entry =>
                entry.id ===
                  blockId
            );

          if (
            block &&
            block.id !==
              source.id &&
            block.id !==
              route.blockPath[
                route.blockPath.length -
                  1
              ]?.id &&
            !blocks.some(
              existing =>
                existing.blockId ===
                  block.id
            )
          ) {
            pushBlock(
              block
            );
          }
        }
      }

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
            ]?.id ||
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

      pushTurnouts(
        route.edgePath[
          nodeIndex
        ],
        nodeIndex
      );
    }
  } else {
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
        routeOrder: 0,
        partIndex: null,
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
          routeOrder: 0,
          partIndex: null,
        });
      }
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

  for (
    let routeOrder = 0;
    routeOrder <
      resources.length;
    routeOrder += 1
  ) {
    const resource =
      resources[
        routeOrder
      ];

    if (resource) {
      resource.routeOrder =
        routeOrder;
    }
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
            resource.key ===
              from.key ||
            resource.key ===
              to.key
          ) {
            return false;
          }

          if (
            usesSectionParts
          ) {
            return (
              resource.routeOrder >
                from.routeOrder &&
              resource.routeOrder <
                to.routeOrder
            );
          }

          if (
            resource.nodeIndex ===
              null
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
        sensors
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
          to.blockId!
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
      arrivedWhen:
        arrivalRuleFor(
          page,
          to.blockId!,
          sensors
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
