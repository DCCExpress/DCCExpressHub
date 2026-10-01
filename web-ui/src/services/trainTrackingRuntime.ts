import type {
  BlockStateChangedPayload,
} from "../domain/railwayRuntimeEvents";

import {
  isControlStationRuntimeActive,
  subscribeControlStationRuntime,
} from "./controlStationRuntime";

import {
  isLocoManagedByDispatcherExecution,
} from "./dispatcherExecutionRuntime";

import {
  wsApi,
} from "./wsApi";

import {
  wsClient,
} from "./wsClient";

import {
  clearTrainTrackingPredictions,
  replaceTrainTrackingPredictions,
} from "./trainTrackingPredictionRuntime";

type TrackingLogLevel =
  | "info"
  | "match"
  | "warn"
  | "error";

export type LocoTrackingConfidence =
  | "certain"
  | "likely"
  | "ambiguous";

export type LocoTrackingState = {
  locoAddress: number;
  locoId: string | null;
  currentBlockId: number | null;
  currentBlockName: string | null;
  currentSensors: number[];
  currentSectionParts: string[];
  predictedNextBlockId: number | null;
  predictedNextBlockName: string | null;
  lastSensor: number | null;
  recentSensorPath: number[];
  confidence: LocoTrackingConfidence;
  updatedAt: number;
};

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
  readinessIssues: string[];
  readinessWarnings: string[];
  locos: LocoTrackingState[];
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

type RawRoutePart = {
  nodeName?: string;
  partKey?: string;
  partIndex?: number;
  fromSensor?: number | null;
  toSensor?: number | null;
  detectors?: number[];
};

type RawGraphSectionPart = {
  key?: string;
  index?: number;
  detectors?: number[];
  fromSensor?: number | null;
  toSensor?: number | null;
};

type RawGraphNode = {
  name?: string;
  sectionParts?: RawGraphSectionPart[];
};

type RawRouteEntry = {
  fromBlockId: number;
  fromBlockName?: string;
  toBlockId: number;
  toBlockName?: string;
  blockPath: RawBlockPathEntry[];
  partPath?: RawRoutePart[];
  edgePath: RawRouteEdge[];
  turnoutStates?: RawTurnoutState[];
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

type SensorPathCandidate = {
  tracking: LocoTrackingState;
  route: RawRouteEntry;
  sensorPath: number[];
  sensorIndex: number;
};

const STORAGE_KEY =
  "dcc-express-hub.trainTracking.enabled";

const MAX_LOGS =
  300;

const MAX_RECENT_SENSORS =
  32;

let enabled =
  typeof window !== "undefined" &&
  window.localStorage.getItem(
    STORAGE_KEY
  ) === "true";

let installed =
  false;

let ready =
  false;

let readinessIssues:
  string[] =
  [];

let readinessWarnings:
  string[] =
  [];

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

const blockIdToSensor =
  new Map<number, number>();

const blockNames =
  new Map<number, string>();

const sensorStates =
  new Map<number, boolean>();

const turnoutStates =
  new Map<number, boolean>();

const turnoutConfig =
  new Map<number, TurnoutConfig>();

const locoTracking =
  new Map<number, LocoTrackingState>();

/*
 * Once turnout state + a sensor event select one physical direct route, keep
 * that route committed for the locomotive until it reaches the destination
 * block. This prevents a turnout changed behind the train from retroactively
 * moving the locomotive to another branch.
 */
const committedRoutes =
  new Map<number, RawRouteEntry>();

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

function trackingId(): string {
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
    Math.random().toString(36).slice(2)
  );
}

function active(): boolean {
  return (
    enabled &&
    ready &&
    isControlStationRuntimeActive()
  );
}

function copyTracking(
  state:
    LocoTrackingState
): LocoTrackingState {
  return {
    ...state,
    currentSensors:
      [...state.currentSensors],
    currentSectionParts:
      [...state.currentSectionParts],
    recentSensorPath:
      [...state.recentSensorPath],
  };
}

