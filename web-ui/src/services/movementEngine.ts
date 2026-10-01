import i18next from "i18next";

import {
  getLocos,
} from "../api/domainApi";

import type {
  Loco,
} from "../domain/domainTypes";

import type {
  TrainEventName,
} from "../domain/trainEvents";

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
  movementLegEffectivePathSafetySensors,
  movementLegSensorIsChecked,
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

import {
  emitTrainEvent,
} from "./trainEventRuntime";

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
  configuredLoco:
    Loco | null;
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
  externalHolds:
    Set<string>;
  afterArrivedBlocks:
    Set<number>;
  functionNumbersByBindingId:
    Map<number, number>;
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


function movementTrainEventId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return (
    "train-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2)
  );
}

function emitMovementTrainEvent(
  execution:
    MovementExecution,
  event:
    TrainEventName,
  resource:
    MovementPlanResource
): void {
  const sensors =
    [
      resource.sensorAddress,
      ...resource.detectors,
    ]
      .filter(
        (
          value
        ): value is number =>
          Number.isInteger(value) &&
          (value ?? 0) > 0
      )
      .filter(
        (
          value,
          index,
          values
        ) =>
          values.indexOf(value) ===
          index
      );

  emitTrainEvent({
    id:
      movementTrainEventId(),
    timestamp:
      Date.now(),
    source:
      "movement",
    movementId:
      execution.page.id,
    movementName:
      execution.page.name,
    locoId:
      execution.configuredLoco?.id ??
      null,
    locoAddress:
      execution.locoAddress,
    locoName:
      execution.configuredLoco?.name ??
      null,
    trainType:
      execution.configuredLoco?.trainType ??
      null,
    direction:
      execution.direction,
    event,
    resourceType:
      resource.kind,
    resourceKey:
      resource.key,
    resourceId:
      resource.blockId ??
      resource.key,
    resourceName:
      resource.name,
    resourceLabel:
      resource.label,
    sensorAddress:
      resource.sensorAddress,
    sensors,
  });
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

    emitMovementTrainEvent(
      execution,
      "leave",
      state.resource
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

  emitMovementTrainEvent(
    execution,
    "leave",
    resource
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

function runtimeText(
  key: string,
  values?:
    Record<string, unknown>
): string {
  return values ===
    undefined
    ? i18next.t(
        `ui.${key}`
      )
    : i18next.t(
        `ui.${key}`,
        values
      );
}

function actionStatusText(
  action:
    MovementAction
): string {
  switch (
    action.kind
  ) {
    case "speed":
      return runtimeText(
        "movementRuntimeSetSpeed",
        {
          speed:
            action.speed,
        }
      );

    case "function":
      return runtimeText(
        "movementRuntimeFunction",
        {
          fn:
            action.functionNumber,
          state:
            action.functionActive
              ? runtimeText("movementOn")
              : runtimeText("movementOff"),
        }
      );

    case "horn":
      return runtimeText(
        "movementRuntimeFunctionPulse",
        {
          fn:
            action.functionNumber,
          ms:
            action.pulseMs,
        }
      );

    case "delay":
      return runtimeText(
        "movementRuntimeDelay",
        {
          ms:
            action.delayMs,
        }
      );

    case "randomDelay":
      return runtimeText(
        "movementRuntimeRandomDelay",
        {
          min:
            Math.min(
              action.minDelayMs,
              action.maxDelayMs
            ),
          max:
            Math.max(
              action.minDelayMs,
              action.maxDelayMs
            ),
        }
      );

    case "playAudio":
      return runtimeText(
        "movementRuntimePlayAudio",
        {
          name:
            action.audioName ||
            runtimeText("movementRuntimeNoAudio"),
        }
      );

    case "randomPlay":
      return runtimeText(
        "movementRuntimeRandomPlay",
        {
          chance:
            action.randomPlayChancePercent,
          name:
            action.audioName ||
            runtimeText("movementRuntimeNoAudio"),
        }
      );

    case "setAccessory":
      return runtimeText(
        "movementRuntimeBasicAccessory",
        {
          address:
            action.accessoryAddress,
          state:
            action.accessoryActive
              ? runtimeText("movementOn")
              : runtimeText("movementOff"),
        }
      );

    case "setExtendedAccessory":
      return runtimeText(
        "movementRuntimeExtendedAccessory",
        {
          address:
            action.accessoryAddress,
          aspect:
            action.accessoryAspect,
        }
      );

    case "log":
      return action.message
        ? runtimeText(
            "movementRuntimeLog",
            {
              message:
                action.message,
            }
          )
        : runtimeText(
            "movementActionLog"
          );
  }
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
    MovementExecution,
  force =
    false
): void {
  setPhysicalSpeed(
    execution,
    execution.moving &&
    !execution.cancelled
      ? execution.desiredSpeed
      : 0,
    force
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

function movementFunctionNumber(
  execution:
    MovementExecution,
  action:
    MovementAction
): number {
  if (
    action.functionBindingId ===
      null
  ) {
    return action.functionNumber;
  }

  const functionNumber =
    execution
      .functionNumbersByBindingId
      .get(
        action.functionBindingId
      );

  if (
    functionNumber ===
      undefined
  ) {
    throw new Error(
      `Movement locomotive ${execution.locoAddress} has no function binding #${action.functionBindingId}.`
    );
  }

  return functionNumber;
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

    case "function": {
      const functionNumber =
        movementFunctionNumber(
          execution,
          action
        );

      if (
        !wsApi.setLocoFunction(
          execution.locoAddress,
          functionNumber,
          action.functionActive
        )
      ) {
        throw new Error(
          "Movement could not send locomotive function."
        );
      }

      return;
    }

    case "horn": {
      const functionNumber =
        movementFunctionNumber(
          execution,
          action
        );

      if (
        !wsApi.setLocoFunction(
          execution.locoAddress,
          functionNumber,
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
          functionNumber,
          false
        );
      }

      return;
    }

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

    case "randomPlay": {
      const roll =
        Math.floor(
          Math.random() *
          10
        ) +
        1;

      const threshold =
        Math.max(
          1,
          Math.min(
            9,
            Math.round(
              action.randomPlayChancePercent /
              10
            )
          )
        );

      if (
        roll >
        threshold
      ) {
        setInfo(
          execution,
          runtimeText(
            "movementRuntimeRandomPlaySkipped",
            {
              roll,
              threshold,
            }
          ),
          action.resourceKey
        );

        return;
      }

      setInfo(
        execution,
        runtimeText(
          "movementRuntimeRandomPlayPlaying",
          {
            roll,
            threshold,
          }
        ),
        action.resourceKey
      );

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
            `Movement random audio playback failed: ${source}`
          );
        }
      } else if (
        !broadcastAudioPlaybackNoWait(
          source
        )
      ) {
        throw new Error(
          `Movement random audio broadcast failed: ${source}`
        );
      }

      return;
    }

    case "setAccessory":
      if (
        !wsApi.setBasicAccessory(
          action.accessoryAddress,
          action.accessoryActive
        )
      ) {
        throw new Error(
          "Movement could not set Basic Accessory."
        );
      }

      return;

    case "setExtendedAccessory":
      if (
        !wsApi.setSignalAspect(
          action.accessoryAddress,
          action.accessoryAspect
        )
      ) {
        throw new Error(
          "Movement could not set Extended Accessory."
        );
      }

      return;

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
        const actionInfo =
          actionStatusText(
            action
          );

        setMovementExecuting(
          execution,
          actionInfo
        );

        setInfo(
          execution,
          actionInfo,
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
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg
): boolean {
  return movementLegEffectivePathSafetySensors(
    execution.page,
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
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg
): string {
  return movementLegEffectivePathSafetySensors(
    execution.page,
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
    [
      leg.from,
      ...leg.resources,
      leg.to,
    ]
  ) {
    for (
      const segmentName of
      resource.physicalSegmentNames
    ) {
      names.add(
        `dcc-express-movement-segment:${segmentName}`
      );
    }
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

  let releasePromise:
    Promise<void> |
    null =
      null;

  const release =
    async (): Promise<void> => {
      if (
        released
      ) {
        return;
      }

      if (
        releasePromise
      ) {
        return await releasePromise;
      }

      releasePromise =
        (async () => {
          try {
            /*
             * Release is owner-safe and idempotent on both backends.
             *
             * Do not mark the lease released before the backend ACK. If the
             * request times out or the WebSocket response is lost, the caller
             * must be allowed to retry the same owner/address release. A
             * second release after a successfully processed first request is
             * harmless (released=0) and closes the stale-lock race.
             */
            await switchManRequest(
              "release",
              {
                ownerId,
                ownerName,
                addresses,
              },
              5000
            );

            released =
              true;
          } finally {
            releasePromise =
              null;
          }
        })();

      return await releasePromise;
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
        runtimeText(
          "movementRuntimeSettingTurnout",
          {
            address:
              requirement.address,
            state:
              requirement.closed
                ? runtimeText("movementRuntimeTurnoutClosed")
                : runtimeText("movementRuntimeTurnoutThrown"),
          }
        ),
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
      null,
  checkOccupancySensor =
    true
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
    checkOccupancySensor &&
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


function targetBlockAvailableForLeg(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg,
  ownMarker:
    string | null =
      null
): boolean {
  const targetSensor =
    leg.to.sensorAddress;

  const checkOccupancySensor =
    targetSensor ===
      null ||
    movementLegSensorIsChecked(
      execution.page,
      leg,
      targetSensor
    );

  return blockAvailableForTarget(
    leg.to,
    ownMarker,
    checkOccupancySensor
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
    runtimeText(
      "movementRuntimeReserveTarget",
      {
        block:
          leg.to.name,
        loco:
          execution.locoAddress,
      }
    ),
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
        !targetBlockAvailableForLeg(
          execution,
          leg
        )
      ) {
        reason =
          runtimeText(
          "movementRuntimeWaitTargetBlock",
          {
            block:
              leg.to.name,
          }
        );

        waitingReason =
          "targetBlock";
      } else if (
        !aheadPathSensorsAreFree(
          execution,
          leg
        )
      ) {
        reason =
          runtimeText(
          "movementRuntimeWaitSafety",
          {
            sensors:
              blockedPathSafetySensorSummary(
                execution,
                leg
              ),
          }
        );

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
        !targetBlockAvailableForLeg(
          execution,
          leg
        )
      ) {
        reason =
          `Waiting for block ${leg.to.name}`;

        waitingReason =
          "targetBlock";
      } else if (
        !aheadPathSensorsAreFree(
          execution,
          leg
        )
      ) {
        reason =
          `Waiting for safety: ${blockedPathSafetySensorSummary(
            execution,
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
        !targetBlockAvailableForLeg(
          execution,
          leg
        ) ||
        !aheadPathSensorsAreFree(
          execution,
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
        targetBlockAvailableForLeg(
          execution,
          leg
        ) &&
        aheadPathSensorsAreFree(
          execution,
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

function prepareIntermediateArrivalCruise(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg
): void {
  if (
    movementIsHeld(
      execution
    )
  ) {
    console.info(
      "[Movement] ARRIVED handover held",
      {
        page:
          execution.page.name,
        locoAddress:
          execution.locoAddress,
        block:
          leg.to.name,
      }
    );

    return;
  }

  execution.desiredSpeed =
    execution.page.speed;

  updateState(
    execution,
    {
      desiredSpeed:
        execution.desiredSpeed,
    }
  );

  /*
   * Do NOT make a second, one-shot authority decision here.
   *
   * ARRIVED is only the boundary between two legs. The next traverseLeg()
   * owns the authoritative departure checks:
   *   - DEPART condition
   *   - target block
   *   - effective safety sensors
   *   - Movement resource locks
   *   - SwitchMan turnout authority / setting
   *
   * Previously this ARRIVED hook sampled target/safety state once and could
   * force STOP from a transient WebSocket/cache state. That converted a
   * rolling handover into a stopped restart, which could then self-block on
   * sensors occupied by the same train.
   *
   * Preserve the current physical motion here. If the next leg is genuinely
   * blocked, its normal clearance path will issue STOP and wait.
   */
  console.info(
    "[Movement] ARRIVED handover deferred to next leg clearance",
    {
      page:
        execution.page.name,
      locoAddress:
        execution.locoAddress,
      block:
        leg.to.name,
      cruiseSpeed:
        execution.desiredSpeed,
      moving:
        execution.moving,
    }
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
          runtimeText(
          "movementRuntimeWaitDeparture",
          {
            block:
              leg.from.name,
          }
        )
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

  emitMovementTrainEvent(
    execution,
    "arrival",
    leg.to
  );

  await runActions(
    execution,
    leg.to.key,
    "approach"
  );

  setInfo(
    execution,
    runtimeText(
      "movementRuntimeApproachingBlock",
      {
        block:
          leg.to.name,
      }
    ),
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

  emitMovementTrainEvent(
    execution,
    "leave",
    leg.from
  );

  await runActions(
    execution,
    leg.from.key,
    "leave"
  );

  setInfo(
    execution,
    runtimeText(
      "movementRuntimeLeftBlock",
      {
        block:
          leg.from.name,
      }
    ),
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
    runtimeText(
    "movementRuntimeWaitLeave",
    {
      block:
        leg.from.name,
    }
  ),
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

  /*
   * Compatibility only: legacy Movement "leave" actions still run when no
   * physical Leave sensor group exists. Do not emit a TrainEvent Leave here:
   * the new lifecycle defines Leave strictly as Leave sensors ON.
   */
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
    string | null,
  requirePathSensorsFree:
    boolean
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
        !targetBlockAvailableForLeg(
          execution,
          leg,
          targetMarker
        )
      ) {
        reason =
          `Waiting for block ${leg.to.name}`;

        waitingReason =
          "targetBlock";
      } else if (
        requirePathSensorsFree &&
        !aheadPathSensorsAreFree(
          execution,
          leg
        )
      ) {
        reason =
          `Waiting for safety: ${blockedPathSafetySensorSummary(
            execution,
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
    runtimeText(
    "movementRuntimeWaitArrival",
    {
      block:
        leg.to.name,
    }
  ),
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
    runtimeText(
    "movementRuntimeWaitResource",
    {
      resource:
        resource.name,
    }
  ),
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

async function waitForAfterLeave(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg
): Promise<void> {
  if (
    leg.afterLeaveWhen.length ===
      0
  ) {
    return;
  }

  while (
    !execution.cancelled
  ) {
    if (
      conditionsSatisfied(
        leg.afterLeaveWhen
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

async function finishSourceBlockRelease(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg,
  blockLeaveState:
    BlockLeaveState,
  pendingTurnouts:
    MovementPlanResource[]
): Promise<void> {
  await maybeRunBlockLeave(
    execution,
    leg,
    blockLeaveState
  );

  await waitForBlockLeave(
    execution,
    leg,
    blockLeaveState
  );

  await waitForAfterLeave(
    execution,
    leg
  );

  for (
    const turnout of
    pendingTurnouts
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

  emitMovementTrainEvent(
    execution,
    "afterLeave",
    leg.from
  );

  await runActions(
    execution,
    leg.from.key,
    "afterLeave"
  );
}

function startBackgroundSourceBlockRelease(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg,
  blockLeaveState:
    BlockLeaveState,
  pendingTurnouts:
    MovementPlanResource[]
): void {
  let task:
    Promise<void>;

  task =
    finishSourceBlockRelease(
      execution,
      leg,
      blockLeaveState,
      pendingTurnouts
    )
      .catch(
        error => {
          if (
            execution.cancelled
          ) {
            return;
          }

          console.error(
            "[Movement] Background source block release failed",
            execution.page.name,
            leg.from.name,
            error
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

function movementIsHeld(
  execution:
    MovementExecution
): boolean {
  return execution.externalHolds.size > 0;
}

async function waitUntilLocoStopped(
  execution:
    MovementExecution,
  timeoutMs = 5000
): Promise<boolean> {
  const deadline =
    Date.now() +
    timeoutMs;

  while (
    !execution.cancelled &&
    Date.now() <
      deadline
  ) {
    const live =
      wsClient.getLatestLocoState(
        execution.locoAddress
      );

    if (
      live?.speed ===
        0
    ) {
      return true;
    }

    await controlledDelay(
      execution,
      50
    );
  }

  return false;
}

async function emitAfterArrivedIfStopped(
  execution:
    MovementExecution,
  block:
    MovementPlanResource
): Promise<void> {
  if (
    block.blockId ===
      null ||
    execution.afterArrivedBlocks.has(
      block.blockId
    ) ||
    execution.moving
  ) {
    return;
  }

  if (
    !await waitUntilLocoStopped(
      execution
    )
  ) {
    return;
  }

  execution.afterArrivedBlocks.add(
    block.blockId
  );

  emitMovementTrainEvent(
    execution,
    "afterArrived",
    block
  );
}

async function waitForExternalHolds(
  execution:
    MovementExecution,
  leg:
    MovementPlanLeg
): Promise<void> {
  if (!movementIsHeld(execution)) {
    return;
  }

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
    execution,
    true
  );

  await emitAfterArrivedIfStopped(
    execution,
    leg.from
  );

  while (
    !execution.cancelled &&
    movementIsHeld(
      execution
    )
  ) {
    setInfo(
      execution,
      `Movement held at ${leg.from.name}`,
      leg.from.key
    );

    await controlledDelay(
      execution,
      100
    );
  }

  if (execution.cancelled) {
    throw new Error(
      "Movement cancelled."
    );
  }

  execution.desiredSpeed =
    execution.page.speed;

  updateState(
    execution,
    {
      desiredSpeed:
        execution.desiredSpeed,
    }
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

  await waitForExternalHolds(
    execution,
    leg
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

  emitMovementTrainEvent(
    execution,
    "beforeLeave",
    leg.from
  );

  await runActions(
    execution,
    leg.from.key,
    "beforeDepart"
  );

  const wasAlreadyMoving =
    execution.moving;

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
     *
     * For a rolling block-to-block transition, do NOT require the entire path
     * to remain FREE here. Clearance was acquired while it was free and the
     * train may already have occupied the first detector of this leg itself.
     * Rechecking that detector as "safety" would make the train block on its
     * own occupancy (for example #1005 before destination block sensor #1007).
     * A train that was stopped still gets the full path-sensor recheck.
     */
    await waitForHeldLegReady(
      execution,
      leg,
      leases.target?.marker ??
      null,
      !wasAlreadyMoving
    );

    let previousSegment:
      MovementPlanResource |
      null =
      execution.plan.resources
        .filter(
          resource =>
            resource.kind ===
              "segment" &&
            resource.routeOrder <
              leg.from.routeOrder &&
            resource.nodeIndex ===
              leg.from.nodeIndex
        )
        .sort(
          (
            left,
            right
          ) =>
            right.routeOrder -
            left.routeOrder
        )[0] ??
      null;

    /*
     * The source block may already sit on a SectionPart when Movement starts.
     * Arm that part's LEAVE rule before the locomotive moves so an explicit
     * sensor edge cannot be missed. ENTER is intentionally not replayed: the
     * train is already inside this resource at startup.
     */
    if (
      leg.index ===
        0 &&
      previousSegment
    ) {
      armResourceLeave(
        execution,
        previousSegment
      );
    }

    /*
     * STARTING is emitted only at the real motion boundary: all held
     * authority has been revalidated and the next operation is the non-zero
     * locomotive speed command.
     */
    emitMovementTrainEvent(
      execution,
      "starting",
      leg.from
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
      emitMovementTrainEvent(
        execution,
        "approach",
        leg.to
      );

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

        emitMovementTrainEvent(
          execution,
          "enter",
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

      emitMovementTrainEvent(
        execution,
        "enter",
        resource
      );

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
        emitMovementTrainEvent(
          execution,
          "arrival",
          leg.to
        );

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

    emitMovementTrainEvent(
      execution,
      "arrived",
      leg.to
    );

    /*
     * Flow TrainEvent branches execute in a Worker. Yield briefly while the
     * train keeps its current speed so an Arrived -> movement.hold() branch
     * can register its hold before the next leg starts acquiring authority.
     */
    await controlledDelay(
      execution,
      50
    );

    if (
      movementIsHeld(
        execution
      )
    ) {
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
        execution,
        true
      );
    }

    /*
     * ARRIVED is the leg authority handoff boundary for turnouts.
     *
     * The previous leg's turnout route is no longer needed once the train has
     * reached the configured destination-block ARRIVED sensor. Release those
     * turnout locks now instead of keeping them until traverseLeg() finally
     * exits. This lets the following leg acquire/set its own turnout route as
     * soon as the block transition completes.
     */
    if (leases.turnouts) {
      const releasedAddresses = [
        ...leases.turnouts.addresses,
      ];

      await leases.turnouts.release();

      leases.turnouts =
        null;

      console.info(
        "[Movement] ARRIVED released previous turnout authority",
        {
          page:
            execution.page.name,
          block:
            leg.to.name,
          addresses:
            releasedAddresses,
        }
      );
    }

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

      await emitAfterArrivedIfStopped(
        execution,
        leg.to
      );
    }

    const sourceReleaseTurnouts =
      pendingTurnouts.splice(
        0
      );

    /*
     * A final leg may wait for the previous block to be physically left.
     * On intermediate legs ARRIVED is the authority handoff boundary: the
     * previous block remains protected by its occupancy/LEAVE sensor in a
     * background watcher, while the next leg is allowed to acquire and set
     * its route immediately.
     */
    if (
      isFinalLeg
    ) {
      await finishSourceBlockRelease(
        execution,
        leg,
        blockLeaveState,
        sourceReleaseTurnouts
      );
    }

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
      !isFinalLeg
    ) {
      startBackgroundSourceBlockRelease(
        execution,
        leg,
        blockLeaveState,
        sourceReleaseTurnouts
      );
    }

    if (
      !finalArrivedActionsRan
    ) {
      /*
       * ARRIVED restores the logical cruise target but deliberately does not
       * decide STOP/GO from a one-shot snapshot. The next leg performs the
       * single authoritative clearance sequence. ARRIVED actions may still
       * replace desiredSpeed before that next leg starts.
       */
      prepareIntermediateArrivalCruise(
        execution,
        leg
      );

      await runActions(
        execution,
        leg.to.key,
        "arrived"
      );

      await emitAfterArrivedIfStopped(
        execution,
        leg.to
      );
    }

    setInfo(
      execution,
      runtimeText(
      "movementRuntimeArrived",
      {
        block:
          leg.to.name,
      }
    ),
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

export function holdMovement(
  pageId: string,
  ownerId = "external"
): boolean {
  const execution =
    executions.get(
      pageId
    );

  if (!execution) {
    return false;
  }

  execution.externalHolds.add(
    ownerId
  );

  /*
   * A hold never grants authority; it can only remove motion authority.
   * Safety, target-block and turnout checks remain inside traverseLeg().
   */
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
    execution,
    true
  );

  return true;
}

export function releaseMovement(
  pageId: string,
  ownerId = "external"
): boolean {
  const execution =
    executions.get(
      pageId
    );

  if (!execution) {
    return false;
  }

  execution.externalHolds.delete(
    ownerId
  );

  /*
   * Deliberately do not send a non-zero speed command here. The Movement loop
   * resumes only after its normal safety/target/turnout authority checks.
   */
  return true;
}

export function isLocoManagedByActiveMovement(
  locoAddress: number
): boolean {
  return [
    ...executions.values(),
  ].some(
    execution =>
      !execution.cancelled &&
      execution.locoAddress ===
        locoAddress
  );
}

export function getMovementHoldOwners(
  pageId: string
): string[] {
  return [
    ...(
      executions.get(
        pageId
      )?.externalHolds ??
      []
    ),
  ];
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

  console.info(
    "[Movement] resolved plan",
    {
      page:
        page.name,
      direction:
        plan.direction,
      resources:
        plan.resources.map(
          resource => ({
            order:
              resource.routeOrder,
            kind:
              resource.kind,
            name:
              resource.name,
            sensors:
              [
                ...resource.detectors,
              ],
            blockSensor:
              resource.sensorAddress,
            turnouts:
              resource.turnoutStates.map(
                state => ({
                  ...state,
                })
              ),
          })
        ),
      legs:
        plan.legs.map(
          leg => ({
            from:
              leg.from.name,
            to:
              leg.to.name,
            resources:
              leg.resources.map(
                resource =>
                  resource.name
              ),
            turnoutStates:
              leg.turnoutStates.map(
                state => ({
                  ...state,
                })
              ),
          })
        ),
    }
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

  const configuredLocos =
    await getLocos();

  const configuredLoco =
    configuredLocos.find(
      loco =>
        loco.address ===
        locoAddress
    ) ??
    null;

  const functionNumbersByBindingId =
    new Map<number, number>();

  for (
    const fn of
    configuredLoco?.functions ??
    []
  ) {
    if (
      fn.bindingId ===
        undefined ||
      fn.bindingId ===
        null ||
      functionNumbersByBindingId.has(
        fn.bindingId
      )
    ) {
      continue;
    }

    functionNumbersByBindingId.set(
      fn.bindingId,
      fn.number
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
      safetyRules:
        page.safetyRules.map(
          rule => ({
            ...rule,
            ignoredSensors: [
              ...rule.ignoredSensors,
            ],
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
    configuredLoco,
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
    externalHolds:
      new Set(),
    afterArrivedBlocks:
      new Set(),
    functionNumbersByBindingId,
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
