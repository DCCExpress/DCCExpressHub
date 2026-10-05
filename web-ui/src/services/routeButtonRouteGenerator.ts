import type {
  RunnableBlockRoute,
} from "@domain/railway/graph";

import type {
  RouteReferenceDto,
} from "@domain/layout/layoutDto";

import {
  isTurnoutElement,
  type LayoutView,
} from "../models/editor/core/LayoutView";

import {
  RouteButtonElement,
  type RouteTurnoutItem,
} from "../models/editor/elements/RouteButtonElement";

import TrackTurnoutDoubleElement from "../models/editor/elements/TrackTurnoutDoubleElement";

import {
  TrackTurnoutThreeWayElement,
} from "../models/editor/elements/TrackTurnoutThreeWayElement";

import {
  ensureClientRouteGraph,
} from "./clientRouteGraphCache";

export type GeneratedRouteButtonCandidate = {
  id: string;
  routeRef: RouteReferenceDto | null;
  label: string;
  fromBlockName: string;
  toBlockName: string;
  blockPath: string[];
  nodePath: string[];
  locoDirection:
    | "unknown"
    | "forward"
    | "reverse";
  routeTurnouts: RouteTurnoutItem[];
};

function candidateId(
  route: RunnableBlockRoute
): string {
  const nodes =
    route.solution.nodes
      .map(node => node.name)
      .join(">");

  const turnouts =
    route.solution.edges
      .flatMap(edge =>
        edge.turnoutPath.flatMap(
          passage =>
            passage.turnoutStates.map(
              state =>
                `${state.address}:${state.closed ? 1 : 0}`
            )
        )
      )
      .join(",");

  return (
    `${route.fromBlock.id}->${route.toBlock.id}` +
    `|${route.solution.locoDirection}` +
    `|${nodes}` +
    `|${turnouts}`
  );
}

function routeRef(
  route: RunnableBlockRoute
): RouteReferenceDto | null {
  if (
    route.solution.locoDirection !== "forward" &&
    route.solution.locoDirection !== "reverse"
  ) {
    return null;
  }

  const blockIds =
    route.solution.path
      .filter(
        item => item.type === "block"
      )
      .map(
        item => item.block.id
      )
      .filter(
        (id, index, ids) =>
          index === 0 ||
          id !== ids[index - 1]
      );

  if (blockIds.length < 2) {
    return null;
  }

  return {
    fromBlockId:
      route.fromBlock.id,
    toBlockId:
      route.toBlock.id,
    direction:
      route.solution.locoDirection,
    viaBlockIds:
      blockIds.slice(1, -1),
  };
}

function routeRefSignature(
  value: RouteReferenceDto
): string {
  return JSON.stringify({
    fromBlockId:
      value.fromBlockId,
    toBlockId:
      value.toBlockId,
    direction:
      value.direction,
    viaBlockIds:
      value.viaBlockIds,
  });
}

function collectBlockPath(
  route:
    RunnableBlockRoute
): string[] {
  const names:
    string[] = [];

  for (
    const item of
    route.solution.path
  ) {
    if (
      item.type !==
        "block"
    ) {
      continue;
    }

    if (
      names[
        names.length -
          1
      ] ===
      item.block.name
    ) {
      continue;
    }

    names.push(
      item.block.name
    );
  }

  return names;
}

