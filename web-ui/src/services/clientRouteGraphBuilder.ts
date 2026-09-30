import type {
  SerializedLayoutDto,
} from "@domain/layout/layoutDto";

import {
  Graph,
  type BlockRoutePathItem,
  type RunnableBlockRoute,
  type SectionBlock,
} from "@domain/railway/graph";

import {
  buildRailwayTopologyFromLayout,
  type RailwayTopologyLayout,
} from "@domain/railway/topology";

import {
  RouteGraphBuilder,
} from "@domain/railway/routeGraphBuilder";

import type {
  RouteGraphTrackRuntimeDto,
} from "@domain/railway/routeGraphDto";

import type {
  LayoutView,
} from "@/models/editor/core/LayoutView";

import {
  synchronizeMultiMotorTurnoutTopology,
} from "@/services/multiMotorTopologySync";

export type ClientRouteGraphBuildResult = {
  graph: Graph;
  blocks: SectionBlock[];
  trackRuntime: RouteGraphTrackRuntimeDto[];
  routes: RunnableBlockRoute[];
};

function sectionFromNodeName(
  name: string
): number {
  const match = /^S(\d+)$/.exec(name);

  if (!match) {
    return 0;
  }

  const value = Number(match[1]);

  return Number.isInteger(value) && value > 0
    ? value
    : 0;
}

function buildBlockIndex(
  graph: Graph,
  topology:
    RailwayTopologyLayout
): SectionBlock[] {
  const result:
    SectionBlock[] = [];

  for (
    const block of
    topology.getBlocks()
  ) {
    const sensorAddress =
      Number.isInteger(
        block.sensorAddress
      ) &&
      block.sensorAddress >
        0
        ? block.sensorAddress
        : null;

    if (
      sensorAddress ===
        null
    ) {
      continue;
    }

    /*
     * Blocks are a logical overlay, never physical graph members.
     * Locate them solely by occupancy-sensor identity. The block rectangle,
     * size and visual position do not participate in route topology.
     */
    const matchingNodes =
      graph.nodes.filter(
        node =>
          node.sectionParts.some(
            part =>
              part.detectors.includes(
                sensorAddress
              ) ||
              part.fromSensor ===
                sensorAddress ||
              part.toSensor ===
                sensorAddress
          ) ||
          node.detectors.some(
            detector =>
              detector.address ===
                sensorAddress
          )
      );

    if (
      matchingNodes.length >
        1
    ) {
      throw new Error(
        `Block "${block.name || block.id}" sensor ${sensorAddress} exists on more than one physical graph segment (${matchingNodes.map(node => node.name).join(", ")}).`
      );
    }

    const node =
      matchingNodes[0];

    if (!node) {
      continue;
    }

    const name =
      block.name?.trim()
        ? block.name.trim()
        : "Block";

    const trackName =
      node.trackName.trim();

    result.push({
      id:
        block.id,
      name,
      trackName,
      label:
        trackName
          ? `${trackName}: ${name}`
          : name,
      nodeName:
        node.name,
      sensorAddress,
    });
  }

  return result;
}

export function buildRunnableBlockRoutes(
  graph:
    Graph,
  blocks:
    SectionBlock[]
): RunnableBlockRoute[] {
  const result:
    RunnableBlockRoute[] = [];

  const blocksByNode =
    new Map<
      string,
      SectionBlock[]
    >();

  for (
    const block of
    blocks
  ) {
    const items =
      blocksByNode.get(
        block.nodeName
      ) ??
      [];

    items.push(
      block
    );

    blocksByNode.set(
      block.nodeName,
      items
    );
  }

  for (
    const fromBlock of
    blocks
  ) {
    for (
      const toBlock of
      blocks
    ) {
      if (
        fromBlock.id ===
          toBlock.id
      ) {
        continue;
      }

      const fromNode =
        graph.nodes.find(
          node =>
            node.name ===
              fromBlock.nodeName
        );

      const toNode =
        graph.nodes.find(
          node =>
            node.name ===
              toBlock.nodeName
        );

      if (
        !fromNode ||
        !toNode
      ) {
        continue;
      }

      const physicalRoute =
        graph.findRoute(
          fromNode.name,
          toNode.name
        );

      if (!physicalRoute) {
        continue;
      }

      const path:
        BlockRoutePathItem[] = [
          {
            type:
              "block",
            block:
              fromBlock,
            node:
              fromNode,
          },
        ];

      for (
        const node of
        physicalRoute.nodes
      ) {
        path.push({
          type:
            "segment",
          node,
        });

        for (
          const block of
          blocksByNode.get(
            node.name
          ) ??
          []
        ) {
          if (
            block.id ===
              fromBlock.id ||
            block.id ===
              toBlock.id
          ) {
            continue;
          }

          path.push({
            type:
              "block",
            block,
            node,
          });
        }
      }

      path.push({
        type:
          "block",
        block:
          toBlock,
        node:
          toNode,
      });

      result.push({
        fromBlock,
        toBlock,
        solution: {
          ...physicalRoute,
          fromBlock,
          toBlock,
          path,
        },
      });
    }
  }

  return result;
}

export function buildClientRouteGraph(
  layout:
    LayoutView
): ClientRouteGraphBuildResult {
  const serialized =
    JSON.parse(
      JSON.stringify(
        layout
      )
    ) as SerializedLayoutDto;

  const topology =
    buildRailwayTopologyFromLayout(
      serialized
    );

  /*
   * IMPORTANT:
   * buildRailwayTopologyFromLayout() currently does not copy the explicit
   * Double / 3-way position bit tables. Synchronize those values from the
   * authoritative live LayoutView before RouteGraphBuilder asks
   * getAllowedRoutes() for required motor states.
   */
  synchronizeMultiMotorTurnoutTopology(
    layout,
    topology
  );

  /*
   * Physical graph: sections, section-parts and turnout edges only.
   * Blocks are indexed afterwards and never participate in graph creation.
   */
  const graph =
    new RouteGraphBuilder(
      topology
    ).build();

  const blocks =
    buildBlockIndex(
      graph,
      topology
    );

  const sectionPartByElementId =
    new Map<
      number,
      string
    >();

  for (
    const node of
    graph.nodes
  ) {
    for (
      const part of
      node.sectionParts
    ) {
      for (
        const elementId of
        part.elementIds
      ) {
        sectionPartByElementId.set(
          elementId,
          part.key
        );
      }
    }
  }

  const runtimeById =
    new Map<
      number,
      RouteGraphTrackRuntimeDto
    >();

  for (
    const element of
    topology.getPhysicalTrackElements()
  ) {
    runtimeById.set(
      element.id,
      {
        id:
          element.id,
        section:
          element.section,
        ...(
          sectionPartByElementId.has(
            element.id
          )
            ? {
                sectionPart:
                  sectionPartByElementId.get(
                    element.id
                  )!,
              }
            : {}
        ),
        travelDirection:
          element.travelDirection,
      }
    );
  }

  for (
    const block of
    blocks
  ) {
    runtimeById.set(
      block.id,
      {
        id:
          block.id,
        section:
          sectionFromNodeName(
            block.nodeName
          ),
        travelDirection:
          "unknown",
      }
    );
  }

  const trackRuntime =
    [
      ...runtimeById.values(),
    ];

  layout.applyRouteGraphRuntime(
    trackRuntime
  );

  return {
    graph,
    blocks,
    trackRuntime,
    routes:
      buildRunnableBlockRoutes(
        graph,
        blocks
      ),
  };
}
