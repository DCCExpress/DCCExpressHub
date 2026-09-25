import type {
  SerializedLayoutDto,
} from "@domain/layout/layoutDto";

import {
  Graph,
  type RunnableBlockRoute,
} from "@domain/railway/graph";

import {
  buildRailwayTopologyFromLayout,
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

export function buildClientRouteGraph(
  layout: LayoutView
): ClientRouteGraphBuildResult {
  const serialized =
    JSON.parse(
      JSON.stringify(layout)
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

  const graph =
    new RouteGraphBuilder(
      topology
    ).build();

  const runtimeById =
    new Map<number, RouteGraphTrackRuntimeDto>();

  for (
    const element
    of topology.getPhysicalTrackElements()
  ) {
    runtimeById.set(
      element.id,
      {
        id: element.id,
        section:
          element.section,
        travelDirection:
          element.travelDirection,
      }
    );
  }

  const blockSections =
    new Map<
      number,
      Set<number>
    >();

  for (const node of graph.nodes) {
    const section =
      sectionFromNodeName(
        node.name
      );

    if (section <= 0) {
      continue;
    }

    for (const block of node.blocks) {
      let sections =
        blockSections.get(
          block.id
        );

      if (!sections) {
        sections =
          new Set<number>();

        blockSections.set(
          block.id,
          sections
        );
      }

      sections.add(section);
    }
  }

  for (const block of topology.getBlocks()) {
    const sections =
      blockSections.get(
        block.id
      ) ?? new Set<number>();

    if (sections.size > 1) {
      throw new Error(
        `Block "${block.name || block.id}" spans more than one physical segment (${[...sections].map(value => `S${value}`).join(", ")}).`
      );
    }

    runtimeById.set(
      block.id,
      {
        id: block.id,
        section:
          sections.size === 1
            ? [...sections][0]!
            : 0,
        travelDirection:
          "unknown",
      }
    );
  }

  const trackRuntime =
    [...runtimeById.values()];

  // Apply generated section/direction metadata to the actual editor objects.
  // TrackElement.toJSON persists section, therefore the next layout save
  // stores the segmentation together with each rail/block element.
  layout.applyRouteGraphRuntime(
    trackRuntime
  );

  return {
    graph,
    trackRuntime,
    routes:
      graph.getRunnableBlockRoutes(),
  };
}
