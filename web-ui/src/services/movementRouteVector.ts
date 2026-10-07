import type {
  SerializedLayoutDto,
} from "../domain/layout/layoutDto";

import type {
  MovementPage,
} from "../domain/movement";

import {
  loadMovementPlan,
} from "./movementPlan";

import type {
  MovementRouteIdentityEntry,
} from "./movementRouteIdentity";

export type MovementRouteVectorRole =
  | "source"
  | "intermediate"
  | "destination";

export type MovementRouteVectorItem =
  | {
      key: string;
      kind: "segment";
      order: number;
      nodeIndex: number;
      nodeName: string;
      name: string;
      trackName: string;
      sensor: number | null;
      sensors: number[];
    }
  | {
      key: string;
      kind: "turnout";
      order: number;
      nodeIndex: number;
      name: string;
      sensor: number | null;
      sensors: number[];
      turnoutStates: Array<{
        address: number;
        closed: boolean;
      }>;
    }
  | {
      key: string;
      kind: "block";
      order: number;
      nodeIndex: number;
      blockId: number;
      name: string;
      sensor: number | null;
      sensors: number[];
      mergedSegmentNames: string[];
      blockType: string;
      role:
        MovementRouteVectorRole;
    };

export type MovementRouteVectorInput = {
  blockPath: Array<{
    id?: number;
    name?: unknown;
    nodeIndex?: number;
  }>;
  nodes?: string[];
};

export type MovementRouteVectorRouteEntry =
  Omit<
    MovementRouteIdentityEntry,
    "blockPath" |
    "nodes"
  > &
  MovementRouteVectorInput & {
    fromBlockId: number;
    toBlockId: number;
  };

type RawGraphNode = {
  name?: unknown;
  trackName?: unknown;
  detectors?: Array<{
    address?: unknown;
  }>;
  elementIds?: unknown;
};

function record(
  value: unknown
): Record<string, unknown> | null {
  return (
    value !== null &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    )
  )
    ? value as Record<string, unknown>
    : null;
}