function snapshot(): TrainTrackingState {
  return {
    enabled,
    active:
      active(),
    ready,
    readinessIssues:
      [...readinessIssues],
    readinessWarnings:
      [...readinessWarnings],
    locos:
      [...locoTracking.values()]
        .map(copyTracking)
        .sort(
          (
            left,
            right
          ) =>
            left.locoAddress -
            right.locoAddress
        ),
    logs:
      logs.map(
        entry => ({
          ...entry,
        })
      ),
  };
}

function emit(): void {
  syncTrackingPredictions();

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
      trackingId(),
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

function addRecentSensor(
  state:
    LocoTrackingState,
  sensor: number
): void {
  if (
    state.recentSensorPath[
      state.recentSensorPath.length -
        1
    ] !==
      sensor
  ) {
    state.recentSensorPath.push(
      sensor
    );
  }

  if (
    state.recentSensorPath.length >
      MAX_RECENT_SENSORS
  ) {
    state.recentSensorPath.splice(
      0,
      state.recentSensorPath.length -
        MAX_RECENT_SENSORS
    );
  }
}

function buildTurnoutConfig(
  layout:
    Record<string, unknown>
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

      if (
        ![
          "trackturnout",
          "trackturnoutleft",
          "trackturnoutright",
          "trackturnoutdouble",
          "trackturnouttwoway",
          "trackturnouttreeway",
        ].includes(
          type
        )
      ) {
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

function buildBlocks(
  layout:
    Record<string, unknown>
): void {
  blockSensorToId.clear();
  blockIdToSensor.clear();
  blockNames.clear();

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

      if (!blockId) {
        continue;
      }

      const sensor =
        integerValue(
          element.sensorAddress
        );

      blockNames.set(
        blockId,
        String(
          element.name ??
          `Block ${blockId}`
        ).trim() ||
        `Block ${blockId}`
      );

      if (sensor) {
        blockSensorToId.set(
          sensor,
          blockId
        );

        blockIdToSensor.set(
          blockId,
          sensor
        );
      }
    }
  }
}

function seedTrackingFromBlocks(
  nextBlockStates:
    BlockStateChangedPayload
): void {
  const assignedLocos =
    new Set<number>();

  for (
    const [
      rawBlockId,
      block,
    ] of Object.entries(
      nextBlockStates
    )
  ) {
    const blockId =
      Number(
        rawBlockId
      );

    const locoAddress =
      Number(
        block.locoAddress ??
        0
      );

    if (
      !Number.isInteger(
        blockId
      ) ||
      blockId <=
        0 ||
      !Number.isInteger(
        locoAddress
      ) ||
      locoAddress <=
        0
    ) {
      continue;
    }

    assignedLocos.add(
      locoAddress
    );

    const sensor =
      blockIdToSensor.get(
        blockId
      ) ??
      null;

    const current =
      locoTracking.get(
        locoAddress
      );

    const blockChanged =
      current?.currentBlockId !==
        blockId;

    /*
     * During an active Movement, a backend block assignment is not enough to
     * advance physical Tracking. Movement is allowed to own the block runtime,
     * but Tracking only accepts a changed block after that block's own
     * occupancy sensor is physically ON.
     *
     * Manual/setup block assignment remains a valid anchor when no Movement
     * owns the locomotive.
     */
    if (
      current &&
      blockChanged &&
      isLocoManagedByDispatcherExecution(
        locoAddress
      ) &&
      (
        sensor ===
          null ||
        sensorStates.get(
          sensor
        ) !==
          true
      )
    ) {
      log(
        "warn",
        `Tracking ignored premature Movement block assignment for loco #${locoAddress}: ${blockNames.get(blockId) ?? `Block ${blockId}`} / sensor ${sensor === null ? "NONE" : `#${sensor}`} is not ON.`
      );

      continue;
    }

    if (
      blockChanged
    ) {
      committedRoutes.delete(
        locoAddress
      );

      if (
        current
      ) {
        current.currentSectionParts =
          [];
      }
    }

    const next:
      LocoTrackingState =
      current
        ? copyTracking(
            current
          )
        : {
            locoAddress,
            locoId:
              block.locoId ??
              null,
            currentBlockId:
              blockId,
            currentBlockName:
              blockNames.get(
                blockId
              ) ??
              `Block ${blockId}`,
            currentSensors:
              [],
            currentSectionParts:
              [],
            predictedNextBlockId:
              null,
            predictedNextBlockName:
              null,
            lastSensor:
              null,
            recentSensorPath:
              [],
            confidence:
              "certain",
            updatedAt:
              Date.now(),
          };

    next.locoId =
      block.locoId ??
      next.locoId;

    next.currentBlockId =
      blockId;

    next.currentBlockName =
      blockNames.get(
        blockId
      ) ??
      `Block ${blockId}`;

    /*
     * Putting a loco into a block is an explicit tracking anchor.
     * The block occupancy sensor is therefore a known position even if the
     * physical sensor is currently OFF (for example during setup).
     */
    if (
      sensor &&
      (
        blockChanged ||
        next.lastSensor ===
          null
      )
    ) {
      next.lastSensor =
        sensor;

      if (
        !next.currentSensors.includes(
          sensor
        )
      ) {
        next.currentSensors.push(
          sensor
        );
      }

      addRecentSensor(
        next,
        sensor
      );

      next.confidence =
        "certain";

      next.updatedAt =
        Date.now();

      log(
        "info",
        `Tracking anchor loco #${locoAddress}: ${next.currentBlockName} / sensor #${sensor}.`
      );
    }

    locoTracking.set(
      locoAddress,
      next
    );
  }

  for (
    const address of
    [...locoTracking.keys()]
  ) {
    if (
      assignedLocos.has(
        address
      )
    ) {
      continue;
    }

    locoTracking.delete(
      address
    );

    committedRoutes.delete(
      address
    );

    log(
      "info",
      `Tracking removed loco #${address}: it is no longer assigned to any block.`
    );
  }
}

function validateTrackingTopology(
  topology:
    Record<string, unknown> | null
): {
  issues: string[];
  warnings: string[];
} {
  const issues:
    string[] =
    [];

  const warnings:
    string[] =
    [];

  /*
   * Hard requirement: every logical block must have an occupancy sensor.
   * This is the authoritative anchor for assigning a locomotive to tracking.
   */
  for (
    const [
      blockId,
      name,
    ] of blockNames
  ) {
    if (
      !blockIdToSensor.has(
        blockId
      )
    ) {
      issues.push(
        `Block "${name}" has no occupancy sensor.`
      );
    }
  }

  const graph =
    objectValue(
      topology?.graph
    );

  const nodes =
    Array.isArray(
      graph?.nodes
    )
      ? graph.nodes
      : [];

  for (
    const rawNode of
    nodes
  ) {
    const node =
      objectValue(
        rawNode
      ) as RawGraphNode | null;

    if (!node) {
      continue;
    }

    const parts =
      Array.isArray(
        node.sectionParts
      )
        ? node.sectionParts
        : [];

    for (
      const rawPart of
      parts
    ) {
      const part =
        objectValue(
          rawPart
        ) as RawGraphSectionPart | null;

      if (!part) {
        continue;
      }

      const sensors =
        uniqueSensors(
          Array.isArray(
            part.detectors
          )
            ? part.detectors
            : []
        );

      if (
        sensors.length ===
          0
      ) {
        const nodeName =
          String(
            node.name ??
            "?"
          );

        const partName =
          String(
            part.key ??
            part.index ??
            "?"
          );

        warnings.push(
          `SectionPart "${nodeName} / ${partName}" has no sensor; tracking will be less precise there.`
        );
      }
    }
  }

  if (
    routeTable.length ===
      0
  ) {
    issues.push(
      "Route graph has no routes."
    );
  }

  return {
    issues,
    warnings,
  };
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

    buildBlocks(
      layout
    );

    buildTurnoutConfig(
      layout
    );

    seedTrackingFromBlocks(
      blockStates
    );

    const validation =
      validateTrackingTopology(
        topology
      );

    readinessIssues =
      validation.issues;

    readinessWarnings =
      validation.warnings;

    ready =
      readinessIssues.length ===
        0;

    log(
      ready
        ? "info"
        : "warn",
      ready
        ? `Tracking topology ready: ${routeTable.length} routes, ${blockSensorToId.size} block sensors.`
        : `Tracking cannot start: ${readinessIssues.join(" ")}`
    );
  } catch (
    error
  ) {
    ready =
      false;

    readinessIssues =
      [
        error instanceof Error
          ? error.message
          : String(
              error
            ),
      ];

    readinessWarnings =
      [];

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
    const state of
    route.turnoutStates ??
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
): boolean {
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
        undefined ||
      current !==
        required.closed
    ) {
      return false;
    }
  }

  return true;
}

