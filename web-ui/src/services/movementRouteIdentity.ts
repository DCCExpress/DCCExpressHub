type MovementRouteIdentityState = {
  address?: number;
  closed?: boolean;
};

export type MovementRouteIdentityEntry = {
  fromBlockId: number;
  toBlockId: number;
  blockPath?: Array<{
    id?: number;
    nodeIndex?: number;
  }>;
  nodes?: string[];
  edgePath?: Array<{
    from?: string;
    to?: string;
    locoDirection?: string;
    turnoutStates?: MovementRouteIdentityState[];
    turnoutPath?: Array<{
      elementId?: number;
      turnoutStates?: MovementRouteIdentityState[];
    }>;
  }>;
  locoDirection?: string;
};

function normalizedStates(
  states:
    MovementRouteIdentityState[] |
    undefined
): string[] {
  return (
    Array.isArray(
      states
    )
      ? states
      : []
  )
    .map(
      state => ({
        address:
          Number(
            state?.address ??
              0
          ),
        closed:
          state?.closed ===
          true,
      })
    )
    .filter(
      state =>
        Number.isInteger(
          state.address
        ) &&
        state.address >
          0
    )
    .sort(
      (
        left,
        right
      ) =>
        left.address -
        right.address
    )
    .map(
      state =>
        `${state.address}:${state.closed ? 1 : 0}`
    );
}

export function createMovementRouteKey(
  route:
    MovementRouteIdentityEntry
): string {
  const blockPath =
    (
      route.blockPath ??
      []
    ).map(
      block =>
        `${Number(block.id ?? 0)}@${Number(block.nodeIndex ?? 0)}`
    );

  const nodes =
    (
      route.nodes ??
      []
    ).map(
      node =>
        String(
          node
        )
    );

  const edgePath =
    (
      route.edgePath ??
      []
    ).map(
      edge => ({
        from:
          String(
            edge.from ??
              ""
          ),
        to:
          String(
            edge.to ??
              ""
          ),
        direction:
          String(
            edge.locoDirection ??
              "unknown"
          ),
        turnoutStates:
          normalizedStates(
            edge.turnoutStates
          ),
        turnoutPath:
          (
            edge.turnoutPath ??
            []
          ).map(
            passage => ({
              elementId:
                Number(
                  passage.elementId ??
                    0
                ),
              states:
                normalizedStates(
                  passage.turnoutStates
                ),
            })
          ),
      })
    );

  return JSON.stringify({
    fromBlockId:
      Number(
        route.fromBlockId
      ),
    toBlockId:
      Number(
        route.toBlockId
      ),
    blockPath,
    nodes,
    edgePath,
    direction:
      String(
        route.locoDirection ??
          "unknown"
      ),
  });
}
