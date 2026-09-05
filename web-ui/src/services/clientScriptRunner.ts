import {
  wsApi,
} from "./wsApi";

export type ClientScriptElementContext = {
  id: number;
  name: string;
  type: string;
};

export type ClientScriptStatus =
  | "idle"
  | "running"
  | "paused";

export type ClientScriptState = {
  status: ClientScriptStatus;
  startedAt: number | null;
  error: string | null;
};

type ScriptDirection =
  | "forward"
  | "reverse";

type AsyncFunctionFactory =
  new (
    ...args: string[]
  ) => (
    ...values: unknown[]
  ) => Promise<unknown>;

type ExecutionControl = {
  element: ClientScriptElementContext;
  status: "running" | "paused";
  startedAt: number;
  aborted: boolean;
  abortReason: string | null;
  pauseWaiters: Set<() => void>;
  abortWaiters: Set<(error: ScriptAbortError) => void>;
};

type StateListener =
  (state: ClientScriptState) => void;

const AsyncFunction =
  Object.getPrototypeOf(
    async function () {}
  ).constructor as AsyncFunctionFactory;

const executions =
  new Map<number, ExecutionControl>();

const listeners =
  new Map<number, Set<StateListener>>();

const lastErrors =
  new Map<number, string | null>();

export class ScriptAbortError extends Error {
  constructor(
    message = "Script aborted."
  ) {
    super(message);
    this.name = "ScriptAbortError";
  }
}

function stateFor(
  elementId: number
): ClientScriptState {
  const execution =
    executions.get(elementId);

  if (!execution) {
    return {
      status: "idle",
      startedAt: null,
      error:
        lastErrors.get(elementId) ??
        null,
    };
  }

  return {
    status:
      execution.status,
    startedAt:
      execution.startedAt,
    error: null,
  };
}

function emitState(
  elementId: number
): void {
  const state =
    stateFor(elementId);

  for (
    const listener of
    listeners.get(elementId) ?? []
  ) {
    listener(state);
  }
}

export function getClientScriptState(
  elementId: number
): ClientScriptState {
  return stateFor(elementId);
}

export function subscribeClientScriptState(
  elementId: number,
  listener: StateListener
): () => void {
  let set =
    listeners.get(elementId);

  if (!set) {
    set =
      new Set<StateListener>();

    listeners.set(
      elementId,
      set
    );
  }

  set.add(listener);
  listener(
    stateFor(elementId)
  );

  return () => {
    const current =
      listeners.get(elementId);

    if (!current) return;

    current.delete(listener);

    if (
      current.size === 0
    ) {
      listeners.delete(
        elementId
      );
    }
  };
}

function abortError(
  execution: ExecutionControl
): ScriptAbortError {
  return new ScriptAbortError(
    execution.abortReason ??
      "Script aborted."
  );
}

function assertNotAborted(
  execution: ExecutionControl
): void {
  if (execution.aborted) {
    throw abortError(
      execution
    );
  }
}

async function waitUntilResumed(
  execution: ExecutionControl
): Promise<void> {
  assertNotAborted(
    execution
  );

  if (
    execution.status !==
    "paused"
  ) {
    return;
  }

  await new Promise<void>(
    (resolve, reject) => {
      const onResume = () => {
        execution.pauseWaiters.delete(
          onResume
        );

        execution.abortWaiters.delete(
          onAbort
        );

        resolve();
      };

      const onAbort = (
        error: ScriptAbortError
      ) => {
        execution.pauseWaiters.delete(
          onResume
        );

        execution.abortWaiters.delete(
          onAbort
        );

        reject(error);
      };

      execution.pauseWaiters.add(
        onResume
      );

      execution.abortWaiters.add(
        onAbort
      );
    }
  );

  assertNotAborted(
    execution
  );
}

