import type {
  SerializedLayoutDto,
} from "../domain/layout/layoutDto";

import type {
  MovementPage,
} from "../domain/movement";

import {
  loadMovementPlan,
  type MovementPlanResource,
} from "./movementPlan";

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
      physicalSegmentNames: string[];
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
        physicalSegmentNames: [],
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
    page.fromBlockId ===
      null ||
    page.toBlockId ===
      null
  ) {
    return [];
  }

  /*
   * The Movement plan is the authoritative physical route representation.
   * MovementPlan keeps physical SectionParts and logical block boundaries
   * separate. The Vector alone may render an adjacent block + SectionPart as
   * one composite card so the physical route is not duplicated visually.
   */
  const plan =
    await loadMovementPlan(
      page,
      layoutOverride
    );

  const blockTypes =
    layoutOverride
      ? blockTypeMap(
          layoutOverride
        )
      : new Map<
          number,
          string
        >();

  const segmentByName =
    new Map(
      plan.resources
        .filter(
          resource =>
            resource.kind ===
              "segment"
        )
        .map(
          resource => [
            resource.name,
            resource,
          ] as const
        )
    );

  const blockCompositeSegment =
    new Map<
      string,
      MovementPlanResource
    >();

  const segmentCompositeBlock =
    new Map<
      string,
      MovementPlanResource
    >();

  for (
    const block of
    plan.resources
  ) {
    if (
      block.kind !==
        "block"
    ) {
      continue;
    }

    const segment =
      block.physicalSegmentNames
        .map(
          name =>
            segmentByName.get(
              name
            ) ??
            null
        )
        .find(
          candidate =>
            candidate !==
              null
        ) ??
      null;

    if (!segment) {
      continue;
    }

    const blockIndex =
      plan.resources.indexOf(
        block
      );

    const segmentIndex =
      plan.resources.indexOf(
        segment
      );

    if (
      blockIndex <
        0 ||
      segmentIndex <
        0 ||
      Math.abs(
        blockIndex -
          segmentIndex
      ) !==
        1 ||
      segmentCompositeBlock.has(
        segment.key
      )
    ) {
      continue;
    }

    blockCompositeSegment.set(
      block.key,
      segment
    );

    segmentCompositeBlock.set(
      segment.key,
      block
    );
  }

  const toItem =
    (
      resource:
        MovementPlanResource,
      index:
        number,
      compositeSegment:
        MovementPlanResource | null =
          null
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
          physicalSegmentNames:
            compositeSegment
              ? [
                  compositeSegment.name,
                ]
              : [
                  ...resource.physicalSegmentNames,
                ],
          blockType:
            blockTypes.get(
              blockId
            ) ??
            "normal",
          role:
            blockId ===
              page.fromBlockId
              ? "source"
              : blockId ===
                  page.toBlockId
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
    };

  const rendered:
    MovementRouteVectorItem[] =
    [];

  for (
    let index = 0;
    index <
      plan.resources.length;
    index += 1
  ) {
    const resource =
      plan.resources[
        index
      ];

    if (!resource) {
      continue;
    }

    if (
      resource.kind ===
        "segment"
    ) {
      const block =
        segmentCompositeBlock.get(
          resource.key
        );

      if (block) {
        const blockIndex =
          plan.resources.indexOf(
            block
          );

        /*
         * Render the composite at the physical segment's position. The block
         * boundary remains separate in MovementPlan; only the Vector merges
         * the two cards.
         */
        if (
          index <
            blockIndex
        ) {
          rendered.push(
            toItem(
              block,
              rendered.length,
              resource
            )
          );
        }

        continue;
      }
    }

    if (
      resource.kind ===
        "block"
    ) {
      const segment =
        blockCompositeSegment.get(
          resource.key
        );

      if (segment) {
        const segmentIndex =
          plan.resources.indexOf(
            segment
          );

        if (
          index <
            segmentIndex
        ) {
          rendered.push(
            toItem(
              resource,
              rendered.length,
              segment
            )
          );
        }

        continue;
      }
    }

    rendered.push(
      toItem(
        resource,
        rendered.length
      )
    );
  }

  return rendered.map(
    (
      item,
      index
    ) => ({
      ...item,
      order:
        index +
        1,
    })
  );
}