function directRoutesFromBlock(
  fromBlockId: number,
  direction:
    "forward" |
    "reverse"
): RawRouteEntry[] {
  return routeTable.filter(
    route =>
      route.fromBlockId ===
        fromBlockId &&
      route.locoDirection ===
        direction &&
      route.blockPath?.length ===
        2 &&
      route.blockPath[0]?.id ===
        fromBlockId &&
      route.blockPath[1]?.id ===
        route.toBlockId &&
      routeMatchesTurnouts(
        route
      )
  );
}

function predictedRouteForTracking(
  tracking:
    LocoTrackingState
): RawRouteEntry | null {
  if (
    !active() ||
    tracking.currentBlockId ===
      null
  ) {
    return null;
  }

  const loco =
    wsClient.getLatestLocoState(
      tracking.locoAddress
    );

  if (!loco) {
    return null;
  }

  const direction =
    loco.direction ===
      "reverse"
      ? "reverse"
      : "forward";

  const committed =
    committedRoutes.get(
      tracking.locoAddress
    );

  if (
    committed &&
    committed.fromBlockId ===
      tracking.currentBlockId &&
    committed.locoDirection ===
      direction
  ) {
    return committed;
  }

  const routes =
    directRoutesFromBlock(
      tracking.currentBlockId,
      direction
    );

  if (
    routes.length ===
      0
  ) {
    return null;
  }

  const destinations =
    new Set(
      routes.map(
        route =>
          route.toBlockId
      )
    );

  return destinations.size ===
      1
    ? routes[0]!
    : null;
}