async function controlledDelay(
  execution: ExecutionControl,
  ms: number
): Promise<void> {
  assertNotAborted(
    execution
  );

  await waitUntilResumed(
    execution
  );

  const safeMs =
    Math.max(
      0,
      Math.min(
        600000,
        Number(ms) || 0
      )
    );

  const started =
    performance.now();

  let remaining =
    safeMs;

  while (
    remaining > 0
  ) {
    assertNotAborted(
      execution
    );

    await waitUntilResumed(
      execution
    );

    const slice =
      Math.min(
        remaining,
        100
      );

    await new Promise<void>(
      (resolve, reject) => {
        const timer =
          window.setTimeout(
            () => {
              execution.abortWaiters.delete(
                onAbort
              );
              resolve();
            },
            slice
          );

        const onAbort = (
          error: ScriptAbortError
        ) => {
          window.clearTimeout(
            timer
          );

          execution.abortWaiters.delete(
            onAbort
          );

          reject(error);
        };

        execution.abortWaiters.add(
          onAbort
        );
      }
    );

    if (
      execution.status ===
      "running"
    ) {
      remaining -=
        slice;
    }
  }

  void started;
  assertNotAborted(
    execution
  );
}

function requireSend(
  execution: ExecutionControl,
  ok: boolean,
  label: string
): void {
  assertNotAborted(
    execution
  );

  if (!ok) {
    throw new Error(
      `${label}: WebSocket command could not be sent.`
    );
  }
}

function integer(
  value: number,
  min: number,
  max: number,
  name: string
): number {
  if (
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(
      `${name} must be an integer between ${min} and ${max}.`
    );
  }

  return value;
}

function createDccApi(
  execution: ExecutionControl
) {
  const check = () => {
    assertNotAborted(
      execution
    );
  };

  return Object.freeze({
    power(on: boolean): void {
      check();
      requireSend(
        execution,
        wsApi.setTrackPower(
          Boolean(on)
        ),
        "dcc.power"
      );
    },

    programmingPower(on: boolean): void {
      check();
      requireSend(
        execution,
        wsApi.setProgrammingPower(
          Boolean(on)
        ),
        "dcc.programmingPower"
      );
    },

    emergencyStop(): void {
      check();
      requireSend(
        execution,
        wsApi.emergencyStop(),
        "dcc.emergencyStop"
      );
    },

    loco(
      address: number,
      speed: number,
      direction: ScriptDirection = "forward"
    ): void {
      check();

      const locoAddress =
        integer(
          address,
          1,
          10239,
          "Locomotive address"
        );

      const locoSpeed =
        integer(
          speed,
          0,
          126,
          "Locomotive speed"
        );

      if (
        direction !== "forward" &&
        direction !== "reverse"
      ) {
        throw new Error(
          'Direction must be "forward" or "reverse".'
        );
      }

      requireSend(
        execution,
        wsApi.setLoco(
          locoAddress,
          locoSpeed,
          direction
        ),
        "dcc.loco"
      );
    },

    locoFunction(
      address: number,
      functionNumber: number,
      active: boolean
    ): void {
      check();
      requireSend(
        execution,
        wsApi.setLocoFunction(
          integer(
            address,
            1,
            10239,
            "Locomotive address"
          ),
          integer(
            functionNumber,
            0,
            28,
            "Function number"
          ),
          Boolean(active)
        ),
        "dcc.locoFunction"
      );
    },

    turnout(
      address: number,
      closed: boolean
    ): void {
      check();
      requireSend(
        execution,
        wsApi.setTurnout(
          integer(
            address,
            1,
            2048,
            "Turnout address"
          ),
          Boolean(closed)
        ),
        "dcc.turnout"
      );
    },

    sensor(
      address: number,
      on: boolean
    ): void {
      check();
      requireSend(
        execution,
        wsApi.setSensor(
          integer(
            address,
            1,
            65535,
            "Sensor address"
          ),
          Boolean(on)
        ),
        "dcc.sensor"
      );
    },

    accessory(
      address: number,
      active: boolean
    ): void {
      check();
      requireSend(
        execution,
        wsApi.setBasicAccessory(
          integer(
            address,
            1,
            2048,
            "Accessory address"
          ),
          Boolean(active)
        ),
        "dcc.accessory"
      );
    },

    signal(
      address: number,
      aspect: number
    ): void {
      check();
      requireSend(
        execution,
        wsApi.setSignalAspect(
          integer(
            address,
            1,
            2048,
            "Signal address"
          ),
          integer(
            aspect,
            0,
            255,
            "Signal aspect"
          )
        ),
        "dcc.signal"
      );
    },

    block(
      blockId: string | number,
      locoId: string | null,
      locoAddress?: number
    ): void {
      check();

      requireSend(
        execution,
        wsApi.setBlock(
          String(blockId),
          locoId,
          locoAddress === undefined
            ? undefined
            : integer(
                locoAddress,
                1,
                10239,
                "Locomotive address"
              )
        ),
        "dcc.block"
      );
    },

    clearBlock(
      blockId: string | number,
      locoId: string | null = null
    ): void {
      check();
      requireSend(
        execution,
        wsApi.setBlockRemove(
          String(blockId),
          locoId
        ),
        "dcc.clearBlock"
      );
    },

    resetBlocks(): void {
      check();
      requireSend(
        execution,
        wsApi.setBlocksReset(),
        "dcc.resetBlocks"
      );
    },

    raw(command: string): void {
      check();

      const value =
        String(command).trim();

      if (!value) {
        throw new Error(
          "dcc.raw requires a DCC-EX command."
        );
      }

      requireSend(
        execution,
        wsApi.writeDccExDirectCommand(
          value
        ),
        "dcc.raw"
      );
    },
  });
}

