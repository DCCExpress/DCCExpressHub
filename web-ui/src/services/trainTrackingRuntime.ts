import type {
  BlockStateChangedPayload,
} from "../domain/railwayRuntimeEvents";

import {
  isControlStationRuntimeActive,
  subscribeControlStationRuntime,
} from "./controlStationRuntime";

import {
  isLocoManagedByActiveMovement,
} from "./movementEngine";

import {
  wsApi,
} from "./wsApi";

import {
  wsClient,
} from "./wsClient";

type TrackingLogLevel =
  | "info"
  | "match"
  | "warn"
  | "error";

export type TrainTrackingLogEntry = {
  id: string;
  timestamp: number;
  level: TrackingLogLevel;
  message: string;
};

export type TrainTrackingState = {
  enabled: boolean;
  active: boolean;
  ready: boolean;
  logs: TrainTrackingLogEntry[];
};

type RawTurnoutState = {
  address: number;
  closed: boolean;
};

type RawTurnoutPassage = {
  turnoutStates?: RawTurnoutState[];
};

type RawRouteEdge = {
  turnoutStates?: RawTurnoutState[];
  turnoutPath?: RawTurnoutPassage[];
};

type RawBlockPathEntry = {
  id: number;
  name: string;
};

type RawRouteEntry = {
  fromBlockId: number;
  toBlockId: number;
  blockPath: RawBlockPathEntry[];
  edgePath: RawRouteEdge[];
  locoDirection:
    | "unknown"
    | "forward"
    | "reverse";
};

type TurnoutConfig = {
  outputMode:
    | "accessory"
    | "extended"
    | "vpin";
  closedValue: boolean;
  closedAspect: number;
  openedAspect: number;
};

const STORAGE_KEY =
  "dcc-express-hub.trainTracking.enabled";

const MAX_LOGS =
  300;

let enabled =
  typeof window !== "undefined" &&
  window.localStorage.getItem(
    STORAGE_KEY
  ) === "true";

let installed =
  false;

let ready =
  false;

let loading =
  false;

let routeTable:
  RawRouteEntry[] =
  [];

let blockStates:
  BlockStateChangedPayload =
  {};

const blockSensorToId =
  new Map<number, number>();

const sensorStates =
  new Map<number, boolean>();

const turnoutStates =
  new Map<number, boolean>();

const turnoutConfig =
  new Map<number, TurnoutConfig>();

const logs:
  TrainTrackingLogEntry[] =
  [];

const listeners =
  new Set<
    (
      state:
        TrainTrackingState
    ) => void
  >();

function id(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return (
    "tracking-" +
    Date.now().toString(36) +
    "-" +
    Math.random()
      .toString(36)
      .slice(2)
  );
}

function active(): boolean {
  return (
    enabled &&
    isControlStationRuntimeActive()
  );
}

function snapshot(): TrainTrackingState {
  return {
    enabled,
    active:
      active(),
    ready,
    logs:
      logs.map(
        entry => ({
          ...entry,
        })
      ),
  };
}

function emit(): void {
  const state =
    snapshot();

  for (
    const listener of
    listeners
  ) {
    listener(
      state
    );
  }
}

function log(
  level:
    TrackingLogLevel,
  message: string
): void {
  logs.push({
    id:
      id(),
    timestamp:
      Date.now(),
    level,
    message,
  });

  if (
    logs.length >
      MAX_LOGS
  ) {
    logs.splice(
      0,
      logs.length -
        MAX_LOGS
    );
  }

  emit();
}

function objectValue(
  value: unknown
): Record<string, unknown> | null {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(
      value
    )
  )
    ? value as Record<string, unknown>
    : null;
}

function integerValue(
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
    numeric >
      0
  )
    ? numeric
    : null;
}

