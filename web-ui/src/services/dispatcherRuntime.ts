import type {
  MovementPage,
} from "../domain/movement";

import {
  abortDispatcherExecution,
  getDispatcherExecutionState,
  startDispatcherExecution,
  stopDispatcherExecution,
  subscribeDispatcherExecutionState,
  type DispatcherExecutionState,
} from "./dispatcherExecutionRuntime";

import {
  getTrainTrackingState,
  installTrainTrackingRuntime,
  subscribeTrainTrackingState,
} from "./trainTrackingRuntime";

export type DispatcherState =
  DispatcherExecutionState;

export type DispatcherLogLevel =
  | "info"
  | "match"
  | "warn"
  | "error";

export type DispatcherLogEntry = {
  id: string;
  timestamp: number;
  level: DispatcherLogLevel;
  message: string;
};

export type DispatcherTaskState = {
  movementId: string;
  movementName: string;
  locoAddress: number;
  requestedBlocks: number[];
  currentBlockId: number | null;
  nextBlockId: number | null;
  status: DispatcherState["status"];
  info: string | null;
  error: string | null;
  startedAt: number | null;
};

export type DispatcherRuntimeSnapshot = {
  enabled: boolean;
  tasks: DispatcherTaskState[];
  logs: DispatcherLogEntry[];
};

type DispatcherRuntimeListener =
  (
    state:
      DispatcherRuntimeSnapshot
  ) => void;

const taskPages =
  new Map<
    string,
    MovementPage
  >();

const taskLocoAddresses =
  new Map<
    string,
    number
  >();

/*
 * Dispatcher owns locomotives exclusively while a task is active.
 *
 * Route/block overlap is not enough to prevent two opposite Movements from
 * selecting the same tracked locomotive at an intermediate block. Without
 * this ownership map a timetable could start A3 -> B2 -> C4 while
 * C4 -> B2 -> A3 was still running, producing contradictory targetLoco and
 * turnout locks for the same decoder.
 */
const activeLocoOwners =
  new Map<
    number,
    string
  >();

const engineUnsubscribes =
  new Map<
    string,
    () => void
  >();

const logs:
  DispatcherLogEntry[] =
  [];

const listeners =
  new Set<
    DispatcherRuntimeListener
  >();

const MAX_LOGS =
  300;

const STORAGE_KEY =
  "dcc-express-hub.dispatcher.enabled";

let enabled =
  typeof window === "undefined"
    ? true
    : window.localStorage.getItem(
        STORAGE_KEY
      ) !== "false";

let trackingSubscriptionInstalled =
  false;

function id(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return (
    "dispatcher-" +
    Date.now().toString(36) +
    "-" +
    Math.random()
      .toString(36)
      .slice(2)
  );
}

function routeBlocks(
  page:
    MovementPage
): number[] {
  return [
    page.fromBlockId,
    ...page.viaBlockIds,
    page.toBlockId,
  ].filter(
    (
      value
    ): value is number =>
      value !==
        null
  );
}

function remainingMovementPage(
  page:
    MovementPage,
  currentBlockId:
    number
): MovementPage | null {
  const requested =
    routeBlocks(
      page
    );

  const currentIndex =
    requested.indexOf(
      currentBlockId
    );

  if (
    currentIndex <
      0
  ) {
    return null;
  }

  const destination =
    requested[
      requested.length -
        1
    ];

  if (
    destination ===
      undefined ||
    currentBlockId ===
      destination
  ) {
    return null;
  }

  const remaining =
    requested.slice(
      currentIndex
    );

  return {
    ...page,
    /*
     * The persisted routeKey identifies the original full route. Once a
     * Dispatcher resumes from an intermediate block, route selection must be
     * regenerated from the remaining checkpoint sequence.
     */
    routeKey:
      "",
    fromBlockId:
      remaining[0] ??
      null,
    viaBlockIds:
      remaining.slice(
        1,
        -1
      ),
    toBlockId:
      remaining[
        remaining.length -
          1
      ] ??
      null,
  };
}

function currentTrackingBlock(
  locoAddress:
    number
): number | null {
  return (
    getTrainTrackingState()
      .locos.find(
        loco =>
          loco.locoAddress ===
            locoAddress
      )
      ?.currentBlockId ??
    null
  );
}

function nextRequestedBlock(
  requested:
    number[],
  currentBlockId:
    number | null
): number | null {
  if (
    requested.length ===
      0
  ) {
    return null;
  }

  if (
    currentBlockId ===
      null
  ) {
    return requested[0] ??
      null;
  }

  const index =
    requested.indexOf(
      currentBlockId
    );

  if (
    index <
      0
  ) {
    return requested[0] ??
      null;
  }

  return requested[
    index +
      1
  ] ??
    null;
}

