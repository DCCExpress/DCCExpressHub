import type {
  SerializedLayoutDto,
} from "../domain/layout/layoutDto";

export type MovementArrivalDefaultCondition = {
  sensor: number;
  state: boolean;
};

export type MovementIntermediateArrivalDefault = {
  blockId: number;
  conditions:
    MovementArrivalDefaultCondition[];
};

export type MovementRouteDefaultEntry = {
  blockPath: Array<{
    id?: number;
    nodeIndex?: number;
  }>;
  nodes?: string[];
};

type RawGraphNode = {
  name?: unknown;
  detectors?: Array<{
    address?: unknown;
  }>;
  elementIds?: unknown;
};

type RouteVectorItem =
  | {
      kind: "segment";
      sensor: number | null;
    }
  | {
      kind: "block";
      blockId: number;
      sensor: number | null;
    };

function record(
  value: unknown
): Record<string, unknown> | null {
  return (
    value !== null &&
    typeof value === "object" &&
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

function buildRouteVector(
  route:
    MovementRouteDefaultEntry,
  blockSensors:
    Map<number, number>,
  graphNodes:
    Map<string, RawGraphNode>,
  trackAddresses:
    Map<number, number>
): RouteVectorItem[] {
  const result:
    RouteVectorItem[] = [];

  const source =
    route.blockPath[0];

  const sourceId =
    positiveInteger(
      source?.id
    );

  if (
    sourceId !==
      null
  ) {
    result.push({
      kind: "block",
      blockId:
        sourceId,
      sensor:
        blockSensors.get(
          sourceId
        ) ??
        null,
    });
  }

  const nodeNames =
    Array.isArray(
      route.nodes
    )
      ? route.nodes
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
      ];

    result.push({
      kind:
        "segment",
      sensor:
        nodeName
          ? segmentSensor(
              graphNodes.get(
                nodeName
              ),
              trackAddresses
            )
          : null,
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

      result.push({
        kind:
          "block",
        blockId,
        sensor:
          blockSensors.get(
            blockId
          ) ??
          null,
      });
    }
  }

  return result;
}

export function buildMovementIntermediateArrivalDefaults(
  layout:
    SerializedLayoutDto,
  route:
    MovementRouteDefaultEntry
): MovementIntermediateArrivalDefault[] {
  if (
    route.blockPath.length <
      2
  ) {
    return [];
  }

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

  const vector =
    buildRouteVector(
      route,
      blockSensors,
      graphNodes,
      trackAddresses
    );

  const sourceId =
    positiveInteger(
      route.blockPath[0]?.id
    );

  const result:
    MovementIntermediateArrivalDefault[] =
    [];

  for (
    let index = 0;
    index <
      vector.length;
    index += 1
  ) {
    const current =
      vector[
        index
      ];

    if (
      !current ||
      current.kind !==
        "block" ||
      current.blockId ===
        sourceId
    ) {
      continue;
    }

    const previous =
      vector[
        index -
          1
      ];

    const next =
      vector[
        index +
          1
      ];

    const conditions:
      MovementArrivalDefaultCondition[] =
      [];

    const seen =
      new Set<number>();

    if (
      previous?.sensor !==
        null &&
      previous?.sensor !==
        undefined &&
      previous.sensor !==
        current.sensor
    ) {
      seen.add(
        previous.sensor
      );

      conditions.push({
        sensor:
          previous.sensor,
        state:
          false,
      });
    }

    if (
      current.sensor !==
        null
    ) {
      seen.add(
        current.sensor
      );

      conditions.push({
        sensor:
          current.sensor,
        state:
          true,
      });
    }

    if (
      next?.sensor !==
        null &&
      next?.sensor !==
        undefined &&
      next.sensor !==
        current.sensor &&
      !seen.has(
        next.sensor
      )
    ) {
      conditions.push({
        sensor:
          next.sensor,
        state:
          false,
      });
    }

    result.push({
      blockId:
        current.blockId,
      conditions,
    });
  }

  return result;
}