export function pauseClientScript(
  elementId: number
): boolean {
  const execution =
    executions.get(elementId);

  if (
    !execution ||
    execution.aborted ||
    execution.status === "paused"
  ) {
    return false;
  }

  execution.status =
    "paused";

  emitState(
    elementId
  );

  return true;
}

export function resumeClientScript(
  elementId: number
): boolean {
  const execution =
    executions.get(elementId);

  if (
    !execution ||
    execution.aborted ||
    execution.status !== "paused"
  ) {
    return false;
  }

  execution.status =
    "running";

  const waiters =
    [
      ...execution.pauseWaiters,
    ];

  execution.pauseWaiters.clear();

  for (
    const resolve of
    waiters
  ) {
    resolve();
  }

  emitState(
    elementId
  );

  return true;
}

export function abortClientScript(
  elementId: number,
  reason =
    "Script aborted by user."
): boolean {
  const execution =
    executions.get(elementId);

  if (
    !execution ||
    execution.aborted
  ) {
    return false;
  }

  execution.aborted =
    true;

  execution.abortReason =
    reason;

  const error =
    abortError(execution);

  const abortWaiters =
    [
      ...execution.abortWaiters,
    ];

  execution.abortWaiters.clear();

  for (
    const reject of
    abortWaiters
  ) {
    reject(error);
  }

  const pauseWaiters =
    [
      ...execution.pauseWaiters,
    ];

  execution.pauseWaiters.clear();

  for (
    const resolve of
    pauseWaiters
  ) {
    resolve();
  }

  emitState(
    elementId
  );

  return true;
}

export async function runClientScript(
  script: string,
  element: ClientScriptElementContext
): Promise<unknown> {
  if (!script.trim()) {
    return undefined;
  }

  if (
    executions.has(
      element.id
    )
  ) {
    throw new Error(
      `Script "${element.name || element.id}" is already running.`
    );
  }

  const execution:
    ExecutionControl = {
      element: {
        ...element,
      },
      status: "running",
      startedAt: Date.now(),
      aborted: false,
      abortReason: null,
      pauseWaiters:
        new Set(),
      abortWaiters:
        new Set(),
    };

  executions.set(
    element.id,
    execution
  );

  lastErrors.set(
    element.id,
    null
  );

  emitState(
    element.id
  );

  const dcc =
    createDccApi(
      execution
    );

  const delay = (
    ms: number
  ): Promise<void> =>
    controlledDelay(
      execution,
      ms
    );

  const log = (
    ...values: unknown[]
  ): void => {
    assertNotAborted(
      execution
    );

    console.log(
      `[ScriptButton ${element.name || element.id}]`,
      ...values
    );
  };

  const safeElement =
    Object.freeze({
      ...element,
    });

  try {
    const fn =
      new AsyncFunction(
        "dcc",
        "delay",
        "log",
        "element",
        `"use strict";
${script}
//# sourceURL=dcc-express-script-button-${element.id}.js`
      );

    const result =
      await fn(
        dcc,
        delay,
        log,
        safeElement
      );

    assertNotAborted(
      execution
    );

    return result;
  } catch (error) {
    if (
      error instanceof
      ScriptAbortError
    ) {
      lastErrors.set(
        element.id,
        null
      );

      throw error;
    }

    lastErrors.set(
      element.id,
      error instanceof Error
        ? error.message
        : String(error)
    );

    throw error;
  } finally {
    executions.delete(
      element.id
    );

    emitState(
      element.id
    );
  }
}