function positiveInteger(
  value: unknown
): number | null {
  const numeric =
    Number(
      value
    );

  return (
    Number.isInteger(
      numeric
    ) &&
    numeric >=
      1 &&
    numeric <=
      65535
  )
    ? numeric
    : null;
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
        positiveInteger(
          element.id
        );

      const sensor =
        positiveInteger(
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

function blockTypeMap(
  layout:
    SerializedLayoutDto
): Map<number, string> {
  const result =
    new Map<
      number,
      string
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
        positiveInteger(
          element.id
        );

      if (
        id ===
          null
      ) {
        continue;
      }

      const blockType =
        String(
          element.blockType ??
            "normal"
        ).trim() ||
        "normal";

      result.set(
        id,
        blockType
      );
    }
  }

  return result;
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
          "tracksignal2"
      ) {
        continue;
      }

      const id =
        positiveInteger(
          element.id
        );

      const address =
        positiveInteger(
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

function graphNodeMap(
  layout:
    SerializedLayoutDto
): Map<string, RawGraphNode> {
  const rawLayout =
    layout as unknown as
      Record<string, unknown>;

  const topology =
    record(
      rawLayout.routeTopology
    );

  const graph =
    record(
      topology?.graph
    );

  const nodes =
    Array.isArray(
      graph?.nodes
    )
      ? graph.nodes
      : [];

  const result =
    new Map<
      string,
      RawGraphNode
    >();

  for (
    const rawNode of
    nodes
  ) {
    const node =
      record(
        rawNode
      ) as RawGraphNode | null;

    const name =
      String(
        node?.name ??
          ""
      ).trim();

    if (
      node &&
      name
    ) {
      result.set(
        name,
        node
      );
    }
  }

  return result;
}

function segmentSensor(
  node:
    RawGraphNode | undefined,
  trackAddresses:
    Map<number, number>
): number | null {
  if (!node) {
    return null;
  }

  const explicitDetector =
    (
      Array.isArray(
        node.detectors
      )
        ? node.detectors
        : []
    )
      .map(
        detector =>
          positiveInteger(
            detector?.address
          )
      )
      .filter(
        (
          address
        ): address is number =>
          address !==
          null
      )
      .sort(
        (
          left,
          right
        ) =>
          left -
          right
      )[0];

  if (
    explicitDetector !==
      undefined
  ) {
    return explicitDetector;
  }

  const trackSensor =
    (
      Array.isArray(
        node.elementIds
      )
        ? node.elementIds
        : []
    )
      .map(
        rawId =>
          positiveInteger(
            rawId
          )
      )
      .filter(
        (
          id
        ): id is number =>
          id !==
          null
      )
      .map(
        id =>
          trackAddresses.get(
            id
          ) ??
          0
      )
      .find(
        address =>
          address >
          0
      );

  return (
    trackSensor ??
    null
  );
}

function routeCheckpoints(
  page:
    MovementPage
): number[] {
  if (!page.routeRef) {
    return [];
  }

  return [
    page.routeRef.fromBlockId,
    ...page.routeRef.viaBlockIds,
    page.routeRef.toBlockId,
  ];
}

function containsCheckpointsInOrder(
  route:
    MovementRouteVectorRouteEntry,
  checkpoints:
    readonly number[]
): boolean {
  let checkpointIndex =
    0;

  for (
    const block of
    route.blockPath
  ) {
    const id =
      positiveInteger(
        block.id
      );

    if (
      id ===
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

export function resolveMovementRouteVectorEntry(
  layout:
    SerializedLayoutDto,
  page:
    MovementPage
): MovementRouteVectorRouteEntry {
  const rawLayout =
    layout as unknown as
      Record<string, unknown>;

  const topology =
    record(
      rawLayout.routeTopology
    );

  if (
    !topology ||
    !Array.isArray(
      topology.routeTable
    )
  ) {
    throw new Error(
      "No route topology is available. Generate the route graph first."
    );
  }

  const routeTable =
    topology.routeTable
      .map(
        value =>
          record(
            value
          ) as
            MovementRouteVectorRouteEntry |
            null
      )
      .filter(
        (
          value
        ): value is
          MovementRouteVectorRouteEntry =>
            value !==
            null &&
            Array.isArray(
              value.blockPath
            )
      );

  const checkpoints =
    routeCheckpoints(
      page
    );

  if (
    checkpoints.length <
      2
  ) {
    throw new Error(
      "Movement requires a selected route."
    );
  }

  const first =
    checkpoints[0]!;

  const last =
    checkpoints[
      checkpoints.length -
        1
    ]!;

  const routeRef =
    page.routeRef!;

  const candidates =
    routeTable.filter(
      route =>
        positiveInteger(
          route.fromBlockId
        ) ===
          first &&
        positiveInteger(
          route.toBlockId
        ) ===
          last &&
        route.locoDirection ===
          routeRef.direction &&
        containsCheckpointsInOrder(
          route,
          checkpoints
        )
    );

  if (
    candidates.length !==
      1
  ) {
    throw new Error(
      candidates.length ===
        0
        ? "Movement route not found."
        : "Movement route is ambiguous. Select an exact generated route."
    );
  }

  return candidates[0]!;
}

export function buildMovementRouteVector(
  layout:
    SerializedLayoutDto,
  route:
    MovementRouteVectorInput
): MovementRouteVectorItem[] {
  const blockSensors =
    blockSensorMap(
      layout
    );

  const blockTypes =
    blockTypeMap(
      layout
    );

  const trackAddresses =
    trackAddressMap(
      layout
    );

  const graphNodes =
    graphNodeMap(
      layout
    );

  const result:
    MovementRouteVectorItem[] =
    [];

  const source =
    route.blockPath[0];

  const destination =
    route.blockPath[
      route.blockPath.length -
        1
    ];

  const sourceId =
    positiveInteger(
      source?.id
    );

  const destinationId =
    positiveInteger(
      destination?.id
    );

  const pushBlock =
    (
      block:
        MovementRouteVectorInput["blockPath"][number],
      nodeIndex: number
    ): void => {
      const blockId =
        positiveInteger(
          block.id
        );

      if (
        blockId ===
          null
      ) {
        return;
      }

      const name =
        String(
          block.name ??
            `Block ${blockId}`
        ).trim() ||
        `Block ${blockId}`;

      result.push({
        key:
          `block:${blockId}`,
        kind:
          "block",
        order:
          result.length,
        nodeIndex,
        blockId,
        name,
        sensor:
          blockSensors.get(
            blockId
          ) ??
          null,
        sensors:
          blockSensors.has(
            blockId
          )
            ? [
                blockSensors.get(
                  blockId
                )!,
              ]
            : [],
        mergedSegmentNames: [],
        blockType:
          blockTypes.get(
            blockId
          ) ??
          "normal",
        role:
          blockId ===
            sourceId
            ? "source"
            : blockId ===
                destinationId
              ? "destination"
              : "intermediate",
      });
    };

  if (
    sourceId !==
      null &&
    source
  ) {
    pushBlock(
      source,
      Number(
        source.nodeIndex ??
          0
      )
    );
  }

  const nodeNames =
    Array.isArray(
      route.nodes
    )
      ? route.nodes.map(
          value =>
            String(
              value
            )
        )
      : [];

  for (
    let nodeIndex = 0;
    nodeIndex <
      nodeNames.length;
    nodeIndex += 1
  ) {
    const nodeName =
      nodeNames[
        nodeIndex
      ] ??
      `Segment ${nodeIndex + 1}`;

    const node =
      graphNodes.get(
        nodeName
      );

    const trackName =
      String(
        node?.trackName ??
          ""
      ).trim();

    result.push({
      key:
        `segment:${nodeName}`,
      kind:
        "segment",
      order:
        result.length,
      nodeIndex,
      nodeName,
      name:
        trackName ||
        nodeName,
      trackName,
      sensor:
        segmentSensor(
          node,
          trackAddresses
        ),
      sensors:
        (() => {
          const value =
            segmentSensor(
              node,
              trackAddresses
            );

          return value ===
            null
            ? []
            : [value];
        })(),
    });

    for (
      const block of
      route.blockPath
    ) {
      const blockId =
        positiveInteger(
          block.id
        );

      if (
        blockId ===
          null ||
        blockId ===
          sourceId ||
        Number(
          block.nodeIndex
        ) !==
          nodeIndex
      ) {
        continue;
      }

      pushBlock(
        block,
        nodeIndex
      );
    }
  }

  return result.map(
    (
      item,
      index
    ) => ({
      ...item,
      order:
        index + 1,
    })
  );
}

export async function loadMovementRouteVector(
  page:
    MovementPage,
  layoutOverride?:
    SerializedLayoutDto
): Promise<MovementRouteVectorItem[]> {
  if (
    page.routeRef ===
      null
  ) {
    return [];
  }

  /*
   * The Movement plan is the authoritative physical route representation.
   * The preview follows that order, but visually coalesces a segment into its
   * block when the segment has exactly one detector and that detector is the
   * same as the block's own occupancy sensor. In that case the separate segment
   * node adds no physical information, so the block is labelled BLOCK + SEG:Sx.
   *
   * buildMovementRouteVector() intentionally remains the legacy
   * block/segment-only helper used by movementRouteDefaults so adding turnout
   * cards to the UI does not silently change generated arrival conditions.
   */
  const plan =
    await loadMovementPlan(
      page,
      layoutOverride
    );

  const hiddenSegmentKeys =
    new Set<string>();

  const mergedSegmentNamesByBlockKey =
    new Map<
      string,
      string[]
    >();

  for (
    const segment of
    plan.resources
  ) {
    if (
      segment.kind !==
        "segment" ||
      segment.nodeIndex ===
        null ||
      segment.detectors.length !==
        1
    ) {
      continue;
    }

    const detector =
      segment.detectors[0];

    if (
      detector ===
        undefined
    ) {
      continue;
    }

    /*
     * Preserve the original composite-node rule from 7258cfdc first:
     * same physical graph node + same single occupancy sensor.
     *
     * Newer route-topology generation can assign the logical Block and the
     * physical segment different nodeIndex values even though both refer to
     * the same occupancy sensor. In that case sensor identity is the stronger
     * physical signal. Fall back to it only when the match is unique on this
     * route, so duplicate/misconfigured sensor addresses can never merge the
     * segment into an arbitrary Block.
     */
    const sameNodeBlocks =
      plan.resources.filter(
        resource =>
          resource.kind ===
            "block" &&
          resource.nodeIndex ===
            segment.nodeIndex &&
          resource.sensorAddress ===
            detector
      );

    const sameSensorBlocks =
      plan.resources.filter(
        resource =>
          resource.kind ===
            "block" &&
          resource.sensorAddress ===
            detector
      );

    const matchingBlocks =
      sameNodeBlocks.length ===
        1
        ? sameNodeBlocks
        : sameSensorBlocks.length ===
            1
          ? sameSensorBlocks
          : [];

    if (
      matchingBlocks.length !==
        1
    ) {
      continue;
    }

    const block =
      matchingBlocks[0]!;

    hiddenSegmentKeys.add(
      segment.key
    );

    mergedSegmentNamesByBlockKey.set(
      block.key,
      [
        ...(
          mergedSegmentNamesByBlockKey.get(
            block.key
          ) ??
          []
        ),
        segment.name,
      ]
    );
  }

  const blockTypes =
    layoutOverride
      ? blockTypeMap(
          layoutOverride
        )
      : new Map<
          number,
          string
        >();

  const visibleResources =
    plan.resources.filter(
      resource =>
        !hiddenSegmentKeys.has(
          resource.key
        )
    );

  return visibleResources.map(
    (
      resource,
      index
    ): MovementRouteVectorItem => {
      const nodeIndex =
        resource.nodeIndex ??
        0;

      const sensor =
        resource.sensorAddress ??
        resource.detectors[0] ??
        null;

      const sensors =
        resource.kind ===
          "block"
          ? (
              resource.sensorAddress ===
                null
                ? []
                : [
                    resource.sensorAddress,
                  ]
            )
          : [
              ...resource.detectors,
            ];

      if (
        resource.kind ===
          "block"
      ) {
        const blockId =
          resource.blockId;

        if (
          blockId ===
            null
        ) {
          throw new Error(
            `Movement block resource "${resource.key}" has no block id.`
          );
        }

        return {
          key:
            resource.key,
          kind:
            "block",
          order:
            index + 1,
          nodeIndex,
          blockId,
          name:
            resource.name,
          sensor,
          sensors,
          mergedSegmentNames:
            mergedSegmentNamesByBlockKey.get(
              resource.key
            ) ??
            [],
          blockType:
            blockTypes.get(
              blockId
            ) ??
            "normal",
          role:
            blockId ===
              page.routeRef!.fromBlockId
              ? "source"
              : blockId ===
                  page.routeRef!.toBlockId
                ? "destination"
                : "intermediate",
        };
      }

      if (
        resource.kind ===
          "turnout"
      ) {
        return {
          key:
            resource.key,
          kind:
            "turnout",
          order:
            index + 1,
          nodeIndex,
          name:
            resource.name,
          sensor,
          sensors,
          turnoutStates:
            resource.turnoutStates.map(
              state => ({
                ...state,
              })
            ),
        };
      }

      const trackName =
        resource.label.startsWith(
          `${resource.name} · `
        )
          ? resource.label.slice(
              resource.name.length +
                3
            )
          : "";

      return {
        key:
          resource.key,
        kind:
          "segment",
        order:
          index + 1,
        nodeIndex,
        nodeName:
          resource.name,
        name:
          trackName ||
          resource.name,
        trackName,
        sensor,
        sensors,
      };
    }
  );
}