function buildTurnoutConfig(
  layout: Record<string, unknown>
): void {
  turnoutConfig.clear();

  const layers =
    Array.isArray(
      layout.layers
    )
      ? layout.layers
      : [];

  for (
    const rawLayer of
    layers
  ) {
    const layer =
      objectValue(
        rawLayer
      );

    const elements =
      Array.isArray(
        layer?.elements
      )
        ? layer.elements
        : [];

    for (
      const rawElement of
      elements
    ) {
      const element =
        objectValue(
          rawElement
        );

      if (!element) {
        continue;
      }

      const type =
        String(
          element.type ??
          ""
        );

      const isTurnout =
        [
          "trackturnout",
          "trackturnoutleft",
          "trackturnoutright",
          "trackturnoutdouble",
          "trackturnouttwoway",
          "trackturnouttreeway",
        ].includes(
          type
        );

      if (!isTurnout) {
        continue;
      }

      const outputMode:
        TurnoutConfig["outputMode"] =
        element.outputMode ===
          "extended"
          ? "extended"
          : element.outputMode ===
              "vpin"
            ? "vpin"
            : "accessory";

      const add =
        (
          addressValue:
            unknown,
          closedValue:
            unknown,
          closedAspect:
            unknown,
          openedAspect:
            unknown
        ): void => {
          const address =
            integerValue(
              addressValue
            );

          if (!address) {
            return;
          }

          turnoutConfig.set(
            address,
            {
              outputMode,
              closedValue:
                Boolean(
                  closedValue ??
                  false
                ),
              closedAspect:
                Number(
                  closedAspect ??
                  0
                ),
              openedAspect:
                Number(
                  openedAspect ??
                  1
                ),
            }
          );
        };

      if (
        type ===
          "trackturnoutdouble" ||
        type ===
          "trackturnouttreeway"
      ) {
        add(
          element.turnout1Address,
          element.turnout1ClosedValue,
          element.turnout1ClosedAspect,
          element.turnout1OpenedAspect
        );

        add(
          element.turnout2Address,
          element.turnout2ClosedValue,
          element.turnout2ClosedAspect,
          element.turnout2OpenedAspect
        );
      } else {
        add(
          integerValue(
            element.turnoutAddress
          ) ??
            integerValue(
              element.address
            ),
          element.turnoutClosedValue,
          element.turnoutClosedAspect,
          element.turnoutOpenedAspect
        );
      }
    }
  }
}

function buildBlockSensors(
  layout:
    Record<string, unknown>
): void {
  blockSensorToId.clear();

  const layers =
    Array.isArray(
      layout.layers
    )
      ? layout.layers
      : [];

  for (
    const rawLayer of
    layers
  ) {
    const layer =
      objectValue(
        rawLayer
      );

    const elements =
      Array.isArray(
        layer?.elements
      )
        ? layer.elements
        : [];

    for (
      const rawElement of
      elements
    ) {
      const element =
        objectValue(
          rawElement
        );

      if (
        !element ||
        element.type !==
          "trackblock"
      ) {
        continue;
      }

      const blockId =
        integerValue(
          element.id
        );

      const sensor =
        integerValue(
          element.sensorAddress
        );

      if (
        blockId &&
        sensor
      ) {
        blockSensorToId.set(
          sensor,
          blockId
        );
      }
    }
  }
}

async function refreshTopology(): Promise<void> {
  if (loading) {
    return;
  }

  loading =
    true;

  try {
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
        `Layout load failed (${response.status}).`
      );
    }

    const raw =
      await response.json();

    const layout =
      objectValue(
        raw
      );

    if (!layout) {
      throw new Error(
        "Layout is not an object."
      );
    }

    const topology =
      objectValue(
        layout.routeTopology
      );

    const routes =
      Array.isArray(
        topology?.routeTable
      )
        ? topology.routeTable
        : [];

    routeTable =
      routes
        .map(
          route =>
            objectValue(
              route
            )
        )
        .filter(
          (
            route
          ): route is Record<string, unknown> =>
            route !==
              null
        )
        .map(
          route =>
            route as unknown as RawRouteEntry
        );

    buildBlockSensors(
      layout
    );

    buildTurnoutConfig(
      layout
    );

    ready =
      routeTable.length >
        0 &&
      blockSensorToId.size >
        0;

    log(
      ready
        ? "info"
        : "warn",
      ready
        ? `Tracking topology ready: ${routeTable.length} routes, ${blockSensorToId.size} blocks.`
        : "Tracking topology is incomplete. Generate/save the route graph and configure block occupancy sensors."
    );
  } catch (
    error
  ) {
    ready =
      false;

    log(
      "error",
      `Tracking topology load failed: ${
        error instanceof Error
          ? error.message
          : String(
              error
            )
      }`
    );
  } finally {
    loading =
      false;

    emit();
  }
}

