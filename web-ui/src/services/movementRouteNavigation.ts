import type {
  SerializedLayoutDto,
} from "../domain/layout/layoutDto";

export type MovementRouteNavigation = {
  nextByBlockId:
    Map<number, number[]>;
};

type RawBlockPathEntry = {
  id?: unknown;
};

type RawRouteEntry = {
  blockPath?: unknown;
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

  const nextSets =
    new Map<
      number,
      Set<number>
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

      let targets =
        nextSets.get(
          from
        );

      if (!targets) {
        targets =
          new Set<number>();

        nextSets.set(
          from,
          targets
        );
      }

      targets.add(
        to
      );
    }
  }

  const nextByBlockId =
    new Map<
      number,
      number[]
    >();

  for (
    const [
      blockId,
      targets,
    ] of nextSets
  ) {
    nextByBlockId.set(
      blockId,
      [
        ...targets,
      ].sort(
        (
          a,
          b
        ) =>
          a -
          b
      )
    );
  }

  return {
    nextByBlockId,
  };
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