function routeTurnoutsFromGraph(
  layout:
    LayoutView,
  route:
    RunnableBlockRoute
): RouteTurnoutItem[] {
  const byId =
    new Map<
      number,
      RouteTurnoutItem
    >();

  for (
    const edge of
    route.solution.edges
  ) {
    for (
      const passage of
      edge.turnoutPath
    ) {
      const turnout =
        layout.getElementById(
          passage.elementId
        );

      if (!turnout) {
        throw new Error(
          `Generated route references missing turnout element ${passage.elementId}.`
        );
      }

      let next:
        RouteTurnoutItem;

      if (
        turnout instanceof
          TrackTurnoutDoubleElement ||
        turnout instanceof
          TrackTurnoutThreeWayElement
      ) {
        const first =
          passage.turnoutStates.find(
            state =>
              state.address ===
              turnout.turnout1Address
          );

        const second =
          passage.turnoutStates.find(
            state =>
              state.address ===
              turnout.turnout2Address
          );

        if (
          !first ||
          !second
        ) {
          throw new Error(
            `Generated route has incomplete multi-motor state for turnout ${turnout.id}.`
          );
        }

        next = {
          turnoutId:
            turnout.id,
          closed:
            first.closed,
          secondClosed:
            second.closed,
        };
      } else if (
        isTurnoutElement(
          turnout
        )
      ) {
        const state =
          passage.turnoutStates.find(
            item =>
              item.address ===
              turnout.turnoutAddress
          );

        if (!state) {
          throw new Error(
            `Generated route has no state for turnout ${turnout.id}.`
          );
        }

        next = {
          turnoutId:
            turnout.id,
          closed:
            state.closed,
        };
      } else {
        throw new Error(
          `Generated route element ${passage.elementId} is not a turnout.`
        );
      }

      const existing =
        byId.get(
          next.turnoutId
        );

      if (existing) {
        if (
          existing.closed !==
            next.closed ||
          existing.secondClosed !==
            next.secondClosed
        ) {
          throw new Error(
            `Generated route requires conflicting states for turnout ${next.turnoutId}.`
          );
        }

        continue;
      }

      byId.set(
        next.turnoutId,
        next
      );
    }
  }

  return [
    ...byId.values(),
  ];
}

export function getAvailableGeneratedRouteButtonCandidates(
  layout:
    LayoutView,
  currentRouteButtonId:
    number
): GeneratedRouteButtonCandidate[] {
  const ensured =
    ensureClientRouteGraph(
      layout
    );

  const usedRouteRefs =
    new Set(
      layout
        .getAllElements()
        .filter(
          element =>
            element instanceof
              RouteButtonElement &&
            element.id !==
              currentRouteButtonId &&
            element.generatedRouteRef !==
              undefined
        )
        .map(
          element =>
            routeRefSignature(
              (
                element as
                  RouteButtonElement
              ).generatedRouteRef!
            )
        )
    );

  return ensured.result.routes
    .map(
      route => {
        const ref =
          routeRef(
            route
          );

        const blockPath =
          collectBlockPath(
            route
          );

        return {
          id:
            candidateId(
              route
            ),
          routeRef:
            ref,
          label:
            `${route.fromBlock.name} → ${route.toBlock.name}`,
          fromBlockName:
            route.fromBlock.name,
          toBlockName:
            route.toBlock.name,
          blockPath,
          nodePath:
            route.solution.nodes.map(
              node =>
                node.name
            ),
          locoDirection:
            route.solution.locoDirection,
          routeTurnouts:
            routeTurnoutsFromGraph(
              layout,
              route
            ),
        };
      }
    )
    .filter(
      candidate =>
        candidate.routeRef === null ||
        !usedRouteRefs.has(
          routeRefSignature(
            candidate.routeRef
          )
        )
    )
    .sort(
      (
        left,
        right
      ) =>
        left.fromBlockName.localeCompare(
          right.fromBlockName
        ) ||
        left.toBlockName.localeCompare(
          right.toBlockName
        ) ||
        left.blockPath
          .join("|")
          .localeCompare(
            right.blockPath.join(
              "|"
            )
          )
    );
}

export function applyGeneratedRouteButtonCandidate(
  routeButton:
    RouteButtonElement,
  candidate:
    GeneratedRouteButtonCandidate
): void {
  routeButton.routeTurnouts =
    candidate.routeTurnouts.map(
      item => ({
        ...item,
      })
    );

  routeButton.generatedRouteRef =
    candidate.routeRef
      ? {
          ...candidate.routeRef,
          viaBlockIds: [
            ...candidate.routeRef.viaBlockIds,
          ],
        }
      : undefined;

  routeButton.label =
    candidate.label;

  routeButton.name =
    candidate.blockPath.length >
      0
      ? candidate.blockPath.join(
          " - "
        )
      : candidate.label.replace(
          " → ",
          " - "
        );
}
