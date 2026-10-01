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
} from "./trainTrackingRuntime";

export type DispatcherState =
  MovementEngineState;

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
    throw new Error(
      "Dispatcher cannot start: no tracked locomotive is assigned to the start block."
    );
  }

  if (
    sourceLocos.length >
      1
  ) {
    throw new Error(
      "Dispatcher cannot start: more than one tracked locomotive matches the start block."
    );
  }

  /*
   * Compatibility executor.
   *
   * The next Dispatcher phase will consume TrainTracking state directly for
   * progress/arrival and will keep only safety, route authority, turnout and
   * locomotive command responsibilities from the legacy Movement engine.
   */
  await startMovement(
    page
  );
}

export function stopDispatcherMovement(
  pageId:
    string
): boolean {
  return stopMovement(
    pageId
  );
}

export function abortDispatcherMovement(
  pageId:
    string,
  emergency = true
): boolean {
  return abortMovement(
    pageId,
    emergency
  );
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
