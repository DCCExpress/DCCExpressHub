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

function emit(): void {
  for (
    const listener of
    listeners
  ) {
    listener();
  }
}

export function getMovementBlockRuntime(
  blockId: number
): MovementBlockRuntimeState | null {
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

export function setMovementBlockRuntime(
  blockId: number,
  state:
    MovementBlockRuntimeState
): void {
  if (
    !Number.isInteger(
      blockId
    ) ||
    blockId <= 0
  ) {
    return;
  }

  states.set(
    blockId,
    {
      ...state,
    }
  );

  emit();
}

export function clearMovementBlockRuntime(
  blockId: number,
  ownerId: string,
  phase:
    MovementBlockRuntimePhase |
    null =
      null
): void {
  const current =
    states.get(
      blockId
    );

  if (
    !current ||
    current.ownerId !==
      ownerId ||
    (
      phase !==
        null &&
      current.phase !==
        phase
    )
  ) {
    return;
  }

  states.delete(
    blockId
  );

  emit();
}

export function clearMovementBlockRuntimeByOwner(
  ownerId: string
): void {
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

  if (
    changed
  ) {
    emit();
  }
}

export function hasBlinkingMovementBlockRuntime(): boolean {
  for (
    const state of
    states.values()
  ) {
    if (
      state.phase ===
        "executing" ||
      state.phase ===
        "waiting" ||
      state.phase ===
        "error"
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
  listeners.add(
    listener
  );

  return () => {
    listeners.delete(
      listener
    );
  };
}
