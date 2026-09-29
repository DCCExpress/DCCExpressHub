import type {
  BlockStateChangedPayload,
  SensorChangedPayload,
  SensorSnapshotPayload,
  TurnoutChangedPayload,
} from "../domain/railwayRuntimeEvents";

import type {
  MovementAction,
  MovementPage,
  MovementResourceEventName,
  MovementWhen,
} from "../domain/movement";

import {
  broadcastAudioPlayback,
  broadcastAudioPlaybackNoWait,
} from "./broadcastAudioRuntime";

import {
  updateAutomationMovementTiming,
} from "./automationApi";

import {
  clearOptimisticBlockTargetLoco,
  createBlockTargetLocoMarker,
  setOptimisticBlockTargetLoco,
} from "./blockTargetLocoRuntime";

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
  effectiveMovementResourceEventRule,
  movementResourceRuleSatisfied,
} from "./movementResourceEvents";

import {
  movementLegPathSafetySensors,
} from "./movementSafety";

import {
  wsApi,
} from "./wsApi";

import {
  wsClient,
} from "./wsClient";

import {
  clearMovementBlockRuntime,
  clearMovementBlockRuntimeByOwner,
  clearMovementBlockRuntimeByOwnerPhase,
  setMovementBlockRuntime,
  type MovementBlockWaitingReason,
} from "./movementBlockRuntime";

import {
  isTrackPowerOn,
} from "./trackPowerRuntime";

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
  stoppedAt:
    number | null;
  locoAddress:
    number | null;
  desiredSpeed: number;
  currentResourceKey:
    string | null;
  activeRouteResourceKey:
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

type SwitchManResponseData = {
  requestId?: string;
  action?: string;
  ok?: boolean;
  message?: string | null;
  extra?: {
    locks?: unknown[];
    conflicts?: unknown[];
    released?: number;
  } | null;
};

type TurnoutLease = {
  ownerId: string;
  addresses: number[];
  release:
    () => Promise<void>;
};

type BlockTargetLease = {
  blockId: string;
  marker: string;
  release:
    () => Promise<void>;
};

type MovementLegLease = {
  resources:
    ResourceLease[];
  turnouts:
    TurnoutLease | null;
  target:
    BlockTargetLease | null;
};

type BlockApproachState = {
  fired: boolean;
};

type BlockLeaveState = {
  seenOccupied: boolean;
  fired: boolean;
};

