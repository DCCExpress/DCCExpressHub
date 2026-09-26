import type {
  SerializedLayoutDto,
} from "../domain/layout/layoutDto";

export type MovementTravelDirection =
  | "unknown"
  | "forward"
  | "reverse";

export type MovementRouteNext = {
  blockId: number;
  directions:
    MovementTravelDirection[];
};

export type MovementRouteNavigation = {
  nextByBlockId:
    Map<
      number,
      MovementRouteNext[]
    >;
};

type RawBlockPathEntry = {
  id?: unknown;
};

type RawRouteEntry = {
  blockPath?: unknown;
  locoDirection?: unknown;
};

function positiveInteger(
  value: unknown
): number | null {
  const numeric =
    Number(value);

  return (
    Number.isInteger(
      numeric
    ) &&
    numeric >= 1 &&
    numeric <= 65535
  )
    ? numeric
    : null;
}

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

function travelDirection(
  value: unknown
): MovementTravelDirection {
  if (
    value ===
      "forward" ||
    value ===
      "reverse"
  ) {
    return value;
  }

  return "unknown";
}

function mergeDirection(
  current:
    MovementTravelDirection,
  next:
    MovementTravelDirection
): MovementTravelDirection | null {
  if (
    current ===
    "unknown"
  ) {
    return next;
  }

  if (
    next ===
    "unknown"
  ) {
    return current;
  }

  return (
    current ===
    next
  )
    ? current
    : null;
}

function transitionKey(
  from: number,
  to: number
): string {
  return `${from}->${to}`;
}

export function buildMovementRouteNavigation(
  layout:
    SerializedLayoutDto
): MovementRouteNavigation {
  const rawLayout =
    layout as unknown as
      Record<string, unknown>;

  const topology =
    record(
      rawLayout.routeTopology
    );

  const routeTable =
    Array.isArray(
      topology?.routeTable
    )
      ? topology.routeTable
      : [];

  const transitions =
    new Map<
      string,
      {
        from: number;
        to: number;
        directions:
          Set<MovementTravelDirection>;
      }
    >();

  for (
    const rawRoute of
    routeTable
  ) {
    const route =
      record(
        rawRoute
      ) as RawRouteEntry | null;

    if (
      !route ||
      !Array.isArray(
        route.blockPath
      )
    ) {
      continue;
    }

    const direction =
      travelDirection(
        route.locoDirection
      );

    const blockIds =
      route.blockPath
        .map(
          raw => {
            const entry =
              record(
                raw
              ) as RawBlockPathEntry | null;

            return positiveInteger(
              entry?.id
            );
          }
        )
        .filter(
          (
            id
          ): id is number =>
            id !==
            null
        );

    for (
      let index = 0;
      index <
        blockIds.length - 1;
      index += 1
    ) {
      const from =
        blockIds[
          index
        ];

      const to =
        blockIds[
          index + 1
        ];

      if (
        from ===
          undefined ||
        to ===
          undefined ||
        from ===
          to
      ) {
        continue;
      }

      const key =
        transitionKey(
          from,
          to
        );

      let transition =
        transitions.get(
          key
        );

      if (!transition) {
        transition = {
          from,
          to,
          directions:
            new Set<
              MovementTravelDirection
            >(),
        };

        transitions.set(
          key,
          transition
        );
      }

      transition.directions.add(
        direction
      );
    }
  }

  const nextByBlockId =
    new Map<
      number,
      MovementRouteNext[]
    >();

  for (
    const transition of
    transitions.values()
  ) {
    let entries =
      nextByBlockId.get(
        transition.from
      );

    if (!entries) {
      entries = [];

      nextByBlockId.set(
        transition.from,
        entries
      );
    }

    entries.push({
      blockId:
        transition.to,
      directions: [
        ...transition.directions,
      ].sort(),
    });
  }

  for (
    const entries of
    nextByBlockId.values()
  ) {
    entries.sort(
      (
        a,
        b
      ) =>
        a.blockId -
        b.blockId
    );
  }

  return {
    nextByBlockId,
  };
}

export function getMovementSequenceDirections(
  navigation:
    MovementRouteNavigation,
  sequence:
    number[]
): MovementTravelDirection[] {
  if (
    sequence.length <
    2
  ) {
    return [
      "unknown",
    ];
  }

  let possible =
    new Set<
      MovementTravelDirection
    >([
      "unknown",
    ]);

  for (
    let index = 0;
    index <
      sequence.length - 1;
    index += 1
  ) {
    const from =
      sequence[
        index
      ];

    const to =
      sequence[
        index + 1
      ];

    if (
      from ===
        undefined ||
      to ===
        undefined
    ) {
      return [];
    }

    const transition =
      navigation.nextByBlockId
        .get(
          from
        )
        ?.find(
          item =>
            item.blockId ===
            to
        );

    if (!transition) {
      return [];
    }

    const merged =
      new Set<
        MovementTravelDirection
      >();

    for (
      const current of
      possible
    ) {
      for (
        const next of
        transition.directions
      ) {
        const direction =
          mergeDirection(
            current,
            next
          );

        if (
          direction !==
          null
        ) {
          merged.add(
            direction
          );
        }
      }
    }

    if (
      merged.size ===
      0
    ) {
      return [];
    }

    possible =
      merged;
  }

  return [
    ...possible,
  ].sort();
}

export function getCompatibleMovementNextBlockIds(
  navigation:
    MovementRouteNavigation,
  sequence:
    number[]
): number[] {
  const from =
    sequence[
      sequence.length -
      1
    ];

  if (
    from ===
    undefined
  ) {
    return [];
  }

  const used =
    new Set(
      sequence
    );

  return (
    navigation.nextByBlockId.get(
      from
    ) ??
    []
  )
    .filter(
      option =>
        !used.has(
          option.blockId
        ) &&
        getMovementSequenceDirections(
          navigation,
          [
            ...sequence,
            option.blockId,
          ]
        ).length >
          0
    )
    .map(
      option =>
        option.blockId
    );
}

export async function loadMovementRouteNavigation(): Promise<MovementRouteNavigation> {
  const response =
    await fetch(
      "/api/layout",
      {
        cache:
          "no-store",
      }
    );

  if (!response.ok) {
    throw new Error(
      `Layout could not be loaded (${response.status}).`
    );
  }

  const layout =
    await response.json() as
      SerializedLayoutDto;

  const navigation =
    buildMovementRouteNavigation(
      layout
    );

  if (
    navigation.nextByBlockId.size ===
    0
  ) {
    throw new Error(
      "No saved route topology. Generate and save the route graph first."
    );
  }

  return navigation;
}