function syncTrackingPredictions(): void {
  if (
    !active()
  ) {
    for (
      const tracking of
      locoTracking.values()
    ) {
      tracking.predictedNextBlockId =
        null;
      tracking.predictedNextBlockName =
        null;
    }

    clearTrainTrackingPredictions();

    return;
  }

  const visualPredictions:
    Array<{
      blockId: number;
      blockName: string | null;
      locoAddress: number;
    }> =
    [];

  for (
    const tracking of
    locoTracking.values()
  ) {
    /*
     * Prediction is deliberately PHYSICAL, not planned intent.
     *
     * Even while Dispatcher/Movement is active, the predicted next block must
     * reflect the locomotive direction + the CURRENT turnout state in the
     * graph. Planned Movement intent is represented separately by targetLoco.
     * Mixing the two makes the prediction claim a route that the turnouts do
     * not physically provide yet.
     */
    const route =
      predictedRouteForTracking(
        tracking
      );

    tracking.predictedNextBlockId =
      route?.toBlockId ??
      null;

    tracking.predictedNextBlockName =
      route
        ? (
            route.toBlockName ??
            blockNames.get(
              route.toBlockId
            ) ??
            `Block ${route.toBlockId}`
          )
        : null;

    if (
      route &&
      route.toBlockId !==
        tracking.currentBlockId
    ) {
      visualPredictions.push({
        blockId:
          route.toBlockId,
        blockName:
          tracking.predictedNextBlockName,
        locoAddress:
          tracking.locoAddress,
      });
    }
  }

  replaceTrainTrackingPredictions(
    visualPredictions
  );
}

function uniqueSensors(
  values: Array<
    number |
    null |
    undefined
  >
): number[] {
  const result:
    number[] =
    [];

  const used =
    new Set<number>();

  for (
    const value of
    values
  ) {
    if (
      !Number.isInteger(
        value
      ) ||
      (value ?? 0) <=
        0
    ) {
      continue;
    }

    const sensor =
      Number(
        value
      );

    if (
      used.has(
        sensor
      )
    ) {
      continue;
    }

    used.add(
      sensor
    );

    result.push(
      sensor
    );
  }

  return result;
}

