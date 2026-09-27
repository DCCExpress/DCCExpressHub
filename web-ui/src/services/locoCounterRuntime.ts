import type {
  Loco,
  LocoState,
} from "@domain/types";

import {
  resolveLocoCounterSettings,
} from "@domain/locoCounterSettings";

import {
  getLocos,
  saveLocos,
} from "../api/domainApi";

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
  saving: boolean;
};

type RuntimeState = {
  address: number;
  baseTotalKm: number;
  baseTotalHours: number;
  pendingKm: number;
  pendingHours: number;
  dailyKm: number;
  dailyHours: number;
  speed: number;
  maxSpeedStep: number;
  maxScaleSpeedKmh: number;
  lastUpdateAt: number;
  saving: boolean;
};

type Listener =
  () => void;

const states =
  new Map<
    number,
    RuntimeState
  >();

const configuredLocos =
  new Map<
    number,
    Loco
  >();

const listeners =
  new Set<
    Listener
  >();

const queuedPersistAddresses =
  new Set<
    number
  >();

let installed =
  false;

let tickTimer:
  number | null =
  null;

let persistQueue:
  Promise<void> =
  Promise.resolve();

let unsubscribeLocoState:
  (() => void) |
  null =
    null;

let unsubscribeStatus:
  (() => void) |
  null =
    null;

function safeNonNegative(
  value:
    unknown
): number {
  const numeric =
    Number(
      value
    );

  return (
    Number.isFinite(
      numeric
    ) &&
    numeric >
      0
  )
    ? numeric
    : 0;
}

function emit(): void {
  for (
    const listener of
    listeners
  ) {
    listener();
  }
}

function hasMovingLoco(): boolean {
  for (
    const state of
    states.values()
  ) {
    if (
      state.speed >
        0
    ) {
      return true;
    }
  }

  return false;
}

function stopTickTimer(): void {
  if (
    tickTimer ===
      null
  ) {
    return;
  }

  window.clearInterval(
    tickTimer
  );

  tickTimer =
    null;
}

function ensureTickTimer(): void {
  if (
    tickTimer !==
      null ||
    !hasMovingLoco()
  ) {
    return;
  }

  tickTimer =
    window.setInterval(
      () => {
        const now =
          Date.now();

        let changed =
          false;

        for (
          const state of
          states.values()
        ) {
          if (
            state.speed <=
              0
          ) {
            continue;
          }

          integrateState(
            state,
            now
          );

          changed =
            true;
        }

        if (
          changed
        ) {
          emit();
        }

        if (
          !hasMovingLoco()
        ) {
          stopTickTimer();
        }
      },
      500
    );
}

function integrateState(
  state:
    RuntimeState,
  now: number
): void {
  if (
    state.speed <=
      0
  ) {
    state.lastUpdateAt =
      now;

    return;
  }

  const elapsedMs =
    Math.max(
      0,
      now -
        state.lastUpdateAt
    );

  state.lastUpdateAt =
    now;

  if (
    elapsedMs <=
      0
  ) {
    return;
  }

  const elapsedHours =
    elapsedMs /
    3_600_000;

  const speedRatio =
    Math.max(
      0,
      Math.min(
        1,
        state.speed /
          Math.max(
            1,
            state.maxSpeedStep
          )
      )
    );

  const speedKmh =
    state.maxScaleSpeedKmh *
    speedRatio;

  const distanceKm =
    speedKmh *
    elapsedHours;

  state.pendingHours +=
    elapsedHours;

  state.dailyHours +=
    elapsedHours;

  state.pendingKm +=
    distanceKm;

  state.dailyKm +=
    distanceKm;
}

