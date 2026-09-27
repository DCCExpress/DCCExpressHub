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
      .filter(
        address =>
          address >
          0
      )
      .sort(
        (
          left,
          right
        ) =>
          left -
          right
      )[0];

  return (
    trackSensor ??
    null
  );
}

export function buildMovementIntermediateArrivalDefaults(
  layout:
    SerializedLayoutDto,
  route:
    MovementRouteDefaultEntry
): MovementIntermediateArrivalDefault[] {
  if (
    route.blockPath.length <
      3
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

  const nodeNames =
    Array.isArray(
      route.nodes
    )
      ? route.nodes
      : [];

  return route.blockPath
    .slice(
      1,
      -1
    )
    .map(
      block => {
        const blockId =
          positiveInteger(
            block.id
          );

        if (
          blockId ===
            null
        ) {
          return null;
        }

        const nodeIndex =
          Number(
            block.nodeIndex
          );

        const blockSensor =
          blockSensors.get(
            blockId
          );

        const previousNodeName =
          Number.isInteger(
            nodeIndex
          ) &&
          nodeIndex >=
            0
            ? nodeNames[
                nodeIndex
              ]
            : undefined;

        const nextNodeName =
          Number.isInteger(
            nodeIndex
          ) &&
          nodeIndex >=
            0
            ? nodeNames[
                nodeIndex +
                  1
              ]
            : undefined;

        const previousSensor =
          segmentSensor(
            previousNodeName
              ? graphNodes.get(
                  previousNodeName
                )
              : undefined,
            trackAddresses
          );

        const nextSensor =
          segmentSensor(
            nextNodeName
              ? graphNodes.get(
                  nextNodeName
                )
              : undefined,
            trackAddresses
          );

        const conditions:
          MovementArrivalDefaultCondition[] =
          [];

        const seen =
          new Set<number>();

        if (
          previousSensor !==
            null &&
          previousSensor !==
            blockSensor
        ) {
          seen.add(
            previousSensor
          );

          conditions.push({
            sensor:
              previousSensor,
            state:
              false,
          });
        }

        if (
          blockSensor !==
            undefined
        ) {
          seen.add(
            blockSensor
          );

          conditions.push({
            sensor:
              blockSensor,
            state:
              true,
          });
        }

        if (
          nextSensor !==
            null &&
          nextSensor !==
            blockSensor &&
          !seen.has(
            nextSensor
          )
        ) {
          conditions.push({
            sensor:
              nextSensor,
            state:
              false,
          });
        }

        return {
          blockId,
          conditions,
        };
      }
    )
    .filter(
      (
        entry
      ): entry is MovementIntermediateArrivalDefault =>
        entry !==
        null
    );
}