function routeTurnoutStates(
  route:
    RawRouteEntry
): RawTurnoutState[] {
  const byAddress =
    new Map<
      number,
      boolean
    >();

  for (
    const edge of
    route.edgePath ??
    []
  ) {
    for (
      const state of
      edge.turnoutStates ??
      []
    ) {
      if (
        Number.isInteger(
          state.address
        ) &&
        state.address >
          0
      ) {
        byAddress.set(
          state.address,
          state.closed ===
            true
        );
      }
    }

    for (
      const passage of
      edge.turnoutPath ??
      []
    ) {
      for (
        const state of
        passage.turnoutStates ??
        []
      ) {
        if (
          Number.isInteger(
            state.address
          ) &&
          state.address >
            0
        ) {
          byAddress.set(
            state.address,
            state.closed ===
              true
          );
        }
      }
    }
  }

  return [
    ...byAddress.entries(),
  ].map(
    ([
      address,
      closed,
    ]) => ({
      address,
      closed,
    })
  );
}

function routeMatchesTurnouts(
  route:
    RawRouteEntry
): {
  matches: boolean;
  unknown: number[];
} {
  const unknown:
    number[] =
    [];

  for (
    const required of
    routeTurnoutStates(
      route
    )
  ) {
    const current =
      turnoutStates.get(
        required.address
      );

    if (
      current ===
        undefined
    ) {
      unknown.push(
        required.address
      );

      continue;
    }

    if (
      current !==
        required.closed
    ) {
      return {
        matches:
          false,
        unknown,
      };
    }
  }

  return {
    matches:
      unknown.length ===
        0,
    unknown,
  };
}

function directRoutes(
  fromBlockId: number,
  toBlockId: number,
  direction:
    "forward" |
    "reverse"
): RawRouteEntry[] {
  return routeTable.filter(
    route =>
      route.fromBlockId ===
        fromBlockId &&
      route.toBlockId ===
        toBlockId &&
      route.locoDirection ===
        direction &&
      route.blockPath?.length ===
        2 &&
      route.blockPath[0]?.id ===
        fromBlockId &&
      route.blockPath[1]?.id ===
        toBlockId
  );
}

type Candidate = {
  sourceBlockId: number;
  sourceBlockName: string;
  locoAddress: number;
  locoId: string | null;
  routeCount: number;
};