function createState(
  loco: Loco
): RuntimeState {
  const settings =
    resolveLocoCounterSettings(
      loco.counterSettings
    );

  return {
    address:
      loco.address,
    baseTotalKm:
      safeNonNegative(
        loco.odometerKm
      ),
    baseTotalHours:
      safeNonNegative(
        loco.operatingHours
      ),
    pendingKm: 0,
    pendingHours: 0,
    dailyKm: 0,
    dailyHours: 0,
    speed: 0,
    maxSpeedStep:
      Math.max(
        1,
        Number(
          loco.maxSpeed
        ) ||
          100
      ),
    maxScaleSpeedKmh:
      settings.maxScaleSpeedKmh,
    lastUpdateAt:
      Date.now(),
    saving: false,
  };
}

function configureState(
  state:
    RuntimeState,
  loco: Loco
): void {
  const settings =
    resolveLocoCounterSettings(
      loco.counterSettings
    );

  state.maxSpeedStep =
    Math.max(
      1,
      Number(
        loco.maxSpeed
      ) ||
        100
    );

  state.maxScaleSpeedKmh =
    settings.maxScaleSpeedKmh;

  if (
    state.pendingKm <=
      0 &&
    state.pendingHours <=
      0 &&
    !state.saving
  ) {
    state.baseTotalKm =
      safeNonNegative(
        loco.odometerKm
      );

    state.baseTotalHours =
      safeNonNegative(
        loco.operatingHours
      );
  }
}

async function persistStoppedLoco(
  address: number
): Promise<void> {
  const state =
    states.get(
      address
    );

  if (
    !state ||
    state.speed >
      0
  ) {
    return;
  }

  const capturedKm =
    state.pendingKm;

  const capturedHours =
    state.pendingHours;

  if (
    capturedKm <=
      0 &&
    capturedHours <=
      0
  ) {
    return;
  }

  state.saving =
    true;

  emit();

  try {
    const locos =
      await getLocos();

    const targetIndex =
      locos.findIndex(
        loco =>
          loco.address ===
          address
      );

    if (
      targetIndex <
        0
    ) {
      return;
    }

    const target =
      locos[
        targetIndex
      ]!;

    const persistedKm =
      safeNonNegative(
        target.odometerKm
      );

    const persistedHours =
      safeNonNegative(
        target.operatingHours
      );

    const calculatedTotalKm =
      state.baseTotalKm +
      capturedKm;

    const calculatedTotalHours =
      state.baseTotalHours +
      capturedHours;

    /*
     * Persist absolute monotonic totals instead of blindly adding a delta to
     * the file value. Multiple connected browsers observe the same locoState
     * stream; using max() makes duplicate stop saves effectively idempotent.
     */
    const nextTotalKm =
      Math.max(
        persistedKm,
        calculatedTotalKm
      );

    const nextTotalHours =
      Math.max(
        persistedHours,
        calculatedTotalHours
      );

    locos[
      targetIndex
    ] = {
      ...target,
      odometerKm:
        nextTotalKm,
      operatingHours:
        nextTotalHours,
      lastRunAt:
        new Date()
          .toISOString(),
    };

    await saveLocos(
      locos
    );

    state.baseTotalKm =
      nextTotalKm;

    state.baseTotalHours =
      nextTotalHours;

    state.pendingKm =
      Math.max(
        0,
        state.pendingKm -
          capturedKm
      );

    state.pendingHours =
      Math.max(
        0,
        state.pendingHours -
          capturedHours
      );

    const configured =
      configuredLocos.get(
        address
      );

    if (
      configured
    ) {
      configuredLocos.set(
        address,
        {
          ...configured,
          odometerKm:
            nextTotalKm,
          operatingHours:
            nextTotalHours,
          lastRunAt:
            locos[
              targetIndex
            ]?.lastRunAt,
        }
      );
    }
  } catch (
    error
  ) {
    console.error(
      `Could not persist locomotive counters for address ${address}.`,
      error
    );
  } finally {
    state.saving =
      false;

    emit();
  }
}

