import type {
  SerializedLayoutDto,
} from "../domain/layout/layoutDto";

import type {
  MovementPage,
} from "../domain/movement";

import {
  createMovementRouteKey,
  type MovementRouteIdentityEntry,
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
    }
  | {
      key: string;
      kind: "block";
      order: number;
      nodeIndex: number;
      blockId: number;
      name: string;
      sensor: number | null;
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
  if (
    page.fromBlockId ===
      null ||
    page.toBlockId ===
      null
  ) {
    return [];
  }

  return [
    page.fromBlockId,
    ...page.viaBlockIds,
    page.toBlockId,
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
      "No saved route topology. Generate and save the route graph first."
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
      "The selected Movement route no longer exists in the saved route topology."
    );
  }

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
    MovementPage
): Promise<MovementRouteVectorItem[]> {
  if (
    page.fromBlockId ===
      null ||
    page.toBlockId ===
      null
  ) {
    return [];
  }

  const response =
    await fetch(
      "/api/layout",
      {
        cache:
          "no-store",
      }
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `Layout could not be loaded (${response.status}).`
    );
  }

  const layout =
    await response.json() as
      SerializedLayoutDto;

  const route =
    resolveMovementRouteVectorEntry(
      layout,
      page
    );

  return buildMovementRouteVector(
    layout,
    route
  );
}
