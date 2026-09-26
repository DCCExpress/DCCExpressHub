import type {
  BlockStateChangedPayload,
  SensorChangedPayload,
  SensorSnapshotPayload,
  TurnoutChangedPayload,
} from "../domain/railwayRuntimeEvents";

import type {
  MovementAction,
  MovementPage,
  MovementWhen,
} from "../domain/movement";

import {
  broadcastAudioPlayback,
  broadcastAudioPlaybackNoWait,
} from "./broadcastAudioRuntime";

import {
  isControlStationRuntimeActive,
} from "./controlStationRuntime";

import {
  loadMovementPlan,
  type MovementPlan,
  type MovementPlanLeg,
  type MovementPlanResource,
} from "./movementPlan";

import {
  wsApi,
} from "./wsApi";

import {
  wsClient,
} from "./wsClient";

export type MovementEngineStatus =
  | "idle"
  | "running"
  | "stopping"
  | "error";

export type MovementEngineState = {
  status:
    MovementEngineStatus;
  startedAt:
    number | null;
  locoAddress:
    number | null;
  desiredSpeed: number;
  currentResourceKey:
    string | null;
  info:
    string | null;
  error:
    string | null;
};

type StateListener =
  (
    state:
      MovementEngineState
  ) => void;

type ResourceLease = {
  name: string;
  release:
    () => Promise<void>;
};

type MovementExecution = {
  page:
    MovementPage;
  plan:
    MovementPlan;
  locoAddress: number;
  direction:
    "forward" |
    "reverse";
  desiredSpeed: number;
  physicalSpeed: number;
  moving: boolean;
  cancelled: boolean;
  emergencyAbort: boolean;
  state:
    MovementEngineState;
};

const states =
  new Map<
    string,
    MovementEngineState
  >();

const listeners =
  new Map<
    string,
    Set<StateListener>
  >();

const executions =
  new Map<
    string,
    MovementExecution
  >();

const sensorStates =
  new Map<
    number,
    boolean
  >();

const turnoutStates =
  new Map<
    number,
    boolean
  >();

let blockStates:
  BlockStateChangedPayload =
  {};

let trackingInstalled =
  false;

const idleState =
  (): MovementEngineState => ({
    status:
      "idle",
    startedAt:
      null,
    locoAddress:
      null,
    desiredSpeed:
      0,
    currentResourceKey:
      null,
    info:
      null,
    error:
      null,
  });

function copyState(
  state:
    MovementEngineState
): MovementEngineState {
  return {
    ...state,
  };
}

function emit(
  pageId: string,
  state:
    MovementEngineState
): void {
  states.set(
    pageId,
    copyState(
      state
    )
  );

  for (
    const listener of
    listeners.get(
      pageId
    ) ??
    []
  ) {
    listener(
      copyState(
        state
      )
    );
  }
}

function updateState(
  execution:
    MovementExecution,
  patch:
    Partial<MovementEngineState>
): void {
  execution.state = {
    ...execution.state,
    ...patch,
  };

  emit(
    execution.page.id,
    execution.state
  );
}