function evaluateDestination(
  destinationBlockId:
    number
): void {
  if (
    !active() ||
    !ready
  ) {
    return;
  }

  const destinationState =
    blockStates[
      String(
        destinationBlockId
      )
    ];

  if (
    (destinationState?.locoAddress ??
      0) >
      0
  ) {
    log(
      "info",
      `Block ${destinationBlockId} became occupied but already has loco #${destinationState?.locoAddress}; tracking skipped.`
    );

    return;
  }

  const candidates =
    new Map<
      number,
      Candidate
    >();

  for (
    const [
      rawBlockId,
      sourceState,
    ] of Object.entries(
      blockStates
    )
  ) {
    const sourceBlockId =
      Number(
        rawBlockId
      );

    const locoAddress =
      Number(
        sourceState.locoAddress ??
        0
      );

    if (
      !Number.isInteger(
        sourceBlockId
      ) ||
      sourceBlockId ===
        destinationBlockId ||
      !Number.isInteger(
        locoAddress
      ) ||
      locoAddress <=
        0
    ) {
      continue;
    }

    if (
      isLocoManagedByActiveMovement(
        locoAddress
      )
    ) {
      continue;
    }

    const loco =
      wsClient.getLatestLocoState(
        locoAddress
      );

    if (
      !loco ||
      loco.speed <=
        0
    ) {
      continue;
    }

    const direction =
      loco.direction ===
        "reverse"
        ? "reverse"
        : "forward";

    const routes =
      directRoutes(
        sourceBlockId,
        destinationBlockId,
        direction
      );

    const matching =
      routes.filter(
        route =>
          routeMatchesTurnouts(
            route
          ).matches
      );

    if (
      matching.length ===
        0
    ) {
      continue;
    }

    candidates.set(
      locoAddress,
      {
        sourceBlockId,
        sourceBlockName:
          routes[0]?.blockPath[0]?.name ??
          `Block ${sourceBlockId}`,
        locoAddress,
        locoId:
          sourceState.locoId ??
          null,
        routeCount:
          matching.length,
      }
    );
  }

  const values =
    [
      ...candidates.values(),
    ];

  if (
    values.length ===
      0
  ) {
    log(
      "warn",
      `Block ${destinationBlockId} occupancy ON: no unambiguous moving locomotive matches direction + graph + turnout state.`
    );

    return;
  }

  if (
    values.length >
      1
  ) {
    log(
      "warn",
      `Block ${destinationBlockId} occupancy ON is ambiguous: ${values.map(candidate => `#${candidate.locoAddress} from block ${candidate.sourceBlockId}`).join(", ")}.`
    );

    return;
  }

  const candidate =
    values[0]!;

  const sent =
    wsApi.setBlock(
      String(
        destinationBlockId
      ),
      candidate.locoId,
      candidate.locoAddress
    );

  if (!sent) {
    log(
      "error",
      `Tracking could not assign loco #${candidate.locoAddress} to block ${destinationBlockId}: WebSocket send failed.`
    );

    return;
  }

  log(
    "match",
    `Tracked loco #${candidate.locoAddress}: block ${candidate.sourceBlockId} -> ${destinationBlockId} (${candidate.routeCount} matching route${candidate.routeCount === 1 ? "" : "s"}).`
  );

  wsApi.getBlocks();
}

function updateTurnoutFromPhysical(
  address: number,
  physical:
    boolean | number
): void {
  const config =
    turnoutConfig.get(
      address
    );

  if (!config) {
    return;
  }

  if (
    config.outputMode ===
      "extended"
  ) {
    const aspect =
      Number(
        physical
      );

    if (
      aspect ===
        config.closedAspect
    ) {
      turnoutStates.set(
        address,
        true
      );
    } else if (
      aspect ===
        config.openedAspect
    ) {
      turnoutStates.set(
        address,
        false
      );
    }

    return;
  }

  turnoutStates.set(
    address,
    Boolean(
      physical
    ) ===
      config.closedValue
  );
}

function requestRuntimeState(): void {
  wsApi.getBlocks();
  wsApi.getLayoutRuntimeSnapshot();
}