function routeSensorPath(
  route:
    RawRouteEntry
): number[] {
  const values:
    Array<
      number |
      null |
      undefined
    > =
    [
      blockIdToSensor.get(
        route.fromBlockId
      ),
    ];

  for (
    const part of
    route.partPath ??
    []
  ) {
    values.push(
      part.fromSensor
    );

    for (
      const detector of
      part.detectors ??
      []
    ) {
      values.push(
        detector
      );
    }

    values.push(
      part.toSensor
    );
  }

  values.push(
    blockIdToSensor.get(
      route.toBlockId
    )
  );

  return uniqueSensors(
    values
  );
}

function sectionPartsForSensors(
  route:
    RawRouteEntry,
  sensors:
    number[]
): string[] {
  const active =
    new Set(
      sensors
    );

  return (
    route.partPath ??
    []
  )
    .filter(
      part => {
        if (
          part.fromSensor !==
            null &&
          part.fromSensor !==
            undefined &&
          active.has(
            part.fromSensor
          )
        ) {
          return true;
        }

        if (
          part.toSensor !==
            null &&
          part.toSensor !==
            undefined &&
          active.has(
            part.toSensor
          )
        ) {
          return true;
        }

        return (
          part.detectors ??
          []
        ).some(
          detector =>
            active.has(
              detector
            )
        );
      }
    )
    .map(
      part =>
        `${part.nodeName ?? "?"} / ${part.partKey ?? part.partIndex ?? "?"}`
    )
    .filter(
      (
        value,
        index,
        values
      ) =>
        values.indexOf(
          value
        ) ===
          index
    );
}

function candidateFromRoute(
  tracking:
    LocoTrackingState,
  route:
    RawRouteEntry,
  sensor:
    number
): SensorPathCandidate | null {
  const sensorPath =
    routeSensorPath(
      route
    );

  const targetIndex =
    sensorPath.indexOf(
      sensor
    );

  if (
    targetIndex <
      0
  ) {
    return null;
  }

  const anchor =
    tracking.lastSensor ??
    blockIdToSensor.get(
      tracking.currentBlockId ??
        0
    ) ??
    null;

  const anchorIndex =
    anchor ===
      null
      ? -1
      : sensorPath.lastIndexOf(
          anchor
        );

  if (
    anchorIndex >=
      targetIndex
  ) {
    return null;
  }

  return {
    tracking,
    route,
    sensorPath,
    sensorIndex:
      targetIndex,
  };
}

function candidateForSensor(
  tracking:
    LocoTrackingState,
  sensor: number
): SensorPathCandidate[] {
  if (
    tracking.currentBlockId ===
      null
  ) {
    return [];
  }

  const loco =
    wsClient.getLatestLocoState(
      tracking.locoAddress
    );

  if (
    !loco ||
    loco.speed <=
      0
  ) {
    return [];
  }

  const direction =
    loco.direction ===
      "reverse"
      ? "reverse"
      : "forward";

  const committed =
    committedRoutes.get(
      tracking.locoAddress
    );

  if (
    committed &&
    committed.fromBlockId ===
      tracking.currentBlockId &&
    committed.locoDirection ===
      direction
  ) {
    const candidate =
      candidateFromRoute(
        tracking,
        committed,
        sensor
      );

    if (
      candidate
    ) {
      return [
        candidate,
      ];
    }
  }

  const result:
    SensorPathCandidate[] =
    [];

  for (
    const route of
    directRoutesFromBlock(
      tracking.currentBlockId,
      direction
    )
  ) {
    const candidate =
      candidateFromRoute(
        tracking,
        route,
        sensor
      );

    if (
      candidate
    ) {
      result.push(
        candidate
      );
    }
  }

  return result;
}

