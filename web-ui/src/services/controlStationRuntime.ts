type ControlStationRuntimeListener =
  (active: boolean) => void;

let active =
  false;

const listeners =
  new Set<
    ControlStationRuntimeListener
  >();

export function isControlStationRuntimeActive(): boolean {
  return active;
}

export function setControlStationRuntimeActive(
  value: boolean
): void {
  const next =
    Boolean(
      value
    );

  if (
    active ===
    next
  ) {
    return;
  }

  active =
    next;

  for (
    const listener of
    listeners
  ) {
    listener(
      active
    );
  }
}

export function subscribeControlStationRuntime(
  listener:
    ControlStationRuntimeListener
): () => void {
  listeners.add(
    listener
  );

  listener(
    active
  );

  return () => {
    listeners.delete(
      listener
    );
  };
}
