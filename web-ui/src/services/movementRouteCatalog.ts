import type {
  SerializedLayoutDto,
} from "../domain/layout/layoutDto";

import {
  createMovementAction,
  createMovementId,
  type MovementDocument,
  type MovementPage,
} from "../domain/movement";

import {
  createMovementRouteKey,
  type MovementRouteIdentityEntry,
} from "./movementRouteIdentity";

import {
  buildMovementIntermediateArrivalDefaults,
  type MovementIntermediateArrivalDefault,
} from "./movementRouteDefaults";

export type MovementRouteCandidate = {
  key: string;
  fromBlockId: number;
  fromBlockName: string;
  toBlockId: number;
  toBlockName: string;
  blockPath: Array<{
    id: number;
    name: string;
    nodeIndex: number;
    blockType: string;
  }>;
  nodePath: string[];
  partPath: string[];
  locoDirection:
    | "unknown"
    | "forward"
    | "reverse";
  turnoutCount: number;
  intermediateArrivalDefaults:
    MovementIntermediateArrivalDefault[];
  used: boolean;
  usedByMovementNames: string[];
};

type RawRouteEntry =
  Omit<
    MovementRouteIdentityEntry,
    "blockPath" |
    "nodes"
  > & {
    fromBlockName?: unknown;
    toBlockName?: unknown;
    blockPath?: Array<{
      id?: number;
      name?: unknown;
      nodeIndex?: number;
    }>;
    nodes?: unknown;
    turnoutStates?: unknown;
    partPath?: Array<{
      nodeName?: string;
      partKey?: string;
      partIndex?: number;
      fromSensor?: number | null;
      toSensor?: number | null;
      locoDirection?: string;
    }>;
  };

function record(
  value: unknown
): Record<string, unknown> | null {
  return (
    value !==
      null &&
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

function blockTypeById(
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

      result.set(
        id,
        String(
          element.blockType ??
            "normal"
        ).trim() ||
          "normal"
      );
    }
  }

  return result;
}

function routeDirection(
  value: unknown
):
  | "unknown"
  | "forward"
  | "reverse" {
  return (
    value ===
      "forward" ||
    value ===
      "reverse"
  )
    ? value
    : "unknown";
}

