import {
  wsClient,
} from "./wsClient";

export type MovementBlockWaitingReason =
  | "departureCondition"
  | "targetBlock"
  | "segment"
  | "resourceLock"
  | "turnoutLock";

export type MovementBlockRuntimePhase =
  | "moving"
  | "executing"
  | "waiting"
  | "error";

export type MovementBlockRuntimeState = {
  ownerId: string;
  movementName: string;
  locoAddress: number;
  direction:
    | "forward"
    | "reverse";
  phase:
    MovementBlockRuntimePhase;
  waitingReason:
    MovementBlockWaitingReason |
    null;
  info: string;
};

type Listener =
  () => void;

const states =
  new Map<
    number,
    MovementBlockRuntimeState
  >();

const listeners =
  new Set<
    Listener
  >();

let installed =
  false;

function emit(): void {
  for (
    const listener of
    listeners
  ) {
    listener();
  }
}

function waitingReasonFor(
  info: string
): MovementBlockWaitingReason |
  null {
  const text =
    info.toLowerCase();

  if (
    text.includes(
      "departure condition"
    )
  ) {
    return "departureCondition";
  }

  if (
    text.includes(
      "turnout lock"
    )
  ) {
    return "turnoutLock";
  }

  if (
    text.includes(
      "safety sensor"
    )
  ) {
    return "segment";
  }

  if (
    text.includes(
      "waiting for block"
    )
  ) {
    return "targetBlock";
  }

  if (
    text.includes(
      "route authority"
    )
  ) {
    return "resourceLock";
  }

  return null;
}

function clearOwner(
  ownerId: string
): boolean {
  let changed =
    false;

  for (
    const [
      blockId,
      state,
    ] of states
  ) {
    if (
      state.ownerId !==
        ownerId
    ) {
      continue;
    }

    states.delete(
      blockId
    );

    changed =
      true;
  }

  return changed;
}

function install():
  void {
  if (installed) {
    return;
  }

  installed =
    true;

  wsClient.on(
    "movementStateChanged",
    state => {
      let changed =
        clearOwner(
          state.pageId
        );

      if (
        (
          state.status ===
            "running" ||
          state.status ===
            "stopping" ||
          state.status ===
            "error"
        ) &&
        state.locoAddress !==
          null &&
        state.direction !==
          null
      ) {
        const phase:
          MovementBlockRuntimePhase =
          state.status ===
            "error"
            ? "error"
            : state.moving &&
              state.desiredSpeed >
                0
              ? "moving"
              : "waiting";

        const info =
          state.info ??
          "";

        const value:
          MovementBlockRuntimeState = {
          ownerId:
            state.pageId,
          movementName:
            state.movementName,
          locoAddress:
            state.locoAddress,
          direction:
            state.direction,
          phase,
          waitingReason:
            phase ===
              "waiting"
              ? waitingReasonFor(
                  info
                )
              : null,
          info,
        };

        if (
          state.currentBlockId !==
            null
        ) {
          states.set(
            state.currentBlockId,
            value
          );

          changed =
            true;
        }

        if (
          state.targetBlockId !==
            null &&
          state.targetBlockId !==
            state.currentBlockId
        ) {
          states.set(
            state.targetBlockId,
            value
          );

          changed =
            true;
        }
      }

      if (changed) {
        emit();
      }
    }
  );

  wsClient.on(
    "movementSnapshot",
    data => {
      let changed =
        false;

      for (
        const state of
        data.states
      ) {
        changed =
          clearOwner(
            state.pageId
          ) ||
          changed;

        if (
          state.status !==
            "running" &&
          state.status !==
            "stopping" &&
          state.status !==
            "error"
        ) {
          continue;
        }

        if (
          state.locoAddress ===
            null ||
          state.direction ===
            null
        ) {
          continue;
        }

        const phase:
          MovementBlockRuntimePhase =
          state.status ===
            "error"
            ? "error"
            : state.moving &&
              state.desiredSpeed >
                0
              ? "moving"
              : "waiting";

        const value:
          MovementBlockRuntimeState = {
          ownerId:
            state.pageId,
          movementName:
            state.movementName,
          locoAddress:
            state.locoAddress,
          direction:
            state.direction,
          phase,
          waitingReason:
            phase ===
              "waiting"
              ? waitingReasonFor(
                  state.info ??
                    ""
                )
              : null,
          info:
            state.info ??
            "",
        };

        if (
          state.currentBlockId !==
            null
        ) {
          states.set(
            state.currentBlockId,
            value
          );

          changed =
            true;
        }

        if (
          state.targetBlockId !==
            null &&
          state.targetBlockId !==
            state.currentBlockId
        ) {
          states.set(
            state.targetBlockId,
            value
          );

          changed =
            true;
        }
      }

      if (changed) {
        emit();
      }
    }
  );
}

export function getMovementBlockRuntime(
  blockId: number
): MovementBlockRuntimeState | null {
  install();

  const state =
    states.get(
      blockId
    );

  return state
    ? {
        ...state,
      }
    : null;
}

export function hasMovingMovementBlockRuntime(): boolean {
  install();

  for (
    const state of
    states.values()
  ) {
    if (
      state.phase ===
        "moving"
    ) {
      return true;
    }
  }

  return false;
}

export function subscribeMovementBlockRuntime(
  listener:
    Listener
): () => void {
  install();

  listeners.add(
    listener
  );

  return () => {
    listeners.delete(
      listener
    );
  };
}

install();
