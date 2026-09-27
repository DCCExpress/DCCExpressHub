import {
  wsClient,
} from "./wsClient";

export type LocoCounterSnapshot = {
  address: number;
  totalKm: number;
  dailyKm: number;
  totalHours: number;
  dailyHours: number;
  speed: number;
  moving: boolean;
};

type Listener =
  () => void;

const snapshots =
  new Map<
    number,
    LocoCounterSnapshot
  >();

const listeners =
  new Set<
    Listener
  >();

let installed =
  false;

let unsubscribeSnapshot:
  (() => void) |
  null =
    null;

function emit(): void {
  for (
    const listener of
    listeners
  ) {
    listener();
  }
}

export function getLocoCounterSnapshot(
  address: number
): LocoCounterSnapshot | null {
  return (
    snapshots.get(
      address
    ) ??
    null
  );
}

export function subscribeLocoCounterRuntime(
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

export function installLocoCounterRuntime():
  () => void {
  if (
    installed
  ) {
    return () => {};
  }

  installed =
    true;

  unsubscribeSnapshot =
    wsClient.on(
      "locoCounterSnapshot",
      data => {
        const next =
          new Map<
            number,
            LocoCounterSnapshot
          >();

        for (
          const item of
          data.items ??
          []
        ) {
          if (
            !Number.isFinite(
              item.address
            ) ||
            item.address <=
              0
          ) {
            continue;
          }

          next.set(
            item.address,
            {
              address:
                item.address,
              totalKm:
                Number(
                  item.totalKm
                ) ||
                0,
              dailyKm:
                Number(
                  item.dailyKm
                ) ||
                0,
              totalHours:
                Number(
                  item.totalHours
                ) ||
                0,
              dailyHours:
                Number(
                  item.dailyHours
                ) ||
                0,
              speed:
                Number(
                  item.speed
                ) ||
                0,
              moving:
                item.moving ===
                true,
            }
          );
        }

        snapshots.clear();

        for (
          const [
            address,
            snapshot,
          ] of next
        ) {
          snapshots.set(
            address,
            snapshot
          );
        }

        emit();
      }
    );

  return () => {
    unsubscribeSnapshot?.();
    unsubscribeSnapshot =
      null;

    installed =
      false;
  };
}
