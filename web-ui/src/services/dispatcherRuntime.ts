import type {
  MovementPage,
} from "../domain/movement";

import {
  abortMovement,
  getMovementEngineState,
  startMovement,
  stopMovement,
  subscribeMovementEngineState,
  type MovementEngineState,
} from "./movementEngine";

import {
  getTrainTrackingState,
  subscribeTrainTrackingState,
} from "./trainTrackingRuntime";

export type DispatcherState =
  MovementEngineState;

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
    getMovementEngineState(
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
    subscribeMovementEngineState(
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

  const sourceLocos =
    tracking.locos.filter(
      loco =>
        loco.currentBlockId ===
          page.fromBlockId
    );

  if (
    sourceLocos.length ===
      0
  ) {
    log(
      "warn",
      `${page.name}: no tracked locomotive is assigned to the start block.`
    );

    throw new Error(
      "Dispatcher cannot start: no tracked locomotive is assigned to the start block."
    );
  }

  if (
    sourceLocos.length >
      1
  ) {
    log(
      "warn",
      `${page.name}: more than one tracked locomotive matches the start block.`
    );

    throw new Error(
      "Dispatcher cannot start: more than one tracked locomotive matches the start block."
    );
  }

  const loco =
    sourceLocos[0]!;

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

  log(
    "info",
    `Starting "${page.name}" for loco #${loco.locoAddress}: ${routeBlocks(page).join(" -> ")}.`
  );

  /*
   * Compatibility executor.
   *
   * The next Dispatcher phase will consume TrainTracking state directly for
   * progress/arrival and will keep only safety, route authority, turnout and
   * locomotive command responsibilities from the legacy Movement engine.
   */
  try {
    await startMovement(
      page
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
    stopMovement(
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
    abortMovement(
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

export function getDispatcherState(
  pageId:
    string
): DispatcherState {
  return getMovementEngineState(
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
  return subscribeMovementEngineState(
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