function installTracking():
  void {
  if (
    trackingInstalled
  ) {
    return;
  }

  trackingInstalled =
    true;

  wsClient.on(
    "sensorChanged",
    (
      data:
        SensorChangedPayload
    ) => {
      if (
        Number.isInteger(
          data.address
        ) &&
        data.address > 0
      ) {
        sensorStates.set(
          data.address,
          Boolean(
            data.on
          )
        );
      }
    }
  );

  wsClient.on(
    "sensorSnapshot",
    (
      data:
        SensorSnapshotPayload
    ) => {
      for (
        const [
          baseAddress,
          activeBits,
          knownBits,
        ] of data.groups
      ) {
        for (
          let offset = 0;
          offset < 16;
          offset += 1
        ) {
          const bit =
            1 << offset;

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
    "blockStateChanged",
    (
      data:
        BlockStateChangedPayload
    ) => {
      blockStates =
        data;
    }
  );

  wsClient.on(
    "turnoutChanged",
    (
      data:
        TurnoutChangedPayload
    ) => {
      if (
        !Number.isInteger(
          data.address
        ) ||
        data.address <=
        0
      ) {
        return;
      }

      turnoutStates.set(
        data.address,
        data.logicalClosed ??
        data.closed
      );
    }
  );
}

function delay(
  ms: number
): Promise<void> {
  return new Promise(
    resolve =>
      window.setTimeout(
        resolve,
        Math.max(
          0,
          ms
        )
      )
  );
}

async function controlledDelay(
  execution:
    MovementExecution,
  ms: number
): Promise<void> {
  let remaining =
    Math.max(
      0,
      Math.min(
        600000,
        Math.round(
          ms
        )
      )
    );

  while (
    remaining >
      0
  ) {
    if (
      execution.cancelled
    ) {
      throw new Error(
        "Movement cancelled."
      );
    }

    const slice =
      Math.min(
        100,
        remaining
      );

    await delay(
      slice
    );

    remaining -=
      slice;
  }
}

function setInfo(
  execution:
    MovementExecution,
  info: string,
  resourceKey:
    string | null =
      execution.state.currentResourceKey
): void {
  updateState(
    execution,
    {
      info,
      currentResourceKey:
        resourceKey,
    }
  );
}

function setPhysicalSpeed(
  execution:
    MovementExecution,
  speed: number
): void {
  const safeSpeed =
    Math.max(
      0,
      Math.min(
        126,
        Math.round(
          speed
        )
      )
    );

  if (
    execution.physicalSpeed ===
    safeSpeed
  ) {
    return;
  }

  if (
    !wsApi.setLoco(
      execution.locoAddress,
      safeSpeed,
      execution.direction
    )
  ) {
    throw new Error(
      "Movement could not send locomotive speed."
    );
  }

  execution.physicalSpeed =
    safeSpeed;
}

function applyDesiredSpeed(
  execution:
    MovementExecution
): void {
  setPhysicalSpeed(
    execution,
    execution.moving &&
    !execution.cancelled
      ? execution.desiredSpeed
      : 0
  );
}

function audioPath(
  value: string
): string {
  const source =
    value.trim();

  if (!source) {
    return "";
  }

  if (
    source.startsWith(
      "/"
    )
  ) {
    return source;
  }

  if (
    source.includes(
      "."
    )
  ) {
    return `/sd/audio/${source}`;
  }

  return `/sd/audio/${source}.mp3`;
}

async function executeAction(
  execution:
    MovementExecution,
  action:
    MovementAction
): Promise<void> {
  if (
    execution.cancelled
  ) {
    throw new Error(
      "Movement cancelled."
    );
  }

  switch (
    action.kind
  ) {
    case "speed":
      execution.desiredSpeed =
        action.speed;

      updateState(
        execution,
        {
          desiredSpeed:
            execution.desiredSpeed,
        }
      );

      applyDesiredSpeed(
        execution
      );

      return;

    case "function":
      if (
        !wsApi.setLocoFunction(
          execution.locoAddress,
          action.functionNumber,
          action.functionActive
        )
      ) {
        throw new Error(
          "Movement could not send locomotive function."
        );
      }

      return;

    case "horn":
      if (
        !wsApi.setLocoFunction(
          execution.locoAddress,
          action.functionNumber,
          true
        )
      ) {
        throw new Error(
          "Movement could not start horn function."
        );
      }

      try {
        await controlledDelay(
          execution,
          action.pulseMs
        );
      } finally {
        wsApi.setLocoFunction(
          execution.locoAddress,
          action.functionNumber,
          false
        );
      }

      return;

    case "delay":
      await controlledDelay(
        execution,
        action.delayMs
      );

      return;

    case "randomDelay": {
      const min =
        Math.max(
          0,
          Math.min(
            action.minDelayMs,
            action.maxDelayMs
          )
        );

      const max =
        Math.max(
          min,
          action.maxDelayMs
        );

      const duration =
        min +
        Math.floor(
          Math.random() *
          (
            max -
            min +
            1
          )
        );

      await controlledDelay(
        execution,
        duration
      );

      return;
    }

    case "playAudio": {
      const source =
        audioPath(
          action.audioName
        );

      if (!source) {
        return;
      }

      if (
        action.audioWaitForEnd
      ) {
        const ok =
          await broadcastAudioPlayback(
            source
          );

        if (!ok) {
          throw new Error(
            `Movement audio playback failed: ${source}`
          );
        }
      } else if (
        !broadcastAudioPlaybackNoWait(
          source
        )
      ) {
        throw new Error(
          `Movement audio broadcast failed: ${source}`
        );
      }

      return;
    }

    case "log":
      console.info(
        "[Movement]",
        execution.page.name,
        action.message
      );

      return;
  }
}

async function runActions(
  execution:
    MovementExecution,
  resourceKey: string,
  when:
    MovementWhen
): Promise<void> {
  const actions =
    execution.page.actions.filter(
      action =>
        action.resourceKey ===
          resourceKey &&
        action.when ===
          when
    );

  for (const action of actions) {
    setInfo(
      execution,
      `${when.toUpperCase()}: ${action.kind}`,
      resourceKey
    );

    await executeAction(
      execution,
      action
    );
  }
}

function blockStateFor(
  blockId:
    number | null
) {
  if (
    blockId ===
    null
  ) {
    return undefined;
  }

  return blockStates[
    String(
      blockId
    )
  ];
}

function blockIsFree(
  block:
    MovementPlanResource
): boolean {
  const state =
    blockStateFor(
      block.blockId
    );

  if (
    state &&
    (
      (
        state.locoAddress ??
        0
      ) > 0 ||
      state.locoId !==
        null
    )
  ) {
    return false;
  }

  if (
    block.sensorAddress !==
      null &&
    sensorStates.get(
      block.sensorAddress
    ) ===
      true
  ) {
    return false;
  }

  return true;
}

function aheadSegmentsAreFree(
  leg:
    MovementPlanLeg
): boolean {
  const sourceNode =
    leg.from.nodeIndex;

  return leg.resources
    .filter(
      resource =>
        resource.kind ===
          "segment" &&
        resource.nodeIndex !==
          null &&
        resource.nodeIndex !==
          sourceNode
    )
    .every(
      resource =>
        resource.detectors.every(
          address =>
            sensorStates.get(
              address
            ) !==
              true
        )
    );
}

function turnoutRequirementsMatch(
  leg:
    MovementPlanLeg
): {
  ok: boolean;
  mismatch:
    string | null;
} {
  for (
    const requirement of
    leg.turnoutStates
  ) {
    const current =
      turnoutStates.get(
        requirement.address
      );

    /*
     * Movement never changes turnout state. Unknown therefore fails closed:
     * the train stays stopped until authoritative turnout feedback arrives.
     */
    if (
      current ===
      undefined
    ) {
      return {
        ok: false,
        mismatch:
          `Turnout #${requirement.address} state is unknown. Movement will not change it.`,
      };
    }

    if (
      current !==
      requirement.closed
    ) {
      return {
        ok: false,
        mismatch:
          `Turnout #${requirement.address} must be ${requirement.closed ? "CLOSED" : "THROWN"} (Movement never changes it).`,
      };
    }
  }

  return {
    ok: true,
    mismatch:
      null,
  };
}

async function acquireLock(
  name: string
): Promise<ResourceLease | null> {
  const manager =
    navigator.locks;

  if (!manager) {
    return {
      name,
      async release() {},
    };
  }

  let releaseHold:
    () => void =
    () => {};

  const hold =
    new Promise<void>(
      resolve => {
        releaseHold =
          resolve;
      }
    );

  let resolveAcquired:
    (
      value: boolean
    ) => void =
    () => {};

  let rejectAcquired:
    (
      reason: unknown
    ) => void =
    () => {};

  const acquired =
    new Promise<boolean>(
      (
        resolve,
        reject
      ) => {
        resolveAcquired =
          resolve;

        rejectAcquired =
          reject;
      }
    );

  let requestError:
    unknown =
    null;

  const request =
    (async () => {
      try {
        await manager.request(
          name,
          {
            mode:
              "exclusive",
            ifAvailable:
              true,
          },
          async lock => {
            if (!lock) {
              resolveAcquired(
                false
              );

              return;
            }

            resolveAcquired(
              true
            );

            await hold;
          }
        );
      } catch (error) {
        requestError =
          error;

        rejectAcquired(
          error
        );
      }
    })();

  const ok =
    await acquired;

  if (!ok) {
    await request;

    return null;
  }

  let released =
    false;

  return {
    name,
    async release() {
      if (
        released
      ) {
        return;
      }

      released =
        true;

      releaseHold();

      await request;

      if (
        requestError
      ) {
        throw requestError;
      }
    },
  };
}

function lockNamesForLeg(
  leg:
    MovementPlanLeg
): string[] {
  const names =
    new Set<string>();

  if (
    leg.from.blockId !==
    null
  ) {
    names.add(
      `dcc-express-dispatcher-block:${leg.from.blockId}`
    );
  }

  if (
    leg.to.blockId !==
    null
  ) {
    names.add(
      `dcc-express-dispatcher-block:${leg.to.blockId}`
    );
  }

  for (
    const resource of
    leg.resources
  ) {
    if (
      resource.kind ===
      "segment"
    ) {
      names.add(
        `dcc-express-movement-segment:${resource.name}`
      );
    }

    if (
      resource.kind ===
      "turnout"
    ) {
      names.add(
        `dcc-express-movement-turnout:${resource.key}`
      );
    }
  }

  return [
    ...names,
  ].sort();
}

async function tryAcquireLeg(
  leg:
    MovementPlanLeg
): Promise<ResourceLease[] | null> {
  const leases:
    ResourceLease[] = [];

  try {
    for (
      const name of
      lockNamesForLeg(
        leg
      )
    ) {
      const lease =
        await acquireLock(
          name
        );

      if (!lease) {
        for (
          const current of
          leases.reverse()
        ) {
          await current.release();
        }

        return null;
      }

      leases.push(
        lease
      );
    }

    return leases;
  } catch (error) {
    for (
      const lease of
      leases.reverse()
    ) {
      try {
        await lease.release();
      } catch {
        // Preserve the original error.
      }
    }

    throw error;
  }
}

async function releaseLeases(
  leases:
    ResourceLease[]
): Promise<void> {
  for (
    const lease of
    [...leases].reverse()
  ) {
    await lease.release();
  }
}

async function waitForLegClearance(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg
): Promise<ResourceLease[]> {
  let lastInfo =
    "";

  while (
    !execution.cancelled
  ) {
    const turnout =
      turnoutRequirementsMatch(
        leg
      );

    let reason =
      "";

    if (
      !blockIsFree(
        leg.to
      )
    ) {
      reason =
        `Waiting for block ${leg.to.name}`;
    } else if (
      !aheadSegmentsAreFree(
        leg
      )
    ) {
      reason =
        "Waiting for route segment to become free";
    } else if (
      !turnout.ok
    ) {
      reason =
        turnout.mismatch ??
        "Waiting for turnout state";
    }

    if (reason) {
      execution.moving =
        false;

      applyDesiredSpeed(
        execution
      );

      if (
        reason !==
        lastInfo
      ) {
        lastInfo =
          reason;

        setInfo(
          execution,
          reason,
          leg.from.key
        );
      }

      await controlledDelay(
        execution,
        150
      );

      continue;
    }

    const leases =
      await tryAcquireLeg(
        leg
      );

    if (!leases) {
      execution.moving =
        false;

      applyDesiredSpeed(
        execution
      );

      setInfo(
        execution,
        "Waiting for Movement resource lock",
        leg.from.key
      );

      await controlledDelay(
        execution,
        150
      );

      continue;
    }

    const afterLockTurnout =
      turnoutRequirementsMatch(
        leg
      );

    if (
      blockIsFree(
        leg.to
      ) &&
      aheadSegmentsAreFree(
        leg
      ) &&
      afterLockTurnout.ok
    ) {
      return leases;
    }

    await releaseLeases(
      leases
    );
  }

  throw new Error(
    "Movement cancelled."
  );
}

function arrivalSatisfied(
  leg:
    MovementPlanLeg
): boolean {
  return (
    leg.arrivedWhen.length >
      0 &&
    leg.arrivedWhen.every(
      condition =>
        sensorStates.get(
          condition.sensor
        ) ===
          condition.state
    )
  );
}

async function waitForArrival(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg
): Promise<void> {
  if (
    leg.arrivedWhen.length ===
    0
  ) {
    throw new Error(
      `Block "${leg.to.name}" has no arrival condition or occupancy sensor.`
    );
  }

  setInfo(
    execution,
    `Waiting for arrival: ${leg.to.name}`,
    leg.to.key
  );

  while (
    !execution.cancelled
  ) {
    if (
      arrivalSatisfied(
        leg
      )
    ) {
      return;
    }

    await controlledDelay(
      execution,
      100
    );
  }

  throw new Error(
    "Movement cancelled."
  );
}

async function waitForSegmentEntry(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg,
  resource:
    MovementPlanResource
): Promise<void> {
  if (
    resource.detectors.length ===
    0
  ) {
    return;
  }

  setInfo(
    execution,
    `Waiting for segment ${resource.name}`,
    resource.key
  );

  while (
    !execution.cancelled
  ) {
    const turnout =
      turnoutRequirementsMatch(
        leg
      );

    if (
      !turnout.ok
    ) {
      execution.moving =
        false;

      applyDesiredSpeed(
        execution
      );

      setInfo(
        execution,
        turnout.mismatch ??
        "Waiting for turnout state",
        resource.key
      );

      await controlledDelay(
        execution,
        75
      );

      continue;
    }

    if (
      !execution.moving
    ) {
      execution.moving =
        true;

      applyDesiredSpeed(
        execution
      );
    }

    if (
      resource.detectors.some(
        address =>
          sensorStates.get(
            address
          ) ===
            true
      )
    ) {
      return;
    }

    await controlledDelay(
      execution,
      75
    );
  }

  throw new Error(
    "Movement cancelled."
  );
}

async function traverseLeg(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg
): Promise<void> {
  const leases =
    await waitForLegClearance(
      execution,
      leg
    );

  try {
    await runActions(
      execution,
      leg.from.key,
      "depart"
    );

    execution.moving =
      true;

    applyDesiredSpeed(
      execution
    );

    let previousSegment:
      MovementPlanResource |
      null =
      null;

    const pendingTurnouts:
      MovementPlanResource[] =
      [];

    for (
      const resource of
      leg.resources
    ) {
      if (
        execution.cancelled
      ) {
        throw new Error(
          "Movement cancelled."
        );
      }

      if (
        resource.kind ===
        "turnout"
      ) {
        await runActions(
          execution,
          resource.key,
          "approach"
        );

        pendingTurnouts.push(
          resource
        );

        continue;
      }

      if (
        resource.kind !==
        "segment"
      ) {
        continue;
      }

      await waitForSegmentEntry(
        execution,
        leg,
        resource
      );

      for (
        const turnout of
        pendingTurnouts.splice(
          0
        )
      ) {
        await runActions(
          execution,
          turnout.key,
          "leave"
        );
      }

      if (
        previousSegment &&
        previousSegment.key !==
          resource.key
      ) {
        await runActions(
          execution,
          previousSegment.key,
          "leave"
        );
      }

      await runActions(
        execution,
        resource.key,
        "enter"
      );

      previousSegment =
        resource;
    }

    await waitForArrival(
      execution,
      leg
    );

    for (
      const turnout of
      pendingTurnouts.splice(
        0
      )
    ) {
      await runActions(
        execution,
        turnout.key,
        "leave"
      );
    }

    if (
      previousSegment
    ) {
      await runActions(
        execution,
        previousSegment.key,
        "leave"
      );
    }

    if (
      leg.from.blockId !==
        null
    ) {
      wsApi.setBlockRemove(
        String(
          leg.from.blockId
        ),
        null
      );
    }

    if (
      leg.to.blockId !==
        null
    ) {
      wsApi.setBlock(
        String(
          leg.to.blockId
        ),
        null,
        execution.locoAddress
      );
    }

    await runActions(
      execution,
      leg.to.key,
      "arrived"
    );

    setInfo(
      execution,
      `Arrived: ${leg.to.name}`,
      leg.to.key
    );
  } finally {
    await releaseLeases(
      leases
    );
  }
}

async function executeMovement(
  execution:
    MovementExecution
): Promise<void> {
  execution.desiredSpeed =
    execution.page.speed;

  updateState(
    execution,
    {
      desiredSpeed:
        execution.desiredSpeed,
    }
  );

  await runActions(
    execution,
    "movement",
    "start"
  );

  for (
    const leg of
    execution.plan.legs
  ) {
    await traverseLeg(
      execution,
      leg
    );
  }

  execution.desiredSpeed =
    0;

  execution.moving =
    false;

  applyDesiredSpeed(
    execution
  );

  await runActions(
    execution,
    "movement",
    "complete"
  );
}

export function getMovementEngineState(
  pageId: string
): MovementEngineState {
  return copyState(
    states.get(
      pageId
    ) ??
    idleState()
  );
}

export function subscribeMovementEngineState(
  pageId: string,
  listener:
    StateListener
): () => void {
  let set =
    listeners.get(
      pageId
    );

  if (!set) {
    set =
      new Set<
        StateListener
      >();

    listeners.set(
      pageId,
      set
    );
  }

  set.add(
    listener
  );

  listener(
    getMovementEngineState(
      pageId
    )
  );

  return () => {
    const current =
      listeners.get(
        pageId
      );

    current?.delete(
      listener
    );

    if (
      current?.size ===
      0
    ) {
      listeners.delete(
        pageId
      );
    }
  };
}

export async function startMovement(
  page:
    MovementPage
): Promise<void> {
  installTracking();

  if (
    executions.has(
      page.id
    )
  ) {
    throw new Error(
      `Movement "${page.name}" is already running.`
    );
  }

  if (
    !page.enabled
  ) {
    throw new Error(
      `Movement "${page.name}" is disabled.`
    );
  }

  if (
    !isControlStationRuntimeActive()
  ) {
    throw new Error(
      "This browser is not the active Control Station."
    );
  }

  const plan =
    await loadMovementPlan(
      page
    );

  wsApi.getBlocks();
  wsApi.getLayoutRuntimeSnapshot();

  const source =
    plan.blocks[0];

  if (
    !source ||
    source.blockId ===
      null
  ) {
    throw new Error(
      "Movement source block is missing."
    );
  }

  const sourceDeadline =
    Date.now() +
    3000;

  let locoAddress =
    0;

  while (
    Date.now() <
      sourceDeadline
  ) {
    const sourceState =
      blockStateFor(
        source.blockId
      );

    locoAddress =
      sourceState?.locoAddress ??
      0;

    if (
      Number.isInteger(
        locoAddress
      ) &&
      locoAddress >
        0
    ) {
      break;
    }

    await delay(
      50
    );
  }

  if (
    !Number.isInteger(
      locoAddress
    ) ||
    locoAddress <=
      0
  ) {
    throw new Error(
      `Movement source block "${source.name}" has no locomotive address.`
    );
  }

  const direction =
    plan.direction ===
    "reverse"
      ? "reverse"
      : "forward";

  const state:
    MovementEngineState = {
    status:
      "running",
    startedAt:
      Date.now(),
    locoAddress,
    desiredSpeed:
      page.speed,
    currentResourceKey:
      source.key,
    info:
      `Starting from ${source.name}`,
    error:
      null,
  };

  const execution:
    MovementExecution = {
    page: {
      ...page,
      actions:
        page.actions.map(
          action => ({
            ...action,
          })
        ),
    },
    plan,
    locoAddress,
    direction,
    desiredSpeed:
      page.speed,
    physicalSpeed:
      0,
    moving:
      false,
    cancelled:
      false,
    emergencyAbort:
      false,
    state,
  };

  executions.set(
    page.id,
    execution
  );

  emit(
    page.id,
    state
  );

  try {
    await executeMovement(
      execution
    );

    updateState(
      execution,
      {
        status:
          "idle",
        startedAt:
          null,
        desiredSpeed:
          0,
        currentResourceKey:
          null,
        info:
          "Movement completed",
        error:
          null,
      }
    );
  } catch (error) {
    execution.moving =
      false;

    execution.desiredSpeed =
      0;

    try {
      applyDesiredSpeed(
        execution
      );
    } catch {
      // Preserve original movement failure.
    }

    if (
      execution.cancelled
    ) {
      updateState(
        execution,
        {
          status:
            "idle",
          startedAt:
            null,
          desiredSpeed:
            0,
          currentResourceKey:
            null,
          info:
            execution.emergencyAbort
              ? "Movement aborted"
              : "Movement stopped",
          error:
            null,
        }
      );

      return;
    }

    const message =
      error instanceof Error
        ? error.message
        : String(
            error
          );

    updateState(
      execution,
      {
        status:
          "error",
        startedAt:
          null,
        desiredSpeed:
          0,
        info:
          "Movement failed",
        error:
          message,
      }
    );

    throw error;
  } finally {
    executions.delete(
      page.id
    );
  }
}

export function stopMovement(
  pageId: string
): boolean {
  const execution =
    executions.get(
      pageId
    );

  if (!execution) {
    return false;
  }

  execution.cancelled =
    true;

  execution.moving =
    false;

  execution.desiredSpeed =
    0;

  updateState(
    execution,
    {
      status:
        "stopping",
      desiredSpeed:
        0,
      info:
        "Stopping Movement...",
    }
  );

  try {
    applyDesiredSpeed(
      execution
    );
  } catch {
    // The running execution will surface communication failure if relevant.
  }

  return true;
}

export function abortMovement(
  pageId: string
): boolean {
  const execution =
    executions.get(
      pageId
    );

  if (!execution) {
    return false;
  }

  execution.emergencyAbort =
    true;

  const stopped =
    stopMovement(
      pageId
    );

  wsApi.emergencyStop();

  return stopped;
}

installTracking();