type ResourceLeaveState = {
  resource:
    MovementPlanResource;
  ready: boolean;
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
  currentBlockId:
    number | null;
  targetBlockId:
    number | null;
  cancelled: boolean;
  emergencyAbort: boolean;
  state:
    MovementEngineState;
  backgroundTasks:
    Set<Promise<void>>;
  resourceLeaves:
    Map<
      string,
      ResourceLeaveState
    >;
  resourceLeaveFired:
    Set<string>;
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

let blockSnapshotKnown =
  false;

let trackingInstalled =
  false;

const idleState =
  (): MovementEngineState => ({
    status:
      "idle",
    startedAt:
      null,
    stoppedAt:
      null,
    locoAddress:
      null,
    desiredSpeed:
      0,
    currentResourceKey:
      null,
    activeRouteResourceKey:
      null,
    info:
      null,
    error:
      null,
  });

async function persistMovementTiming(
  pageId: string,
  startedAt: number | null,
  stoppedAt: number | null
): Promise<void> {
  try {
    await updateAutomationMovementTiming(
      pageId,
      startedAt,
      stoppedAt
    );
  } catch (error) {
    console.error(
      "[Movement] Could not persist run timing",
      pageId,
      error
    );
  }
}

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

function resourceEntryEvent(
  resource:
    MovementPlanResource
): MovementResourceEventName {
  return resource.kind ===
    "turnout"
    ? "approach"
    : "enter";
}

function resourceEventSatisfied(
  execution:
    MovementExecution,
  resource:
    MovementPlanResource,
  event:
    MovementResourceEventName
): boolean {
  const rule =
    effectiveMovementResourceEventRule(
      execution.page.resourceEventRules,
      resource,
      event
    );

  if (
    rule.conditions.length ===
      0
  ) {
    return false;
  }

  return movementResourceRuleSatisfied(
    rule,
    sensor =>
      sensorStates.get(
        sensor
      )
  );
}

function captureResourceLeaveTransitions(
  changedSensor:
    number | null =
      null
): void {
  for (
    const execution of
    executions.values()
  ) {
    for (
      const state of
      execution.resourceLeaves.values()
    ) {
      if (state.ready) {
        continue;
      }

      const rule =
        effectiveMovementResourceEventRule(
          execution.page.resourceEventRules,
          state.resource,
          "leave"
        );

      if (
        rule.conditions.length ===
        0
      ) {
        continue;
      }

      if (
        changedSensor !==
          null &&
        !rule.conditions.some(
          condition =>
            condition.sensor ===
            changedSensor
        )
      ) {
        continue;
      }

      if (
        movementResourceRuleSatisfied(
          rule,
          sensor =>
            sensorStates.get(
              sensor
            )
        )
      ) {
        state.ready =
          true;
      }
    }
  }
}

function armResourceLeave(
  execution:
    MovementExecution,
  resource:
    MovementPlanResource
): boolean {
  execution.resourceLeaveFired.delete(
    resource.key
  );

  const rule =
    effectiveMovementResourceEventRule(
      execution.page.resourceEventRules,
      resource,
      "leave"
    );

  if (
    rule.conditions.length ===
      0
  ) {
    return false;
  }

  execution.resourceLeaves.set(
    resource.key,
    {
      resource,
      ready:
        movementResourceRuleSatisfied(
          rule,
          sensor =>
            sensorStates.get(
              sensor
            )
        ),
    }
  );

  return true;
}

async function drainReadyResourceLeaves(
  execution:
    MovementExecution
): Promise<void> {
  const ready =
    [
      ...execution.resourceLeaves.entries(),
    ].filter(
      (
        [
          ,
          state,
        ]
      ) =>
        state.ready
    );

  for (
    const [
      key,
      state,
    ] of ready
  ) {
    execution.resourceLeaves.delete(
      key
    );

    execution.resourceLeaveFired.add(
      key
    );

    await runActions(
      execution,
      state.resource.key,
      "leave"
    );
  }
}

async function runLegacyLeaveIfNeeded(
  execution:
    MovementExecution,
  resource:
    MovementPlanResource
): Promise<void> {
  await drainReadyResourceLeaves(
    execution
  );

  if (
    execution.resourceLeaveFired.has(
      resource.key
    ) ||
    execution.resourceLeaves.has(
      resource.key
    )
  ) {
    return;
  }

  execution.resourceLeaveFired.add(
    resource.key
  );

  await runActions(
    execution,
    resource.key,
    "leave"
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

  wsClient.subscribeStatus(
    status => {
      if (
        status ===
          "connected"
      ) {
        wsApi.getBlocks();
        wsApi.getLayoutRuntimeSnapshot();
        return;
      }

      sensorStates.clear();
      turnoutStates.clear();
      blockStates = {};
      blockSnapshotKnown =
        false;
    }
  );

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

        captureResourceLeaveTransitions(
          data.address
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

      captureResourceLeaveTransitions();
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

      blockSnapshotKnown =
        true;
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

function createRequestId(
  prefix: string
): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return (
    `${prefix}-${Date.now()}-` +
    Math.random()
      .toString(16)
      .slice(2)
  );
}

async function switchManRequest(
  action: string,
  data:
    Record<string, unknown>,
  timeoutMs = 10000
): Promise<SwitchManResponseData> {
  const requestId =
    createRequestId(
      `movement-${action}`
    );

  return await new Promise<SwitchManResponseData>(
    (
      resolve,
      reject
    ) => {
      let settled =
        false;

      const finish =
        (
          callback:
            () => void
        ): void => {
          if (
            settled
          ) {
            return;
          }

          settled =
            true;

          window.clearTimeout(
            timer
          );

          unsubscribe();

          callback();
        };

      const unsubscribe =
        wsClient.subscribeMessages(
          message => {
            const raw =
              message as unknown as {
                type?: string;
                data?:
                  SwitchManResponseData;
              };

            if (
              raw.type !==
                "switchManResponse" ||
              raw.data?.requestId !==
                requestId ||
              raw.data?.action !==
                action
            ) {
              return;
            }

            if (
              !raw.data.ok
            ) {
              finish(
                () => {
                  const error =
                    new Error(
                      raw.data?.message ||
                      `SwitchMan ${action} failed.`
                    ) as Error & {
                      code?: string;
                      details?: unknown;
                    };

                  error.code =
                    raw.data?.message ??
                    "switchman_failed";

                  error.details =
                    raw.data?.extra ??
                    null;

                  reject(
                    error
                  );
                }
              );

              return;
            }

            finish(
              () =>
                resolve(
                  raw.data ??
                  {}
                )
            );
          }
        );

      const timer =
        window.setTimeout(
          () => {
            finish(
              () =>
                reject(
                  new Error(
                    `SwitchMan ${action} timed out.`
                  )
                )
            );
          },
          timeoutMs
        );

      const sent =
        wsClient.send({
          type:
            "switchManCommand",
          data: {
            requestId,
            action,
            ...data,
          },
        } as any);

      if (
        !sent
      ) {
        finish(
          () =>
            reject(
              new Error(
                "Movement could not send SwitchMan command."
              )
            )
        );
      }
    }
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

function setMovementBlockPhase(
  execution:
    MovementExecution,
  blockId:
    number | null,
  phase:
    "moving" |
    "executing" |
    "waiting" |
    "error",
  info: string,
  waitingReason:
    MovementBlockWaitingReason |
    null =
      null,
  replaceOwnerState = true
): void {
  if (
    replaceOwnerState
  ) {
    clearMovementBlockRuntimeByOwner(
      execution.page.id
    );
  }

  if (
    blockId ===
      null
  ) {
    return;
  }

  setMovementBlockRuntime(
    blockId,
    {
      ownerId:
        execution.page.id,
      movementName:
        execution.page.name,
      locoAddress:
        execution.locoAddress,
      direction:
        execution.direction,
      phase,
      waitingReason,
      info,
    }
  );
}

function setMovementWaiting(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg,
  waitingReason:
    MovementBlockWaitingReason,
  info: string
): void {
  execution.currentBlockId =
    leg.from.blockId;

  setMovementBlockPhase(
    execution,
    leg.from.blockId,
    "waiting",
    info,
    waitingReason
  );

  setInfo(
    execution,
    info,
    leg.from.key
  );
}

function setMovementExecuting(
  execution:
    MovementExecution,
  info: string
): void {
  if (
    execution.cancelled ||
    execution.physicalSpeed >
      0
  ) {
    return;
  }

  setMovementBlockPhase(
    execution,
    execution.currentBlockId,
    "executing",
    info
  );
}

function clearMovementExecuting(
  execution:
    MovementExecution
): void {
  if (
    execution.currentBlockId ===
      null
  ) {
    return;
  }

  clearMovementBlockRuntime(
    execution.currentBlockId,
    execution.page.id,
    "executing"
  );
}

function clearMovementWaiting(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg
): void {
  if (
    leg.from.blockId ===
      null
  ) {
    return;
  }

  clearMovementBlockRuntime(
    leg.from.blockId,
    execution.page.id,
    "waiting"
  );
}

function syncMovementMotionRuntime(
  execution:
    MovementExecution
): void {
  if (
    !execution.moving ||
    execution.cancelled ||
    execution.physicalSpeed <=
      0
  ) {
    clearMovementBlockRuntimeByOwnerPhase(
      execution.page.id,
      "moving"
    );

    return;
  }

  clearMovementBlockRuntimeByOwner(
    execution.page.id
  );

  const info =
    `Movement running: ${execution.page.name}`;

  setMovementBlockPhase(
    execution,
    execution.currentBlockId,
    "moving",
    info,
    null,
    false
  );

  if (
    execution.targetBlockId !==
      null &&
    execution.targetBlockId !==
      execution.currentBlockId
  ) {
    setMovementBlockPhase(
      execution,
      execution.targetBlockId,
      "moving",
      info,
      null,
      false
    );
  }
}

function setMovementError(
  execution:
    MovementExecution,
  message: string
): void {
  setMovementBlockPhase(
    execution,
    execution.currentBlockId,
    "error",
    message
  );
}

function setActiveRouteResource(
  execution:
    MovementExecution,
  resourceKey:
    string | null
): void {
  if (
    execution.state.activeRouteResourceKey ===
      resourceKey
  ) {
    return;
  }

  updateState(
    execution,
    {
      activeRouteResourceKey:
        resourceKey,
    }
  );
}

function setPhysicalSpeed(
  execution:
    MovementExecution,
  speed: number,
  force = false
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
    !force &&
    execution.physicalSpeed ===
      safeSpeed
  ) {
    return;
  }

  console.info(
    "[Movement] throttle",
    {
      page:
        execution.page.name,
      locoAddress:
        execution.locoAddress,
      speed:
        safeSpeed,
      logicalDirection:
        execution.direction,
    }
  );

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

  syncMovementMotionRuntime(
    execution
  );
}

async function armMovementDirection(
  execution:
    MovementExecution
): Promise<void> {
  const before =
    wsClient.getLatestLocoState(
      execution.locoAddress
    );

  console.info(
    "[Movement] arm direction",
    {
      page:
        execution.page.name,
      locoAddress:
        execution.locoAddress,
      requestedLogicalDirection:
        execution.direction,
      previousLogicalDirection:
        before?.direction ??
        null,
      previousSpeed:
        before?.speed ??
        null,
    }
  );

  execution.moving =
    false;

  /*
   * Always send an explicit STOP with the requested LOGICAL direction.
   *
   * Do not rely on execution.physicalSpeed here: a freshly created Movement
   * execution starts with physicalSpeed=0 as an internal cache value, but the
   * decoder may still hold the direction from the previous run. The backend is
   * the only layer that applies locomotive inversion.
   */
  setPhysicalSpeed(
    execution,
    0,
    true
  );

  /*
   * Give the command station/decoder a short stopped interval to accept the
   * direction before any non-zero speed command can be emitted.
   */
  await controlledDelay(
    execution,
    150
  );

  wsApi.getLoco(
    execution.locoAddress
  );

  const deadline =
    Date.now() +
    1200;

  while (
    !execution.cancelled &&
    Date.now() <
      deadline
  ) {
    const current =
      wsClient.getLatestLocoState(
        execution.locoAddress
      );

    if (
      current &&
      current.speed ===
        0 &&
      current.direction ===
        execution.direction
    ) {
      console.info(
        "[Movement] direction armed",
        {
          page:
            execution.page.name,
          locoAddress:
            execution.locoAddress,
          logicalDirection:
            current.direction,
        }
      );

      return;
    }

    await controlledDelay(
      execution,
      50
    );
  }

  throw new Error(
    `Movement could not confirm stopped locomotive direction "${execution.direction}" for DCC address ${execution.locoAddress}.`
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

async function runActionSequence(
  execution:
    MovementExecution,
  resourceKey: string,
  when:
    MovementWhen,
  actions:
    MovementAction[],
  reportInfo = true
): Promise<void> {
  try {
    for (const action of actions) {
      if (
        execution.cancelled
      ) {
        throw new Error(
          "Movement cancelled."
        );
      }

      if (
        reportInfo
      ) {
        setMovementExecuting(
          execution,
          `${when.toUpperCase()}: ${action.kind}`
        );

        setInfo(
          execution,
          `${when.toUpperCase()}: ${action.kind}`,
          resourceKey
        );
      }

      await executeAction(
        execution,
        action
      );
    }
  } finally {
    if (
      reportInfo
    ) {
      clearMovementExecuting(
        execution
      );
    }
  }
}

function startBackgroundSequence(
  execution:
    MovementExecution,
  resourceKey: string,
  when:
    MovementWhen,
  actions:
    MovementAction[]
): void {
  let task:
    Promise<void>;

  task =
    runActionSequence(
      execution,
      resourceKey,
      when,
      actions,
      false
    )
      .catch(
        error => {
          if (
            execution.cancelled
          ) {
            return;
          }

          console.error(
            "[Movement] Background sequence failed",
            execution.page.name,
            resourceKey,
            when,
            error
          );

          setInfo(
            execution,
            `Background sequence failed: ${
              error instanceof Error
                ? error.message
                : String(error)
            }`,
            resourceKey
          );
        }
      )
      .finally(
        () => {
          execution.backgroundTasks.delete(
            task
          );
        }
      );

  execution.backgroundTasks.add(
    task
  );
}

async function runActions(
  execution:
    MovementExecution,
  resourceKey: string,
  when:
    MovementWhen
): Promise<void> {
  const matching =
    execution.page.actions.filter(
      action =>
        action.resourceKey ===
          resourceKey &&
        action.when ===
          when
    );

  const sequences:
    Array<{
      id: string;
      mode:
        "blocking" |
        "background";
      actions:
        MovementAction[];
    }> = [];

  const byId =
    new Map<
      string,
      typeof sequences[number]
    >();

  for (const action of matching) {
    let sequence =
      byId.get(
        action.sequenceId
      );

    if (!sequence) {
      sequence = {
        id:
          action.sequenceId,
        mode:
          action.sequenceMode,
        actions: [],
      };

      byId.set(
        action.sequenceId,
        sequence
      );

      sequences.push(
        sequence
      );
    }

    sequence.actions.push(
      action
    );
  }

  for (const sequence of sequences) {
    if (
      sequence.mode ===
      "background"
    ) {
      startBackgroundSequence(
        execution,
        resourceKey,
        when,
        sequence.actions
      );

      continue;
    }

    await runActionSequence(
      execution,
      resourceKey,
      when,
      sequence.actions
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
  if (
    !blockSnapshotKnown
  ) {
    return false;
  }

  const state =
    blockStateFor(
      block.blockId
    );

  if (!state) {
    return false;
  }

  if (
    (
      state.locoAddress ??
      0
    ) >
      0 ||
    (
      state.locoId !==
        null &&
      state.locoId !==
        undefined &&
      state.locoId !==
        ""
    )
  ) {
    return false;
  }

  if (
    block.sensorAddress !==
      null &&
    sensorStates.get(
      block.sensorAddress
    ) !==
      false
  ) {
    return false;
  }

  return true;
}

function aheadPathSensorsAreFree(
  leg:
    MovementPlanLeg
): boolean {
  return movementLegPathSafetySensors(
    leg
  ).every(
    address =>
      sensorStates.get(
        address
      ) ===
        false
  );
}

function blockedPathSafetySensorSummary(
  leg:
    MovementPlanLeg
): string {
  return movementLegPathSafetySensors(
    leg
  )
    .filter(
      address =>
        sensorStates.get(
          address
        ) !==
          false
    )
    .map(
      address => {
        const state =
          sensorStates.get(
            address
          );

        return (
          `#${address}=` +
          (
            state ===
              true
              ? "ON"
              : "UNKNOWN"
          )
        );
      }
    )
    .join(
      ", "
    );
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

function normalizedTurnoutRequirements(
  leg:
    MovementPlanLeg
): Array<{
  address: number;
  closed: boolean;
}> {
  const byAddress =
    new Map<
      number,
      boolean
    >();

  for (
    const state of
    leg.turnoutStates
  ) {
    if (
      !Number.isInteger(
        state.address
      ) ||
      state.address < 1 ||
      state.address > 2048
    ) {
      throw new Error(
        `Movement route contains invalid turnout address: ${state.address}.`
      );
    }

    const existing =
      byAddress.get(
        state.address
      );

    if (
      existing !==
        undefined &&
      existing !==
        state.closed
    ) {
      throw new Error(
        `Movement route contains conflicting turnout state for #${state.address}.`
      );
    }

    byAddress.set(
      state.address,
      state.closed
    );
  }

  return [
    ...byAddress.entries(),
  ]
    .sort(
      (
        [a],
        [b]
      ) =>
        a - b
    )
    .map(
      ([
        address,
        closed,
      ]) => ({
        address,
        closed,
      })
    );
}

async function tryAcquireAndSetTurnouts(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg
): Promise<TurnoutLease | null> {
  const requirements =
    normalizedTurnoutRequirements(
      leg
    );

  if (
    requirements.length ===
    0
  ) {
    return null;
  }

  const addresses =
    requirements.map(
      state =>
        state.address
    );

  const ownerId =
    createRequestId(
      `movement-${execution.page.id}-leg-${leg.index}`
    );

  const ownerName =
    `Movement: ${execution.page.name}`;

  try {
    await switchManRequest(
      "acquire",
      {
        ownerId,
        ownerName,
        addresses,
        timeoutMs: 0,
      },
      5000
    );
  } catch (error) {
    const code =
      (
        error as {
          code?: unknown;
        }
      )?.code;

    if (
      code ===
      "turnout_locked"
    ) {
      return null;
    }

    throw error;
  }

  let released =
    false;

  const release =
    async (): Promise<void> => {
      if (
        released
      ) {
        return;
      }

      released =
        true;

      await switchManRequest(
        "release",
        {
          ownerId,
          ownerName,
          addresses,
        },
        5000
      );
  };

  try {
    for (
      let index = 0;
      index <
        requirements.length;
      index += 1
    ) {
      if (
        execution.cancelled
      ) {
        throw new Error(
          "Movement cancelled."
        );
      }

      const requirement =
        requirements[
          index
        ]!;

      const current =
        turnoutStates.get(
          requirement.address
        );

      if (
        current ===
        requirement.closed
      ) {
        continue;
      }

      execution.moving =
        false;

      applyDesiredSpeed(
        execution
      );

      setInfo(
        execution,
        `Setting turnout #${requirement.address} → ${requirement.closed ? "CLOSED" : "THROWN"}`,
        leg.from.key
      );

      await switchManRequest(
        "set",
        {
          ownerId,
          ownerName,
          address:
            requirement.address,
          closed:
            requirement.closed,
        },
        10000
      );

      /*
       * The backend ACK is authoritative. Update the local cache immediately;
       * turnoutChanged will reconcile it as well.
       */
      turnoutStates.set(
        requirement.address,
        requirement.closed
      );

      if (
        index + 1 <
          requirements.length
      ) {
        await controlledDelay(
          execution,
          250
        );
      }
    }

    wsApi.getLayoutRuntimeSnapshot();

    return {
      ownerId,
      addresses,
      release,
    };
  } catch (error) {
    try {
      await release();
    } catch {
      // Preserve the original setting error.
    }

    throw error;
  }
}

function blockAvailableForTarget(
  block:
    MovementPlanResource,
  ownMarker:
    string | null =
      null
): boolean {
  if (
    !blockSnapshotKnown
  ) {
    return false;
  }

  const state =
    blockStateFor(
      block.blockId
    );

  if (!state) {
    return false;
  }

  if (
    block.sensorAddress !==
      null &&
    sensorStates.get(
      block.sensorAddress
    ) !==
      false
  ) {
    return false;
  }

  if (
    (
      state.locoAddress ??
      0
    ) >
    0
  ) {
    return false;
  }

  if (
    state.locoId ===
      null ||
    state.locoId ===
      undefined ||
    state.locoId ===
      ""
  ) {
    return true;
  }

  return (
    ownMarker !==
      null &&
    state.locoId ===
      ownMarker
  );
}

function reserveBlockTarget(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg
): BlockTargetLease {
  if (
    leg.to.blockId ===
    null
  ) {
    throw new Error(
      "Movement destination block ID is missing."
    );
  }

  const blockId =
    String(
      leg.to.blockId
    );

  const ownerId =
    createRequestId(
      `movement-target-${execution.page.id}-leg-${leg.index}`
    );

  const marker =
    createBlockTargetLocoMarker(
      execution.locoAddress,
      ownerId
    );

  if (
    !wsApi.setBlock(
      blockId,
      marker
    )
  ) {
    throw new Error(
      `Movement could not set target locomotive for block "${leg.to.name}".`
    );
  }

  setOptimisticBlockTargetLoco(
    blockId,
    execution.locoAddress,
    ownerId,
    marker
  );

  execution.targetBlockId =
    leg.to.blockId;

  setInfo(
    execution,
    `Target ${leg.to.name}: loco ${execution.locoAddress}`,
    leg.to.key
  );

  let released =
    false;

  return {
    blockId,
    marker,
    async release() {
      if (
        released
      ) {
        return;
      }

      released =
        true;

      /*
       * Owner-safe cleanup. If actual occupancy already replaced the target
       * marker, the backend refuses to remove the real locomotive.
       */
      wsApi.setBlockRemove(
        blockId,
        marker
      );

      clearOptimisticBlockTargetLoco(
        blockId,
        marker
      );

      if (
        execution.targetBlockId ===
          leg.to.blockId
      ) {
        execution.targetBlockId =
          null;
      }
    },
  };
}

async function releaseMovementLegLease(
  lease:
    MovementLegLease
): Promise<void> {
  try {
    if (
      lease.target
    ) {
      await lease.target.release();
    }
  } finally {
    try {
      if (
        lease.turnouts
      ) {
        await lease.turnouts.release();
      }
    } finally {
      await releaseLeases(
        lease.resources
      );
    }
  }
}

async function waitForPreDepartureAvailability(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg
): Promise<void> {
  let lastInfo =
    "";

  try {
    while (
      !execution.cancelled
    ) {
      let reason =
        "";

      let waitingReason:
        MovementBlockWaitingReason |
        null =
        null;

      if (
        !blockAvailableForTarget(
          leg.to
        )
      ) {
        reason =
          `Waiting for block ${leg.to.name}`;

        waitingReason =
          "targetBlock";
      } else if (
        !aheadPathSensorsAreFree(
          leg
        )
      ) {
        reason =
          `Waiting for safety: ${blockedPathSafetySensorSummary(
            leg
          )}`;

        waitingReason =
          "segment";
      }

      if (
        !reason ||
        !waitingReason
      ) {
        return;
      }

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

        setMovementWaiting(
          execution,
          leg,
          waitingReason,
          reason
        );
      }

      await controlledDelay(
        execution,
        150
      );
    }

    throw new Error(
      "Movement cancelled."
    );
  } finally {
    clearMovementWaiting(
      execution,
      leg
    );
  }
}

async function waitForLegClearance(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg
): Promise<MovementLegLease> {
  let lastInfo =
    "";

  const showWaiting =
    (
      waitingReason:
        MovementBlockWaitingReason,
      info: string
    ): void => {
      if (
        info ===
          lastInfo
      ) {
        return;
      }

      lastInfo =
        info;

      setMovementWaiting(
        execution,
        leg,
        waitingReason,
        info
      );
    };

  const clearWaiting =
    (): void => {
      lastInfo =
        "";

      clearMovementWaiting(
        execution,
        leg
      );
    };

  try {
    while (
      !execution.cancelled
    ) {
      let reason =
        "";

      let waitingReason:
        MovementBlockWaitingReason |
        null =
        null;

      if (
        !blockAvailableForTarget(
          leg.to
        )
      ) {
        reason =
          `Waiting for block ${leg.to.name}`;

        waitingReason =
          "targetBlock";
      } else if (
        !aheadPathSensorsAreFree(
          leg
        )
      ) {
        reason =
          `Waiting for safety: ${blockedPathSafetySensorSummary(
            leg
          )}`;

        waitingReason =
          "segment";
      }

      if (
        reason &&
        waitingReason
      ) {
        execution.moving =
          false;

        applyDesiredSpeed(
          execution
        );

        showWaiting(
          waitingReason,
          reason
        );

        await controlledDelay(
          execution,
          150
        );

        continue;
      }

      const resources =
        await tryAcquireLeg(
          leg
        );

      if (
        !resources
      ) {
        execution.moving =
          false;

        applyDesiredSpeed(
          execution
        );

        showWaiting(
          "resourceLock",
          "Waiting for Movement resource lock"
        );

        await controlledDelay(
          execution,
          150
        );

        continue;
      }

      clearWaiting();

      if (
        !blockAvailableForTarget(
          leg.to
        ) ||
        !aheadPathSensorsAreFree(
          leg
        )
      ) {
        await releaseLeases(
          resources
        );

        continue;
      }

      let turnouts:
        TurnoutLease |
        null =
        null;

      try {
        turnouts =
          await tryAcquireAndSetTurnouts(
            execution,
            leg
          );
      } catch (error) {
        await releaseLeases(
          resources
        );

        throw error;
      }

      if (
        leg.turnoutStates.length >
          0 &&
        !turnouts
      ) {
        await releaseLeases(
          resources
        );

        execution.moving =
          false;

        applyDesiredSpeed(
          execution
        );

        showWaiting(
          "turnoutLock",
          "Waiting for turnout lock"
        );

        await controlledDelay(
          execution,
          150
        );

        continue;
      }

      if (
        blockAvailableForTarget(
          leg.to
        ) &&
        aheadPathSensorsAreFree(
          leg
        )
      ) {
        let target:
          BlockTargetLease |
          null =
          null;

        try {
          target =
            reserveBlockTarget(
              execution,
              leg
            );

          clearWaiting();

          return {
            resources,
            turnouts,
            target,
          };
        } catch (error) {
          await releaseMovementLegLease({
            resources,
            turnouts,
            target,
          });

          throw error;
        }
      }

      await releaseMovementLegLease({
        resources,
        turnouts,
        target:
          null,
      });
    }

    throw new Error(
      "Movement cancelled."
    );
  } finally {
    clearWaiting();
  }
}

function conditionsSatisfied(
  conditions:
    MovementPlanLeg["arrivedWhen"]
): boolean {
  return (
    conditions.length >
      0 &&
    conditions.every(
      condition =>
        sensorStates.get(
          condition.sensor
        ) ===
          condition.state
    )
  );
}

function arrivalSatisfied(
  leg:
    MovementPlanLeg
): boolean {
  return conditionsSatisfied(
    leg.arrivedWhen
  );
}

async function waitForDepartureConditions(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg
): Promise<void> {
  if (
    leg.departWhen.length ===
      0
  ) {
    return;
  }

  let waitingShown =
    false;

  try {
    while (
      !execution.cancelled
    ) {
      if (
        conditionsSatisfied(
          leg.departWhen
        )
      ) {
        return;
      }

      if (
        !waitingShown
      ) {
        waitingShown =
          true;

        execution.moving =
          false;

        applyDesiredSpeed(
          execution
        );

        setMovementWaiting(
          execution,
          leg,
          "departureCondition",
          `Waiting for departure: ${leg.from.name}`
        );
      }

      await controlledDelay(
        execution,
        100
      );
    }

    throw new Error(
      "Movement cancelled."
    );
  } finally {
    clearMovementWaiting(
      execution,
      leg
    );
  }
}

async function maybeRunBlockApproach(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg,
  state:
    BlockApproachState
): Promise<void> {
  if (
    state.fired ||
    leg.approachWhen.length ===
      0 ||
    !conditionsSatisfied(
      leg.approachWhen
    )
  ) {
    return;
  }

  state.fired =
    true;

  await runActions(
    execution,
    leg.to.key,
    "approach"
  );

  setInfo(
    execution,
    `Approaching block: ${leg.to.name}`,
    leg.to.key
  );
}

function createBlockLeaveState(
  leg:
    MovementPlanLeg
): BlockLeaveState {
  const sensorAddress =
    leg.from.sensorAddress;

  return {
    seenOccupied:
      sensorAddress !==
        null &&
      sensorStates.get(
        sensorAddress
      ) ===
        true,
    fired:
      false,
  };
}

async function maybeRunBlockLeave(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg,
  state:
    BlockLeaveState
): Promise<void> {
  if (
    state.fired ||
    leg.leaveWhen.length ===
      0
  ) {
    return;
  }

  if (
    leg.leaveWhenExplicit
  ) {
    if (
      !conditionsSatisfied(
        leg.leaveWhen
      )
    ) {
      return;
    }
  } else {
    const sensorAddress =
      leg.from.sensorAddress;

    if (
      sensorAddress ===
      null
    ) {
      return;
    }

    const occupied =
      sensorStates.get(
        sensorAddress
      );

    if (
      occupied ===
        true
    ) {
      state.seenOccupied =
        true;

      return;
    }

    if (
      occupied !==
        false ||
      !state.seenOccupied
    ) {
      return;
    }
  }

  state.fired =
    true;

  await runActions(
    execution,
    leg.from.key,
    "leave"
  );

  setInfo(
    execution,
    `Left block: ${leg.from.name}`,
    leg.from.key
  );
}

async function waitForBlockLeave(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg,
  state:
    BlockLeaveState
): Promise<void> {
  if (
    state.fired ||
    leg.leaveWhen.length ===
      0
  ) {
    return;
  }

  setInfo(
    execution,
    `Waiting for leave: ${leg.from.name}`,
    leg.from.key
  );

  while (
    !execution.cancelled
  ) {
    await drainReadyResourceLeaves(
      execution
    );

    await maybeRunBlockLeave(
      execution,
      leg,
      state
    );

    if (
      state.fired
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

async function runBlockLeaveFallback(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg,
  state:
    BlockLeaveState
): Promise<void> {
  if (
    state.fired
  ) {
    return;
  }

  state.fired =
    true;

  await runActions(
    execution,
    leg.from.key,
    "leave"
  );

  setInfo(
    execution,
    `Left block: ${leg.from.name}`,
    leg.from.key
  );
}

async function waitForHeldLegReady(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg,
  targetMarker:
    string | null
): Promise<void> {
  let lastInfo =
    "";

  try {
    while (
      !execution.cancelled
    ) {
      let reason =
        "";

      let waitingReason:
        MovementBlockWaitingReason |
        null =
        null;

      if (
        !blockAvailableForTarget(
          leg.to,
          targetMarker
        )
      ) {
        reason =
          `Waiting for block ${leg.to.name}`;

        waitingReason =
          "targetBlock";
      } else if (
        !aheadPathSensorsAreFree(
          leg
        )
      ) {
        reason =
          `Waiting for safety: ${blockedPathSafetySensorSummary(
            leg
          )}`;

        waitingReason =
          "segment";
      }

      if (
        !reason ||
        !waitingReason
      ) {
        return;
      }

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

        setMovementWaiting(
          execution,
          leg,
          waitingReason,
          reason
        );
      }

      await controlledDelay(
        execution,
        100
      );
    }

    throw new Error(
      "Movement cancelled."
    );
  } finally {
    clearMovementWaiting(
      execution,
      leg
    );
  }
}

async function waitForArrival(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg,
  blockLeaveState:
    BlockLeaveState,
  blockApproachState:
    BlockApproachState
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
    await drainReadyResourceLeaves(
      execution
    );

    await maybeRunBlockLeave(
      execution,
      leg,
      blockLeaveState
    );

    await maybeRunBlockApproach(
      execution,
      leg,
      blockApproachState
    );

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

async function waitForResourceEntry(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg,
  resource:
    MovementPlanResource,
  blockLeaveState:
    BlockLeaveState,
  blockApproachState:
    BlockApproachState
): Promise<void> {
  const entryEvent =
    resourceEntryEvent(
      resource
    );

  const entryRule =
    effectiveMovementResourceEventRule(
      execution.page.resourceEventRules,
      resource,
      entryEvent
    );

  if (
    entryRule.conditions.length ===
    0
  ) {
    return;
  }

  setInfo(
    execution,
    `Waiting for ${resource.kind} ${resource.name}`,
    resource.key
  );

  while (
    !execution.cancelled
  ) {
    await drainReadyResourceLeaves(
      execution
    );

    await maybeRunBlockLeave(
      execution,
      leg,
      blockLeaveState
    );

    await maybeRunBlockApproach(
      execution,
      leg,
      blockApproachState
    );

    if (
      resourceEventSatisfied(
        execution,
        resource,
        entryEvent
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
  execution.currentBlockId =
    leg.from.blockId;

  await drainReadyResourceLeaves(
    execution
  );

  if (
    execution.moving
  ) {
    syncMovementMotionRuntime(
      execution
    );
  }

  setActiveRouteResource(
    execution,
    leg.from.key
  );

  /*
   * Do not reserve the next leg while a custom DEPART condition is still
   * false. This keeps rolling authority local to the actual movement.
   */
  await waitForDepartureConditions(
    execution,
    leg
  );

  /*
   * BEFORE DEPART should happen only when the next leg is basically clear,
   * but it must not hold route or turnout locks during audio/delay actions.
   */
  await waitForPreDepartureAvailability(
    execution,
    leg
  );

  await runActions(
    execution,
    leg.from.key,
    "beforeDepart"
  );

  const leases =
    await waitForLegClearance(
      execution,
      leg
    );

  try {
    /*
     * Revalidate the state-based departure condition after authority is held.
     */
    await waitForDepartureConditions(
      execution,
      leg
    );

    await runActions(
      execution,
      leg.from.key,
      "depart"
    );

    /*
     * DEPART actions may contain delays/audio. Revalidate the already locked
     * movement authority immediately before applying non-zero speed.
     */
    await waitForHeldLegReady(
      execution,
      leg,
      leases.target?.marker ??
      null
    );

    execution.moving =
      true;

    applyDesiredSpeed(
      execution
    );

    const blockApproachState:
      BlockApproachState = {
        fired:
          false,
      };

    await maybeRunBlockApproach(
      execution,
      leg,
      blockApproachState
    );

    const approachSegments =
      leg.resources.filter(
        resource =>
          resource.kind ===
          "segment"
      );

    const approachSegment =
      approachSegments.length >
        0
        ? approachSegments[
            approachSegments.length -
              1
          ] ??
          null
        : null;

    if (
      !approachSegment &&
      leg.approachWhen.length ===
        0
    ) {
      await runActions(
        execution,
        leg.to.key,
        "approach"
      );

      blockApproachState.fired =
        true;
    }

    const blockLeaveState =
      createBlockLeaveState(
        leg
      );

    let previousSegment:
      MovementPlanResource |
      null =
      execution.plan.resources.find(
        resource =>
          resource.kind ===
            "segment" &&
          resource.nodeIndex ===
            leg.from.nodeIndex
      ) ??
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
        await waitForResourceEntry(
          execution,
          leg,
          resource,
          blockLeaveState,
          blockApproachState
        );

        setActiveRouteResource(
          execution,
          resource.key
        );

        armResourceLeave(
          execution,
          resource
        );

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

      await waitForResourceEntry(
        execution,
        leg,
        resource,
        blockLeaveState,
        blockApproachState
      );

      setActiveRouteResource(
        execution,
        resource.key
      );

      armResourceLeave(
        execution,
        resource
      );

      await drainReadyResourceLeaves(
        execution
      );

      for (
        const turnout of
        pendingTurnouts.splice(
          0
        )
      ) {
        await runLegacyLeaveIfNeeded(
          execution,
          turnout
        );
      }

      if (
        previousSegment &&
        previousSegment.key !==
          resource.key
      ) {
        await runLegacyLeaveIfNeeded(
          execution,
          previousSegment
        );
      }

      await runActions(
        execution,
        resource.key,
        "enter"
      );

      await maybeRunBlockApproach(
        execution,
        leg,
        blockApproachState
      );

      if (
        !blockApproachState.fired &&
        leg.approachWhen.length ===
          0 &&
        approachSegment?.key ===
          resource.key
      ) {
        await runActions(
          execution,
          leg.to.key,
          "approach"
        );

        blockApproachState.fired =
          true;
      }

      previousSegment =
        resource;
    }

    await waitForArrival(
      execution,
      leg,
      blockLeaveState,
      blockApproachState
    );

    await drainReadyResourceLeaves(
      execution
    );

    setActiveRouteResource(
      execution,
      leg.to.key
    );

    const isFinalLeg =
      execution.plan.legs[
        execution.plan.legs.length -
          1
      ] ===
      leg;

    let finalArrivedActionsRan =
      false;

    if (
      isFinalLeg
    ) {
      /*
       * ARRIVED is the configurable final positioning boundary.
       *
       * Blocking ARRIVED sequences intentionally run while the locomotive
       * still has its current speed. This allows e.g. delay(500) to let the
       * train roll a little farther into the platform. Background sequences
       * are started by runActions() but do not delay the automatic stop.
       */
      await runActions(
        execution,
        leg.to.key,
        "arrived"
      );

      finalArrivedActionsRan =
        true;

      execution.moving =
        false;

      execution.desiredSpeed =
        0;

      updateState(
        execution,
        {
          desiredSpeed:
            0,
        }
      );

      applyDesiredSpeed(
        execution
      );
    }

    await maybeRunBlockLeave(
      execution,
      leg,
      blockLeaveState
    );

    /*
     * An explicit/default LEAVE condition is authoritative for releasing the
     * source block. If configured, wait until it really becomes true.
     */
    await waitForBlockLeave(
      execution,
      leg,
      blockLeaveState
    );

    for (
      const turnout of
      pendingTurnouts.splice(
        0
      )
    ) {
      await runLegacyLeaveIfNeeded(
        execution,
        turnout
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

    /*
     * No configured/default LEAVE sensor means runtime block release is the
     * fallback boundary.
     */
    if (
      leg.leaveWhen.length ===
        0
    ) {
      await runBlockLeaveFallback(
        execution,
        leg,
        blockLeaveState
      );
    }

    await runActions(
      execution,
      leg.from.key,
      "afterLeave"
    );

    if (
      leg.to.blockId !==
        null
    ) {
      const destinationBlockId =
        String(
          leg.to.blockId
        );

      if (
        !wsApi.setBlock(
          destinationBlockId,
          null,
          execution.locoAddress
        )
      ) {
        throw new Error(
          `Movement could not commit locomotive to block "${leg.to.name}".`
        );
      }

      if (
        leases.target
      ) {
        clearOptimisticBlockTargetLoco(
          destinationBlockId,
          leases.target.marker
        );

        /*
         * Actual occupancy replaces the target marker in backend SetBlock.
         * Do not issue owner-cleanup for the already committed block.
         */
        leases.target =
          null;
      }

      execution.currentBlockId =
        leg.to.blockId;

      execution.targetBlockId =
        null;

      syncMovementMotionRuntime(
        execution
      );
    }

    if (
      !finalArrivedActionsRan
    ) {
      await runActions(
        execution,
        leg.to.key,
        "arrived"
      );
    }

    setInfo(
      execution,
      `Arrived: ${leg.to.name}`,
      leg.to.key
    );
  } finally {
    await releaseMovementLegLease(
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

  await drainReadyResourceLeaves(
    execution
  );

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

  if (
    execution.backgroundTasks.size >
      0
  ) {
    await Promise.allSettled(
      [
        ...execution.backgroundTasks,
      ]
    );
  }
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
    !isTrackPowerOn()
  ) {
    throw new Error(
      "Track power is OFF. Turn it on before starting Movement."
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

  if (
    plan.direction ===
      "unknown"
  ) {
    throw new Error(
      `Movement route direction is unknown for "${page.name}". Regenerate/save the route graph and verify the track direction markers.`
    );
  }

  const direction =
    plan.direction;

  const startedAt =
    Date.now();

  const state:
    MovementEngineState = {
    status:
      "running",
    startedAt,
    stoppedAt:
      null,
    locoAddress,
    desiredSpeed:
      page.speed,
    currentResourceKey:
      source.key,
    activeRouteResourceKey:
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
      resourceEventRules:
        page.resourceEventRules.map(
          rule => ({
            ...rule,
            conditions:
              rule.conditions.map(
                condition => ({
                  ...condition,
                })
              ),
          })
        ),
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
    currentBlockId:
      source.blockId,
    targetBlockId:
      null,
    cancelled:
      false,
    emergencyAbort:
      false,
    state,
    backgroundTasks:
      new Set<
        Promise<void>
      >(),
    resourceLeaves:
      new Map(),
    resourceLeaveFired:
      new Set(),
  };

  clearMovementBlockRuntimeByOwner(
    page.id
  );

  executions.set(
    page.id,
    execution
  );

  emit(
    page.id,
    state
  );

  await persistMovementTiming(
    page.id,
    startedAt,
    null
  );

  try {
    await armMovementDirection(
      execution
    );

    await executeMovement(
      execution
    );

    const stoppedAt =
      Date.now();

    updateState(
      execution,
      {
        status:
          "idle",
        stoppedAt,
        desiredSpeed:
          0,
        currentResourceKey:
          null,
        activeRouteResourceKey:
          null,
        info:
          "Movement completed",
        error:
          null,
      }
    );

    await persistMovementTiming(
      page.id,
      execution.state.startedAt,
      stoppedAt
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
      const stoppedAt =
        Date.now();

      updateState(
        execution,
        {
          status:
            "idle",
          stoppedAt,
          desiredSpeed:
            0,
          currentResourceKey:
            null,
          activeRouteResourceKey:
            null,
          info:
            execution.emergencyAbort
              ? "Movement aborted"
              : "Movement stopped",
          error:
            null,
        }
      );

      await persistMovementTiming(
        page.id,
        execution.state.startedAt,
        stoppedAt
      );

      return;
    }

    const message =
      error instanceof Error
        ? error.message
        : String(
            error
          );

    const stoppedAt =
      Date.now();

    setMovementError(
      execution,
      message
    );

    updateState(
      execution,
      {
        status:
          "error",
        stoppedAt,
        desiredSpeed:
          0,
        activeRouteResourceKey:
          null,
        info:
          "Movement failed",
        error:
          message,
      }
    );

    await persistMovementTiming(
      page.id,
      execution.state.startedAt,
      stoppedAt
    );

    throw error;
  } finally {
    if (
      execution.state.status !==
        "error"
    ) {
      clearMovementBlockRuntimeByOwner(
        page.id
      );
    }

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

  clearMovementBlockRuntimeByOwner(
    pageId
  );

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
  pageId: string,
  requestEmergencyStop = true
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

  if (
    requestEmergencyStop
  ) {
    wsApi.emergencyStop();
  }

  return stopped;
}

installTracking();