function taskSnapshot(
  page:
    MovementPage,
  locoAddress:
    number
): DispatcherTaskState {
  const engine =
    getDispatcherExecutionState(
      page.id
    );

  const requested =
    routeBlocks(
      page
    );

  const currentBlockId =
    currentTrackingBlock(
      locoAddress
    );

  return {
    movementId:
      page.id,
    movementName:
      page.name,
    locoAddress,
    requestedBlocks:
      requested,
    currentBlockId,
    nextBlockId:
      nextRequestedBlock(
        requested,
        currentBlockId
      ),
    status:
      engine.status,
    info:
      engine.info,
    error:
      engine.error,
    startedAt:
      engine.startedAt,
  };
}

function snapshot(): DispatcherRuntimeSnapshot {
  return {
    enabled,
    tasks:
      [
        ...taskPages.values(),
      ]
        .map(
          page => {
            const locoAddress =
              taskLocoAddresses.get(
                page.id
              );

            return locoAddress ===
                undefined
              ? null
              : taskSnapshot(
                  page,
                  locoAddress
                );
          }
        )
        .filter(
          (
            task
          ): task is DispatcherTaskState =>
            task !==
              null
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
    DispatcherLogLevel,
  message:
    string
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

function ensureTrackingSubscription():
  void {
  installTrainTrackingRuntime();

  if (
    trackingSubscriptionInstalled
  ) {
    return;
  }

  trackingSubscriptionInstalled =
    true;

  subscribeTrainTrackingState(
    () => {
      emit();
    }
  );
}

function ensureEngineSubscription(
  page:
    MovementPage
): void {
  if (
    engineUnsubscribes.has(
      page.id
    )
  ) {
    return;
  }

  const unsubscribe =
    subscribeDispatcherExecutionState(
      page.id,
      state => {
        if (
          state.status ===
            "error" &&
          state.error
        ) {
          log(
            "error",
            `${page.name}: ${state.error}`
          );
        }

        emit();
      }
    );

  engineUnsubscribes.set(
    page.id,
    unsubscribe
  );
}

/**
 * Dispatcher is the public execution boundary for saved movements.
 *
 * MovementPage is intentionally treated as an intent:
 *   block A -> block B -> ... -> block N + cruise speed.
 *
 * TrainTracking is authoritative for locating the locomotive. The existing
 * Movement engine remains the compatibility executor for turnout/resource
 * locking and safety while that logic is migrated behind this Dispatcher.
 * UI and timetable code must call this module rather than movementEngine
 * directly so the executor can be replaced without changing callers.
 */
export async function startDispatcherMovement(
  page:
    MovementPage
): Promise<void> {
  ensureTrackingSubscription();

  if (
    !enabled
  ) {
    throw new Error(
      "Dispatcher is disabled."
    );
  }

  if (
    page.fromBlockId ===
      null ||
    page.toBlockId ===
      null
  ) {
    throw new Error(
      "Dispatcher movement requires a start and destination block."
    );
  }

  const tracking =
    getTrainTrackingState();

  if (
    !tracking.active
  ) {
    throw new Error(
      "Train Tracking must be enabled and active before Dispatcher movement can start."
    );
  }

  const requested =
    routeBlocks(
      page
    );

  const routeLocos =
    tracking.locos.filter(
      loco =>
        loco.currentBlockId !==
          null &&
        requested.includes(
          loco.currentBlockId
        )
    );

  if (
    routeLocos.length ===
      0
  ) {
    log(
      "warn",
      `${page.name}: no tracked locomotive is currently on the requested route.`
    );

    throw new Error(
      "Dispatcher cannot start: no tracked locomotive is currently on the requested route."
    );
  }

  if (
    routeLocos.length >
      1
  ) {
    log(
      "warn",
      `${page.name}: more than one tracked locomotive is currently on the requested route.`
    );

    throw new Error(
      "Dispatcher cannot start: more than one tracked locomotive is currently on the requested route."
    );
  }

  const loco =
    routeLocos[0]!;

  const currentBlockId =
    loco.currentBlockId;

  if (
    currentBlockId ===
      null
  ) {
    throw new Error(
      "Dispatcher cannot start: tracked locomotive has no current block."
    );
  }

  const existingOwner =
    activeLocoOwners.get(
      loco.locoAddress
    );

  if (
    existingOwner !==
      undefined &&
    existingOwner !==
      page.id
  ) {
    const existingPage =
      taskPages.get(
        existingOwner
      );

    const ownerName =
      existingPage?.name ??
      existingOwner;

    log(
      "warn",
      `"${page.name}" rejected for loco #${loco.locoAddress}: already owned by Dispatcher movement "${ownerName}".`
    );

    throw new Error(
      `Dispatcher cannot start: locomotive #${loco.locoAddress} is already controlled by "${ownerName}".`
    );
  }

  const currentIndex =
    requested.indexOf(
      currentBlockId
    );

  const destinationBlockId =
    requested[
      requested.length -
        1
    ] ??
    null;

  const executionPage =
    remainingMovementPage(
      page,
      currentBlockId
    );

  taskPages.set(
    page.id,
    page
  );

  taskLocoAddresses.set(
    page.id,
    loco.locoAddress
  );

  ensureEngineSubscription(
    page
  );

  if (
    destinationBlockId !==
      null &&
    currentBlockId ===
      destinationBlockId
  ) {
    log(
      "match",
      `"${page.name}" already completed for loco #${loco.locoAddress}: locomotive is already in destination block #${destinationBlockId}.`
    );

    emit();

    return;
  }

  if (
    executionPage ===
      null ||
    currentIndex <
      0
  ) {
    throw new Error(
      "Dispatcher cannot resume: tracked locomotive is outside the requested route."
    );
  }

  activeLocoOwners.set(
    loco.locoAddress,
    page.id
  );

  const remaining =
    routeBlocks(
      executionPage
    );

  log(
    "info",
    currentIndex ===
      0
      ? `Starting "${page.name}" for loco #${loco.locoAddress}: ${requested.join(" -> ")}.`
      : `Resuming "${page.name}" for loco #${loco.locoAddress} from block #${currentBlockId}: ${remaining.join(" -> ")}.`
  );

  /*
   * Compatibility executor.
   *
   * The legacy executor receives only the remaining route. Dispatcher keeps
   * the original Movement intent for UI/status purposes, while execution can
   * resume from any tracked checkpoint on A -> B -> C.
   */
  try {
    await startDispatcherExecution(
      executionPage,
      loco.locoAddress
    );

    log(
      "match",
      `Completed "${page.name}" for loco #${loco.locoAddress}.`
    );
  } catch (
    error
  ) {
    log(
      "error",
      `"${page.name}" failed: ${
        error instanceof Error
          ? error.message
          : String(
              error
            )
      }`
    );

    throw error;
  } finally {
    if (
      activeLocoOwners.get(
        loco.locoAddress
      ) ===
        page.id
    ) {
      activeLocoOwners.delete(
        loco.locoAddress
      );
    }

    emit();
  }
}

export function stopDispatcherMovement(
  pageId:
    string
): boolean {
  const page =
    taskPages.get(
      pageId
    );

  const stopped =
    stopDispatcherExecution(
      pageId
    );

  if (
    stopped
  ) {
    log(
      "info",
      page
        ? `Stop requested for "${page.name}".`
        : `Stop requested for movement ${pageId}.`
    );
  }

  return stopped;
}

export function abortDispatcherMovement(
  pageId:
    string,
  emergency = true
): boolean {
  const page =
    taskPages.get(
      pageId
    );

  const aborted =
    abortDispatcherExecution(
      pageId,
      emergency
    );

  if (
    aborted
  ) {
    log(
      "warn",
      page
        ? `Abort requested for "${page.name}".`
        : `Abort requested for movement ${pageId}.`
    );
  }

  return aborted;
}

export function stopAllDispatcherMovements():
  number {
  let stopped =
    0;

  for (
    const pageId of
    taskPages.keys()
  ) {
    if (
      stopDispatcherExecution(
        pageId
      )
    ) {
      stopped +=
        1;
    }
  }

  if (
    stopped >
      0
  ) {
    log(
      "info",
      `Stop All requested for ${stopped} Dispatcher movement(s).`
    );
  }

  return stopped;
}

export function abortAllDispatcherMovements(
  emergency = false
): number {
  let aborted =
    0;

  for (
    const pageId of
    taskPages.keys()
  ) {
    if (
      abortDispatcherExecution(
        pageId,
        emergency
      )
    ) {
      aborted +=
        1;
    }
  }

  if (
    aborted >
      0
  ) {
    log(
      "warn",
      `Abort All requested for ${aborted} Dispatcher movement(s).`
    );
  }

  return aborted;
}

export function setDispatcherEnabled(
  next:
    boolean
): void {
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

  if (
    !enabled
  ) {
    const aborted =
      abortAllDispatcherMovements(
        false
      );

    log(
      "warn",
      aborted >
        0
        ? `Dispatcher disabled; aborted ${aborted} managed movement(s).`
        : "Dispatcher disabled."
    );
  } else {
    log(
      "info",
      "Dispatcher enabled."
    );
  }

  emit();
}

export function getDispatcherEnabled():
  boolean {
  return enabled;
}

export function getDispatcherState(
  pageId:
    string
): DispatcherState {
  return getDispatcherExecutionState(
    pageId
  );
}

export function subscribeDispatcherState(
  pageId:
    string,
  listener:
    (
      state:
        DispatcherState
    ) => void
): () => void {
  return subscribeDispatcherExecutionState(
    pageId,
    listener
  );
}

export function getDispatcherRuntimeSnapshot():
  DispatcherRuntimeSnapshot {
  ensureTrackingSubscription();

  return snapshot();
}

export function subscribeDispatcherRuntime(
  listener:
    DispatcherRuntimeListener
): () => void {
  ensureTrackingSubscription();

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

export function clearDispatcherLog():
  void {
  logs.length =
    0;

  emit();
}