function handleSensorOn(
  sensor: number
): void {
  if (
    !active() ||
    !ready
  ) {
    return;
  }

  const uniqueCandidates:
    SensorPathCandidate[] =
    [];

  const ambiguousLocos:
    number[] =
    [];

  for (
    const tracking of
    locoTracking.values()
  ) {
    const matches =
      candidateForSensor(
        tracking,
        sensor
      );

    if (
      matches.length ===
        1
    ) {
      uniqueCandidates.push(
        matches[0]!
      );
    } else if (
      matches.length >
        1
    ) {
      tracking.confidence =
        "ambiguous";

      tracking.updatedAt =
        Date.now();

      ambiguousLocos.push(
        tracking.locoAddress
      );
    }
  }

  if (
    ambiguousLocos.length >
      0 ||
    uniqueCandidates.length >
      1
  ) {
    const addresses =
      [
        ...new Set([
          ...ambiguousLocos,
          ...uniqueCandidates.map(
            candidate =>
              candidate.tracking.locoAddress
          ),
        ]),
      ];

    for (
      const address of
      addresses
    ) {
      const tracking =
        locoTracking.get(
          address
        );

      if (tracking) {
        tracking.confidence =
          "ambiguous";

        tracking.updatedAt =
          Date.now();
      }
    }

    log(
      "warn",
      `Sensor #${sensor} -> ON is ambiguous: ${addresses.map(address => `#${address}`).join(", ")}.`
    );

    emit();

    return;
  }

  if (
    uniqueCandidates.length !==
      1
  ) {
    log(
      "warn",
      `Sensor #${sensor} -> ON: no moving tracked locomotive matches graph + direction + turnout state.`
    );

    return;
  }

  const candidate =
    uniqueCandidates[0]!;

  const previousCommitted =
    committedRoutes.get(
      candidate.tracking.locoAddress
    );

  if (
    previousCommitted !==
      candidate.route
  ) {
    committedRoutes.set(
      candidate.tracking.locoAddress,
      candidate.route
    );

    if (
      previousCommitted
    ) {
      log(
        "warn",
        `Tracking route changed for loco #${candidate.tracking.locoAddress}: live turnout state + sensor #${sensor} selected ${candidate.route.fromBlockName ?? candidate.route.fromBlockId} -> ${candidate.route.toBlockName ?? candidate.route.toBlockId}.`
      );
    } else {
      log(
        "info",
        `Tracking route committed for loco #${candidate.tracking.locoAddress}: ${candidate.route.fromBlockName ?? candidate.route.fromBlockId} -> ${candidate.route.toBlockName ?? candidate.route.toBlockId}.`
      );
    }
  }

  const state =
    locoTracking.get(
      candidate.tracking.locoAddress
    );

  if (!state) {
    return;
  }

  if (
    !state.currentSensors.includes(
      sensor
    )
  ) {
    state.currentSensors.push(
      sensor
    );
  }

  state.currentSectionParts =
    sectionPartsForSensors(
      candidate.route,
      state.currentSensors
    );

  state.lastSensor =
    sensor;

  addRecentSensor(
    state,
    sensor
  );

  state.confidence =
    "likely";

  state.updatedAt =
    Date.now();

  const destinationBlockId =
    blockSensorToId.get(
      sensor
    ) ??
    null;

  if (
    destinationBlockId !==
      null &&
    destinationBlockId ===
      candidate.route.toBlockId
  ) {
    state.currentBlockId =
      destinationBlockId;

    state.currentBlockName =
      blockNames.get(
        destinationBlockId
      ) ??
      candidate.route.toBlockName ??
      `Block ${destinationBlockId}`;

    state.confidence =
      "certain";

    committedRoutes.delete(
      state.locoAddress
    );

    state.currentSectionParts =
      [];

    const movementOwned =
      isLocoManagedByDispatcherExecution(
        state.locoAddress
      );

    if (!movementOwned) {
      const sent =
        wsApi.setBlock(
          String(
            destinationBlockId
          ),
          state.locoId,
          state.locoAddress
        );

      if (!sent) {
        log(
          "error",
          `Tracking could not assign loco #${state.locoAddress} to block ${destinationBlockId}: WebSocket send failed.`
        );

        return;
      }

      wsApi.getBlocks();
    }

    log(
      "match",
      movementOwned
        ? `Tracked loco #${state.locoAddress} into ${state.currentBlockName} via sensor #${sensor}; active Movement owns block assignment.`
        : `Tracked loco #${state.locoAddress} into ${state.currentBlockName} via sensor #${sensor}.`
    );
  } else {
    log(
      "match",
      `Tracked loco #${state.locoAddress} at sensor #${sensor} on route ${candidate.route.fromBlockName ?? candidate.route.fromBlockId} -> ${candidate.route.toBlockName ?? candidate.route.toBlockId}.`
    );
  }

  emit();
}

