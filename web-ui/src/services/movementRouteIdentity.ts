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
  partPath?: Array<{
    nodeName?: string;
    partKey?: string;
    partIndex?: number;
    fromSensor?: number | null;
    toSensor?: number | null;
    locoDirection?: string;
  }>;
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

  const partPath =
    (
      route.partPath ??
      []
    ).map(
      part => ({
        nodeName:
          String(
            part.nodeName ??
              ""
          ),
        partKey:
          String(
            part.partKey ??
              ""
          ),
        partIndex:
          Number(
            part.partIndex ??
              0
          ),
        fromSensor:
          part.fromSensor ===
            null
            ? null
            : Number(
                part.fromSensor ??
                  0
              ),
        toSensor:
          part.toSensor ===
            null
            ? null
            : Number(
                part.toSensor ??
                  0
              ),
        direction:
          String(
            part.locoDirection ??
              "unknown"
          ),
      })
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
    partPath,
    edgePath,
    direction:
      String(
        route.locoDirection ??
          "unknown"
      ),
  });
}