export function installTrainTrackingRuntime(): void {
  if (installed) {
    return;
  }

  installed =
    true;

  subscribeControlStationRuntime(
    controlActive => {
      if (
        enabled &&
        controlActive
      ) {
        log(
          "info",
          "Tracking active on this Control Station."
        );

        void refreshTopology();

        requestRuntimeState();
      } else if (
        enabled
      ) {
        log(
          "warn",
          "Tracking enabled but inactive: this client is not the Control Station."
        );
      }

      emit();
    }
  );

  wsClient.subscribeStatus(
    status => {
      if (
        status ===
          "connected" &&
        active()
      ) {
        void refreshTopology();
        requestRuntimeState();
      }
    }
  );

  wsClient.on(
    "blockStateChanged",
    data => {
      blockStates =
        data;
    }
  );

  wsClient.on(
    "sensorSnapshot",
    data => {
      for (
        const [
          baseAddress,
          activeBits,
          knownBits,
        ] of data.groups
      ) {
        for (
          let offset = 0;
          offset <
            16;
          offset +=
            1
        ) {
          const bit =
            1 <<
            offset;

          if (
            (
              knownBits &
              bit
            ) ===
              0
          ) {
            continue;
          }

          sensorStates.set(
            baseAddress +
              offset,
            (
              activeBits &
                bit
            ) !==
              0
          );
        }
      }
    }
  );

  wsClient.on(
    "sensorChanged",
    data => {
      const previous =
        sensorStates.get(
          data.address
        );

      sensorStates.set(
        data.address,
        data.on
      );

      if (
        previous ===
          undefined ||
        previous ===
          data.on ||
        !data.on ||
        !active()
      ) {
        return;
      }

      const blockId =
        blockSensorToId.get(
          data.address
        );

      if (!blockId) {
        return;
      }

      log(
        "info",
        `Block ${blockId} occupancy sensor #${data.address} -> ON; evaluating candidates.`
      );

      evaluateDestination(
        blockId
      );
    }
  );

  wsClient.on(
    "turnoutChanged",
    data => {
      if (
        typeof data.logicalClosed ===
          "boolean"
      ) {
        turnoutStates.set(
          data.address,
          data.logicalClosed
        );

        return;
      }

      updateTurnoutFromPhysical(
        data.address,
        data.outputMode ===
            "extended" &&
          typeof data.aspect ===
            "number"
          ? data.aspect
          : data.closed
      );
    }
  );

  wsClient.on(
    "accessoryChanged",
    data => {
      updateTurnoutFromPhysical(
        data.address,
        data.active
      );
    }
  );

  wsClient.on(
    "signalAspectChanged",
    data => {
      updateTurnoutFromPhysical(
        data.address,
        data.aspect
      );
    }
  );

  wsClient.on(
    "vpinChanged",
    data => {
      updateTurnoutFromPhysical(
        data.vpin,
        data.active
      );
    }
  );

  wsClient.subscribeMessages(
    message => {
      const raw =
        message as unknown as {
          type?: string;
          data?: unknown;
        };

      if (
        raw.type !==
          "runtimePhysicalSnapshot"
      ) {
        return;
      }

      const snapshot =
        objectValue(
          raw.data
        );

      for (
        const rawItem of
        Array.isArray(
          snapshot?.basicAccessories
        )
          ? snapshot.basicAccessories
          : []
      ) {
        const item =
          objectValue(
            rawItem
          );

        const address =
          integerValue(
            item?.address
          );

        if (
          address &&
          item
        ) {
          updateTurnoutFromPhysical(
            address,
            Boolean(
              item.active
            )
          );
        }
      }

      for (
        const rawItem of
        Array.isArray(
          snapshot?.extendedAccessories
        )
          ? snapshot.extendedAccessories
          : []
      ) {
        const item =
          objectValue(
            rawItem
          );

        const address =
          integerValue(
            item?.address
          );

        if (
          address &&
          item
        ) {
          updateTurnoutFromPhysical(
            address,
            Number(
              item.aspect
            )
          );
        }
      }
    }
  );

  if (
    active()
  ) {
    void refreshTopology();
    requestRuntimeState();
  }
}

export function setTrainTrackingEnabled(
  value: boolean
): void {
  const next =
    Boolean(
      value
    );

  if (
    enabled ===
      next
  ) {
    return;
  }

  enabled =
    next;

  if (
    typeof window !==
      "undefined"
  ) {
    window.localStorage.setItem(
      STORAGE_KEY,
      enabled
        ? "true"
        : "false"
    );
  }

  log(
    "info",
    enabled
      ? "Tracking enabled."
      : "Tracking disabled."
  );

  if (
    active()
  ) {
    void refreshTopology();
    requestRuntimeState();
  }

  emit();
}

export function clearTrainTrackingLogs(): void {
  logs.length =
    0;

  emit();
}

export function getTrainTrackingState(): TrainTrackingState {
  return snapshot();
}

export function subscribeTrainTrackingState(
  listener:
    (
      state:
        TrainTrackingState
    ) => void
): () => void {
  listeners.add(
    listener
  );

  listener(
    snapshot()
  );

  return () => {
    listeners.delete(
      listener
    );
  };
}

export function refreshTrainTracking(): void {
  if (!active()) {
    return;
  }

  void refreshTopology();
  requestRuntimeState();
}
