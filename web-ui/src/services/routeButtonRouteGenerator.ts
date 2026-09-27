import type {
  RunnableBlockRoute,
} from "@domain/railway/graph";

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
  key: string;
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

function routeKey(
  route:
    RunnableBlockRoute
): string {
  const edgePath =
    route.solution.edges
      .map(
        edge => {
          const turnouts =
            edge.turnoutPath
              .map(
                passage => {
                  const states =
                    passage.turnoutStates
                      .map(
                        state =>
                          `${state.address}:${state.closed ? 1 : 0}`
                      )
                      .join(",");

                  return `${passage.elementId}[${states}]`;
                }
              )
              .join(">");

          return (
            `${edge.from.name}>${edge.to.name}` +
            `:${turnouts}` +
            `:${edge.locoDirection}`
          );
        }
      )
      .join("|");

  return (
    `${route.fromBlock.id}->${route.toBlock.id}` +
    `|${edgePath}`
  );
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

  const usedKeys =
    new Set(
      layout
        .getAllElements()
        .filter(
          element =>
            element instanceof
              RouteButtonElement &&
            element.id !==
              currentRouteButtonId &&
            element.generatedRouteKey
              .trim()
              .length >
              0
        )
        .map(
          element =>
            (
              element as
                RouteButtonElement
            ).generatedRouteKey
        )
    );

  return ensured.result.routes
    .map(
      route => {
        const key =
          routeKey(
            route
          );

        const blockPath =
          collectBlockPath(
            route
          );

        return {
          key,
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
        !usedKeys.has(
          candidate.key
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

  routeButton.generatedRouteKey =
    candidate.key;

  routeButton.label =
    candidate.label;
}