function handleSensorOff(
  sensor: number
): void {
  let changed =
    false;

  for (
    const state of
    locoTracking.values()
  ) {
    if (
      !state.currentSensors.includes(
        sensor
      )
    ) {
      continue;
    }

    state.currentSensors =
      state.currentSensors.filter(
        value =>
          value !==
            sensor
      );

    const committed =
      committedRoutes.get(
        state.locoAddress
      );

    state.currentSectionParts =
      committed
        ? sectionPartsForSensors(
            committed,
            state.currentSensors
          )
        : [];

    state.updatedAt =
      Date.now();

    log(
      "info",
      `Loco #${state.locoAddress} left sensor #${sensor}.`
    );

    changed =
      true;
  }

  if (changed) {
    emit();
  }
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
        controlActive
      ) {
        void refreshTopology();

        requestRuntimeState();

        if (enabled) {
          log(
            "info",
            "Tracking active on this Control Station."
          );
        }
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
        isControlStationRuntimeActive()
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

      seedTrackingFromBlocks(
        data
      );

      emit();
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
        !active()
      ) {
        return;
      }

      if (data.on) {
        handleSensorOn(
          data.address
        );
      } else {
        handleSensorOff(
          data.address
        );
      }
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

        if (
          active()
        ) {
          emit();
        }

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

      if (
        active()
      ) {
        emit();
      }
    }
  );

  wsClient.on(
    "accessoryChanged",
    data => {
      updateTurnoutFromPhysical(
        data.address,
        data.active
      );

      if (
        active()
      ) {
        emit();
      }
    }
  );

  wsClient.on(
    "signalAspectChanged",
    data => {
      updateTurnoutFromPhysical(
        data.address,
        data.aspect
      );

      if (
        active()
      ) {
        emit();
      }
    }
  );

  wsClient.on(
    "vpinChanged",
    data => {
      updateTurnoutFromPhysical(
        data.vpin,
        data.active
      );

      if (
        active()
      ) {
        emit();
      }
    }
  );

  wsClient.on(
    "locoState",
    () => {
      if (
        active()
      ) {
        emit();
      }
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

      const snapshotValue =
        objectValue(
          raw.data
        );

      const basic =
        Array.isArray(
          snapshotValue?.basicAccessories
        )
          ? snapshotValue.basicAccessories
          : [];

      for (
        const rawItem of
        basic
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

      const extended =
        Array.isArray(
          snapshotValue?.extendedAccessories
        )
          ? snapshotValue.extendedAccessories
          : [];

      for (
        const rawItem of
        extended
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

      if (
        active()
      ) {
        emit();
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
    next &&
    !ready
  ) {
    log(
      "warn",
      readinessIssues.length >
        0
        ? `Tracking cannot be enabled: ${readinessIssues.join(" ")}`
        : "Tracking cannot be enabled until the graph has been validated."
    );

    emit();

    return;
  }

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

export function resetTrainTrackingState(): void {
  locoTracking.clear();
  committedRoutes.clear();
  clearTrainTrackingPredictions();

  seedTrackingFromBlocks(
    blockStates
  );

  log(
    "info",
    "Tracking locomotive state reset from current block assignments."
  );

  emit();
}

export function getLocoTrackingState(
  locoAddress: number
): LocoTrackingState | null {
  const state =
    locoTracking.get(
      locoAddress
    );

  return state
    ? copyTracking(
        state
      )
    : null;
}

export function getLocoAtSensor(
  sensorAddress: number
): LocoTrackingState | null {
  const matches =
    [...locoTracking.values()]
      .filter(
        state =>
          state.currentSensors.includes(
            sensorAddress
          )
      );

  return matches.length ===
      1
    ? copyTracking(
        matches[0]!
      )
    : null;
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
  if (
    !isControlStationRuntimeActive()
  ) {
    return;
  }

  void refreshTopology();
  requestRuntimeState();
}
