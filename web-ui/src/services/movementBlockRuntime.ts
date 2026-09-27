export type MovementBlockWaitingReason =
  | "departureCondition"
  | "targetBlock"
  | "segment"
  | "resourceLock"
  | "turnoutLock";

export type MovementBlockRuntimeState = {
  ownerId: string;
  movementName: string;
  locoAddress: number;
  direction:
    | "forward"
    | "reverse";
  waitingReason:
    MovementBlockWaitingReason;
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

export function setMovementBlockWaiting(
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

export function clearMovementBlockWaiting(
  blockId: number,
  ownerId: string
): void {
  const current =
    states.get(
      blockId
    );

  if (
    !current ||
    current.ownerId !==
      ownerId
  ) {
    return;
  }

  states.delete(
    blockId
  );

  emit();
}

export function clearMovementBlockWaitingByOwner(
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

export function hasMovementBlockWaiting(): boolean {
  return states.size >
    0;
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