function queuePersist(
  address: number
): void {
  if (
    queuedPersistAddresses.has(
      address
    )
  ) {
    return;
  }

  queuedPersistAddresses.add(
    address
  );

  persistQueue =
    persistQueue
      .catch(
        () => {
          // Keep the persistence queue alive after an earlier failure.
        }
      )
      .then(
        async () => {
          try {
            await persistStoppedLoco(
              address
            );
          } finally {
            queuedPersistAddresses.delete(
              address
            );
          }
        }
      );
}

function handleLocoState(
  locoState:
    LocoState
): void {
  const configured =
    configuredLocos.get(
      locoState.address
    );

  if (
    !configured
  ) {
    return;
  }

  let state =
    states.get(
      locoState.address
    );

  if (
    !state
  ) {
    state =
      createState(
        configured
      );

    states.set(
      locoState.address,
      state
    );
  }

  const now =
    Date.now();

  const wasMoving =
    state.speed >
      0;

  integrateState(
    state,
    now
  );

  state.speed =
    Math.max(
      0,
      Number(
        locoState.speed
      ) ||
        0
    );

  state.lastUpdateAt =
    now;

  const isMoving =
    state.speed >
      0;

  if (
    isMoving
  ) {
    ensureTickTimer();
  }

  emit();

  if (
    wasMoving &&
    !isMoving
  ) {
    queuePersist(
      state.address
    );
  }
}

function stopUnknownMotionOnDisconnect(): void {
  const now =
    Date.now();

  let changed =
    false;

  for (
    const state of
    states.values()
  ) {
    if (
      state.speed <=
        0
    ) {
      continue;
    }

    integrateState(
      state,
      now
    );

    state.speed =
      0;

    changed =
      true;

    queuePersist(
      state.address
    );
  }

  stopTickTimer();

  if (
    changed
  ) {
    emit();
  }
}

export function configureLocoCounterRuntime(
  locos:
    readonly Loco[]
): void {
  const activeAddresses =
    new Set<number>();

  for (
    const loco of
    locos
  ) {
    if (
      !Number.isFinite(
        loco.address
      ) ||
      loco.address <=
        0
    ) {
      continue;
    }

    activeAddresses.add(
      loco.address
    );

    configuredLocos.set(
      loco.address,
      {
        ...loco,
      }
    );

    const existing =
      states.get(
        loco.address
      );

    if (
      existing
    ) {
      configureState(
        existing,
        loco
      );
    } else {
      states.set(
        loco.address,
        createState(
          loco
        )
      );
    }
  }

  for (
    const address of
    configuredLocos.keys()
  ) {
    if (
      !activeAddresses.has(
        address
      )
    ) {
      configuredLocos.delete(
        address
      );

      const state =
        states.get(
          address
        );

      if (
        !state ||
        state.speed <=
          0
      ) {
        states.delete(
          address
        );
      }
    }
  }

  emit();
}

export function getLocoCounterSnapshot(
  address: number
): LocoCounterSnapshot | null {
  const state =
    states.get(
      address
    );

  if (
    !state
  ) {
    return null;
  }

  return {
    address:
      state.address,
    totalKm:
      state.baseTotalKm +
      state.pendingKm,
    dailyKm:
      state.dailyKm,
    totalHours:
      state.baseTotalHours +
      state.pendingHours,
    dailyHours:
      state.dailyHours,
    speed:
      state.speed,
    moving:
      state.speed >
        0,
    saving:
      state.saving,
  };
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

  unsubscribeLocoState =
    wsClient.on(
      "locoState",
      data => {
        if (
          data.loco
        ) {
          handleLocoState(
            data.loco
          );
        }
      }
    );

  unsubscribeStatus =
    wsClient.subscribeStatus(
      status => {
        if (
          status ===
            "disconnected" ||
          status ===
            "reconnecting" ||
          status ===
            "error"
        ) {
          stopUnknownMotionOnDisconnect();
        }
      }
    );

  return () => {
    stopTickTimer();

    unsubscribeLocoState?.();
    unsubscribeStatus?.();

    unsubscribeLocoState =
      null;

    unsubscribeStatus =
      null;

    installed =
      false;
  };
}
