import type {
  SerializedLayoutDto,
} from "../domain/layout/layoutDto";

import type {
  MovementDocument,
  MovementPage,
} from "../domain/movement";

import {
  createMovementRouteKey,
  type MovementRouteIdentityEntry,
} from "./movementRouteIdentity";

export type MovementRouteCandidate = {
  key: string;
  fromBlockId: number;
  fromBlockName: string;
  toBlockId: number;
  toBlockName: string;
  blockPath: Array<{
    id: number;
    name: string;
  }>;
  nodePath: string[];
  locoDirection:
    | "unknown"
    | "forward"
    | "reverse";
  turnoutCount: number;
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
        3
    ) ||
    !Array.isArray(
      topology.routeTable
    )
  ) {
    throw new Error(
      "No saved route topology. Generate and save the route graph first."
    );
  }

  const usedRouteKeys =
    new Set<string>();

  const usedLegacySequences:
    number[][] = [];

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
      usedRouteKeys.add(
        page.routeKey
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
      usedLegacySequences.push(
        sequence
      );
    }
  }

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
            };
          }
        )
        .filter(
          (
            block
          ): block is {
            id: number;
            name: string;
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

    if (
      usedRouteKeys.has(
        key
      ) ||
      usedLegacySequences.some(
        checkpoints =>
          containsCheckpointsInOrder(
            candidateBlockIds,
            checkpoints
          )
      )
    ) {
      continue;
    }

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
      locoDirection:
        routeDirection(
          raw.locoDirection
        ),
      turnoutCount,
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

  return {
    ...page,
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
    blockRules:
      page.blockRules.filter(
        rule =>
          selected.has(
            rule.blockId
          )
      ),
  };
}

export async function loadMovementRouteCandidates(
  document:
    MovementDocument
): Promise<MovementRouteCandidate[]> {
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