function pageSequence(
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
  blockPath:
    readonly number[],
  checkpoints:
    readonly number[]
): boolean {
  if (
    checkpoints.length <
      2 ||
    blockPath.length <
      checkpoints.length ||
    blockPath[0] !==
      checkpoints[0] ||
    blockPath[
      blockPath.length -
        1
    ] !==
      checkpoints[
        checkpoints.length -
          1
      ]
  ) {
    return false;
  }

  let checkpointIndex =
    0;

  for (
    const blockId of
    blockPath
  ) {
    if (
      blockId ===
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

export function buildMovementRouteCandidates(
  layout:
    SerializedLayoutDto,
  document:
    MovementDocument
): MovementRouteCandidate[] {
  const rawLayout =
    layout as unknown as
      Record<string, unknown>;

  const topology =
    record(
      rawLayout.routeTopology
    );

  if (
    !topology ||
    (
      topology.version !==
        2 &&
      topology.version !==
        3 &&
      topology.version !==
        4 &&
      topology.version !==
        5 &&
      topology.version !==
        6
    ) ||
    !Array.isArray(
      topology.routeTable
    )
  ) {
    throw new Error(
      "No route topology is available. Generate the route graph first."
    );
  }

  const usedRouteKeys =
    new Map<
      string,
      string[]
    >();

  const usedLegacySequences:
    Array<{
      checkpoints: number[];
      movementName: string;
    }> = [];

  for (
    const page of
    document.pages
  ) {
    if (
      page.routeKey
        .trim()
        .length >
        0
    ) {
      const names =
        usedRouteKeys.get(
          page.routeKey
        ) ??
        [];

      names.push(
        page.name
      );

      usedRouteKeys.set(
        page.routeKey,
        names
      );

      continue;
    }

    const sequence =
      pageSequence(
        page
      );

    if (
      sequence.length >=
        2
    ) {
      usedLegacySequences.push({
        checkpoints:
          sequence,
        movementName:
          page.name,
      });
    }
  }

  const blockTypes =
    blockTypeById(
      layout
    );

  const candidates:
    MovementRouteCandidate[] = [];

  for (
    const rawValue of
    topology.routeTable
  ) {
    const raw =
      record(
        rawValue
      ) as RawRouteEntry | null;

    if (!raw) {
      continue;
    }

    const fromBlockId =
      positiveInteger(
        raw.fromBlockId
      );

    const toBlockId =
      positiveInteger(
        raw.toBlockId
      );

    if (
      fromBlockId ===
        null ||
      toBlockId ===
        null ||
      fromBlockId ===
        toBlockId ||
      !Array.isArray(
        raw.blockPath
      )
    ) {
      continue;
    }

    const blockPath =
      raw.blockPath
        .map(
          block => {
            const id =
              positiveInteger(
                block.id
              );

            if (
              id ===
                null
            ) {
              return null;
            }

            return {
              id,
              name:
                String(
                  block.name ??
                    `Block ${id}`
                ).trim() ||
                `Block ${id}`,
              nodeIndex:
                Number.isInteger(
                  Number(
                    block.nodeIndex
                  )
                )
                  ? Number(
                      block.nodeIndex
                    )
                  : 0,
              blockType:
                blockTypes.get(
                  id
                ) ??
                "normal",
            };
          }
        )
        .filter(
          (
            block
          ): block is {
            id: number;
            name: string;
            nodeIndex: number;
            blockType: string;
          } =>
            block !==
            null
        );

    if (
      blockPath.length <
        2
    ) {
      continue;
    }

    const identityRoute:
      MovementRouteIdentityEntry = {
        fromBlockId,
        toBlockId,
        blockPath:
          raw.blockPath,
        nodes:
          Array.isArray(
            raw.nodes
          )
            ? raw.nodes.map(
                value =>
                  String(
                    value
                  )
              )
            : [],
        partPath:
          Array.isArray(
            raw.partPath
          )
            ? raw.partPath
            : [],
        edgePath:
          Array.isArray(
            raw.edgePath
          )
            ? raw.edgePath
            : [],
        locoDirection:
          routeDirection(
            raw.locoDirection
          ),
      };

    const key =
      createMovementRouteKey(
        identityRoute
      );

    const candidateBlockIds =
      blockPath.map(
        block =>
          block.id
      );

    const usedByMovementNames =
      [
        ...(
          usedRouteKeys.get(
            key
          ) ??
          []
        ),
        ...usedLegacySequences
          .filter(
            entry =>
              containsCheckpointsInOrder(
                candidateBlockIds,
                entry.checkpoints
              )
          )
          .map(
            entry =>
              entry.movementName
          ),
      ].filter(
        (
          name,
          index,
          all
        ) =>
          all.indexOf(
            name
          ) ===
          index
      );

    const turnoutCount =
      new Set(
        (
          Array.isArray(
            raw.edgePath
          )
            ? raw.edgePath
            : []
        ).flatMap(
          edge =>
            (
              edge.turnoutPath ??
              []
            ).map(
              passage =>
                Number(
                  passage.elementId ??
                    0
                )
            )
        ).filter(
          id =>
            Number.isInteger(
              id
            ) &&
            id >
              0
        )
      ).size;

    const intermediateArrivalDefaults =
      buildMovementIntermediateArrivalDefaults(
        layout,
        {
          blockPath,
          nodes:
            Array.isArray(
              raw.nodes
            )
              ? raw.nodes.map(
                  value =>
                    String(
                      value
                    )
                )
              : [],
        }
      );

    candidates.push({
      key,
      fromBlockId,
      fromBlockName:
        String(
          raw.fromBlockName ??
            blockPath[0]!.name
        ),
      toBlockId,
      toBlockName:
        String(
          raw.toBlockName ??
            blockPath[
              blockPath.length -
                1
            ]!.name
        ),
      blockPath,
      nodePath:
        Array.isArray(
          raw.nodes
        )
          ? raw.nodes.map(
              value =>
                String(
                  value
                )
            )
          : [],
      partPath:
        Array.isArray(
          raw.partPath
        )
          ? raw.partPath.map(
              part =>
                String(
                  part.partKey ??
                    ""
                )
            ).filter(
              value =>
                value.length >
                  0
            )
          : [],
      locoDirection:
        routeDirection(
          raw.locoDirection
        ),
      turnoutCount,
      intermediateArrivalDefaults,
      used:
        usedByMovementNames.length >
        0,
      usedByMovementNames,
    });
  }

  return candidates.sort(
    (
      left,
      right
    ) =>
      left.fromBlockName.localeCompare(
        right.fromBlockName,
        undefined,
        {
          numeric: true,
          sensitivity:
            "base",
        }
      ) ||
      left.toBlockName.localeCompare(
        right.toBlockName,
        undefined,
        {
          numeric: true,
          sensitivity:
            "base",
        }
      ) ||
      left.blockPath.length -
        right.blockPath.length
  );
}

export function applyMovementRouteCandidate(
  page:
    MovementPage,
  candidate:
    MovementRouteCandidate
): MovementPage {
  const blockIds =
    candidate.blockPath.map(
      block =>
        block.id
    );

  const selected =
    new Set(
      blockIds
    );

  const existingRules =
    page.blockRules.filter(
      rule =>
        selected.has(
          rule.blockId
        )
    );

  const directionArrow =
    candidate.locoDirection ===
      "forward"
      ? "→"
      : candidate.locoDirection ===
          "reverse"
        ? "←"
        : "↔";

  const generatedName =
    candidate.blockPath
      .map(
        block =>
          block.name
      )
      .join(
        ` ${directionArrow} `
      );

  /*
   * New Movement defaults are materialized only on the very first route
   * selection. Existing Movements and later route changes must never gain
   * waiting actions implicitly.
   */
  const applyNewMovementDefaults =
    page.routeKey.trim().length ===
      0 &&
    page.fromBlockId ===
      null &&
    page.toBlockId ===
      null &&
    page.actions.length ===
      0;

  const defaultStationActions =
    applyNewMovementDefaults
      ? candidate.blockPath.flatMap(
          block => {
            if (
              block.blockType !==
                "station"
            ) {
              return [];
            }

            const sequenceId =
              createMovementId(
                "movement-sequence"
              );

            const fixedWait =
              createMovementAction(
                `block:${block.id}`,
                "beforeDepart",
                "delay",
                sequenceId,
                "blocking"
              );

            fixedWait.delayMs =
              10000;

            const randomWait =
              createMovementAction(
                `block:${block.id}`,
                "beforeDepart",
                "randomDelay",
                sequenceId,
                "blocking"
              );

            randomWait.minDelayMs =
              0;
            randomWait.maxDelayMs =
              5000;

            return [
              fixedWait,
              randomWait,
            ];
          }
        )
      : [];

  return {
    ...page,
    name:
      generatedName,
    routeKey:
      candidate.key,
    fromBlockId:
      blockIds[0] ??
      null,
    viaBlockIds:
      blockIds.length >
        2
        ? blockIds.slice(
            1,
            -1
          )
        : [],
    toBlockId:
      blockIds.length >=
        2
        ? blockIds[
            blockIds.length -
              1
          ]!
        : null,
    /*
     * Keep only user-authored block rules. Default ARRIVED must stay implicit:
     * movementPlan.arrivalRuleFor() derives it from the target block's own
     * occupancy sensor. Materializing a default here turns it into a custom
     * rule and can leave stale/extra sensors behind after route edits.
     */
    blockRules:
      existingRules,
    /*
     * Safety overrides describe the exact physical leg path. Selecting a new
     * generated route must fail closed instead of carrying ignored sensors
     * over to a potentially different path.
     */
    safetyRules: [],
    actions:
      applyNewMovementDefaults
        ? [
            ...page.actions,
            ...defaultStationActions,
          ]
        : page.actions,
  };
}

export async function loadMovementRouteCandidates(
  document:
    MovementDocument,
  layoutOverride?:
    SerializedLayoutDto
): Promise<MovementRouteCandidate[]> {
  if (layoutOverride) {
    return buildMovementRouteCandidates(
      layoutOverride,
      document
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

  return buildMovementRouteCandidates(
    layout,
    document
  );
}
