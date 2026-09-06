/// <reference lib="webworker" />

import type {
  ClientScriptWorkerDccMethod,
  ClientScriptWorkerElement,
  ClientScriptWorkerExecutionId,
  MainToWorkerMessage,
  WorkerToMainMessage,
} from "./clientScriptWorkerProtocol";

type ScriptDirection =
  | "forward"
  | "reverse";

type AsyncFunctionFactory =
  new (
    ...args: string[]
  ) => (
    ...values: unknown[]
  ) => Promise<unknown>;

type WorkerExecution = {
  element: ClientScriptWorkerElement;
  status: "running" | "paused";
  aborted: boolean;
  abortReason: string | null;
  pauseWaiters: Set<() => void>;
  abortWaiters: Set<(error: WorkerScriptAbortError) => void>;
};

const workerScope =
  self as unknown as DedicatedWorkerGlobalScope;

const AsyncFunction =
  Object.getPrototypeOf(
    async function () {}
  ).constructor as AsyncFunctionFactory;

const executions =
  new Map<ClientScriptWorkerExecutionId, WorkerExecution>();

const blockAddresses =
  new Map<string, number>();

const blockTargetAddresses =
  new Map<string, number>();

const blockNamesExact =
  new Map<string, string>();

const blockNamesFolded =
  new Map<string, string | null>();

let blockCatalogReady =
  false;

let blockSnapshotReady =
  false;

let blockTargetSnapshotReady =
  false;

class WorkerScriptAbortError extends Error {
  constructor(
    message = "Script aborted."
  ) {
    super(message);
    this.name = "ScriptAbortError";
  }
}

function post(
  message: WorkerToMainMessage
): void {
  workerScope.postMessage(
    message
  );
}

function executionFor(
  executionId: ClientScriptWorkerExecutionId
): WorkerExecution | null {
  return (
    executions.get(
      executionId
    ) ?? null
  );
}

function abortError(
  execution: WorkerExecution
): WorkerScriptAbortError {
  return new WorkerScriptAbortError(
    execution.abortReason ??
      "Script aborted."
  );
}

function assertNotAborted(
  execution: WorkerExecution
): void {
  if (
    execution.aborted
  ) {
    throw abortError(
      execution
    );
  }
}

async function waitUntilResumed(
  execution: WorkerExecution
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
        error: WorkerScriptAbortError
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
  execution: WorkerExecution,
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
        250
      );

    const startedAt =
      performance.now();

    await new Promise<void>(
      (resolve, reject) => {
        const timer =
          workerScope.setTimeout(
            () => {
              execution.abortWaiters.delete(
                onAbort
              );

              resolve();
            },
            slice
          );

        const onAbort = (
          error: WorkerScriptAbortError
        ) => {
          workerScope.clearTimeout(
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
      // Use real elapsed time instead of blindly subtracting the requested
      // timer slice. If the browser wakes the Worker late after a background
      // throttle, a 5-second delay does not turn into many minutes of drift.
      const elapsed =
        Math.max(
          0,
          performance.now() -
            startedAt
        );

      remaining -=
        Math.max(
          slice,
          elapsed
        );
    }
  }

  assertNotAborted(
    execution
  );
}


function resolveBlockId(
  value: string | number
): string {
  const text =
    String(value).trim();

  if (!text) {
    throw new Error(
      "Block name or ID is required."
    );
  }

  if (/^\d+$/.test(text)) {
    const id =
      Number(text);

    if (
      !Number.isInteger(id) ||
      id < 1 ||
      id > 65535
    ) {
      throw new Error(
        "Block ID must be an integer between 1 and 65535."
      );
    }

    return String(id);
  }

  if (!blockCatalogReady) {
    throw new Error(
      "Layout block catalog is not ready yet."
    );
  }

  const exact =
    blockNamesExact.get(
      text
    );

  if (exact) {
    return exact;
  }

  const foldedKey =
    text.toLocaleLowerCase();

  if (
    blockNamesFolded.has(
      foldedKey
    )
  ) {
    const folded =
      blockNamesFolded.get(
        foldedKey
      );

    if (folded) {
      return folded;
    }

    throw new Error(
      `Block name "${text}" is ambiguous. Use the exact layout block name.`
    );
  }

  throw new Error(
    `Layout block "${text}" was not found.`
  );
}

function getBlockAddress(
  blockId: string | number
): number {
  if (!blockSnapshotReady) {
    throw new Error(
      "Block state snapshot is not ready yet."
    );
  }

  return (
    blockAddresses.get(
      resolveBlockId(
        blockId
      )
    ) ?? 0
  );
}

function getBlockTargetAddress(
  blockId: string | number
): number {
  if (!blockTargetSnapshotReady) {
    throw new Error(
      "Block target snapshot is not ready yet."
    );
  }

  return (
    blockTargetAddresses.get(
      resolveBlockId(
        blockId
      )
    ) ?? 0
  );
}

function optimisticallySetBlock(
  blockId: string | number,
  locoAddress: number
): string {
  const normalizedBlockId =
    resolveBlockId(
      blockId
    );

  for (
    const [
      key,
      currentAddress,
    ] of blockAddresses
  ) {
    if (
      currentAddress ===
      locoAddress
    ) {
      blockAddresses.set(
        key,
        0
      );
    }
  }

  blockAddresses.set(
    normalizedBlockId,
    locoAddress
  );

  blockTargetAddresses.set(
    normalizedBlockId,
    0
  );

  return normalizedBlockId;
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

function sendDcc(
  executionId: ClientScriptWorkerExecutionId,
  method: ClientScriptWorkerDccMethod,
  args: unknown[]
): void {
  post({
    type: "dcc",
    executionId,
    method,
    args,
  });
}

function createDccApi(
  executionId: ClientScriptWorkerExecutionId,
  execution: WorkerExecution
) {
  const check = () => {
    assertNotAborted(
      execution
    );
  };

  return Object.freeze({
    power(
      on: boolean
    ): void {
      check();

      sendDcc(
        executionId,
        "power",
        [
          Boolean(on),
        ]
      );
    },

    programmingPower(
      on: boolean
    ): void {
      check();

      sendDcc(
        executionId,
        "programmingPower",
        [
          Boolean(on),
        ]
      );
    },

    emergencyStop(): void {
      check();

      sendDcc(
        executionId,
        "emergencyStop",
        []
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

      sendDcc(
        executionId,
        "loco",
        [
          locoAddress,
          locoSpeed,
          direction,
        ]
      );
    },

    locoFunction(
      address: number,
      functionNumber: number,
      active: boolean
    ): void {
      check();

      sendDcc(
        executionId,
        "locoFunction",
        [
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
          Boolean(active),
        ]
      );
    },

    turnout(
      address: number,
      closed: boolean
    ): void {
      check();

      sendDcc(
        executionId,
        "turnout",
        [
          integer(
            address,
            1,
            2048,
            "Turnout address"
          ),
          Boolean(closed),
        ]
      );
    },

    sensor(
      address: number,
      on: boolean
    ): void {
      check();

      sendDcc(
        executionId,
        "sensor",
        [
          integer(
            address,
            1,
            65535,
            "Sensor address"
          ),
          Boolean(on),
        ]
      );
    },

    accessory(
      address: number,
      active: boolean
    ): void {
      check();

      sendDcc(
        executionId,
        "accessory",
        [
          integer(
            address,
            1,
            2048,
            "Accessory address"
          ),
          Boolean(active),
        ]
      );
    },

    signal(
      address: number,
      aspect: number
    ): void {
      check();

      sendDcc(
        executionId,
        "signal",
        [
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
          ),
        ]
      );
    },

    getBlock(
      blockId: string | number
    ): number {
      check();

      return getBlockAddress(
        blockId
      );
    },

    getBlockTargetLoco(
      blockId: string | number
    ): number {
      check();

      return getBlockTargetAddress(
        blockId
      );
    },

    setBlockTargetLoco(
      blockId: string | number,
      locoAddress: number
    ): void {
      check();

      const address =
        integer(
          locoAddress,
          1,
          10239,
          "Target locomotive address"
        );

      const normalizedBlockId =
        resolveBlockId(
          blockId
        );

      blockTargetAddresses.set(
        normalizedBlockId,
        address
      );

      sendDcc(
        executionId,
        "setBlockTargetLoco",
        [
          normalizedBlockId,
          address,
        ]
      );
    },

    clearBlockTargetLoco(
      blockId: string | number
    ): void {
      check();

      const normalizedBlockId =
        resolveBlockId(
          blockId
        );

      blockTargetAddresses.set(
        normalizedBlockId,
        0
      );

      sendDcc(
        executionId,
        "clearBlockTargetLoco",
        [
          normalizedBlockId,
        ]
      );
    },

    setBlock(
      blockId: string | number,
      locoAddress: number
    ): void {
      check();

      const address =
        integer(
          locoAddress,
          1,
          10239,
          "Locomotive address"
        );

      const normalizedBlockId =
        optimisticallySetBlock(
          blockId,
          address
        );

      sendDcc(
        executionId,
        "setBlock",
        [
          normalizedBlockId,
          address,
        ]
      );
    },

    block(
      blockId: string | number,
      locoId: string | null,
      locoAddress?: number
    ): void {
      check();

      const normalizedBlockId =
        resolveBlockId(
          blockId
        );

      if (
        locoAddress !== undefined
      ) {
        optimisticallySetBlock(
          normalizedBlockId,
          locoAddress
        );
      }

      sendDcc(
        executionId,
        "block",
        [
          normalizedBlockId,
          locoId,
          locoAddress === undefined
            ? undefined
            : integer(
                locoAddress,
                1,
                10239,
                "Locomotive address"
              ),
        ]
      );
    },

    clearBlock(
      blockId: string | number,
      locoId: string | null = null
    ): void {
      check();

      const normalizedBlockId =
        resolveBlockId(
          blockId
        );

      blockAddresses.set(
        normalizedBlockId,
        0
      );

      blockTargetAddresses.set(
        normalizedBlockId,
        0
      );

      sendDcc(
        executionId,
        "clearBlock",
        [
          normalizedBlockId,
          locoId,
        ]
      );
    },

    resetBlocks(): void {
      check();

      for (
        const key of
        blockAddresses.keys()
      ) {
        blockAddresses.set(
          key,
          0
        );
      }

      for (
        const key of
        blockTargetAddresses.keys()
      ) {
        blockTargetAddresses.set(
          key,
          0
        );
      }

      sendDcc(
        executionId,
        "resetBlocks",
        []
      );
    },

    raw(
      command: string
    ): void {
      check();

      const value =
        String(command).trim();

      if (!value) {
        throw new Error(
          "dcc.raw requires a DCC-EX command."
        );
      }

      sendDcc(
        executionId,
        "raw",
        [
          value,
        ]
      );
    },
  });
}

function makeCloneable(
  value: unknown
): unknown {
  try {
    return structuredClone(
      value
    );
  } catch {
    try {
      return String(
        value
      );
    } catch {
      return "[unserializable]";
    }
  }
}

function makeCloneableValues(
  values: unknown[]
): unknown[] {
  return values.map(
    makeCloneable
  );
}

function pauseExecution(
  execution: WorkerExecution
): void {
  if (
    execution.aborted ||
    execution.status ===
      "paused"
  ) {
    return;
  }

  execution.status =
    "paused";
}

function resumeExecution(
  execution: WorkerExecution
): void {
  if (
    execution.aborted ||
    execution.status !==
      "paused"
  ) {
    return;
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
}

function abortExecution(
  execution: WorkerExecution,
  reason: string
): void {
  if (
    execution.aborted
  ) {
    return;
  }

  execution.aborted =
    true;

  execution.abortReason =
    reason;

  const error =
    abortError(
      execution
    );

  const abortWaiters =
    [
      ...execution.abortWaiters,
    ];

  execution.abortWaiters.clear();

  for (
    const reject of
    abortWaiters
  ) {
    reject(
      error
    );
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
}

async function runExecution(
  executionId: ClientScriptWorkerExecutionId,
  script: string,
  element: ClientScriptWorkerElement
): Promise<void> {
  if (
    executions.has(
      executionId
    )
  ) {
    post({
      type: "error",
      executionId,
      message:
        `Script "${element.name || element.id}" is already running.`,
      name: "Error",
      stack: null,
      aborted: false,
    });

    return;
  }

  const execution:
    WorkerExecution = {
      element: {
        ...element,
      },
      status: "running",
      aborted: false,
      abortReason: null,
      pauseWaiters:
        new Set(),
      abortWaiters:
        new Set(),
    };

  executions.set(
    executionId,
    execution
  );

  const dcc =
    createDccApi(
      executionId,
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

    post({
      type: "log",
      executionId,
      values:
        makeCloneableValues(
          values
        ),
    });
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
//# sourceURL=dcc-express-worker-script-${String(element.id).replace(/[^a-zA-Z0-9_-]/g, "_")}.js`
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

    post({
      type: "done",
      executionId,
      result:
        makeCloneable(
          result
        ),
    });
  } catch (
    error
  ) {
    const aborted =
      error instanceof
        WorkerScriptAbortError ||
      execution.aborted;

    post({
      type: "error",
      executionId,
      message:
        error instanceof Error
          ? error.message
          : String(error),
      name:
        error instanceof Error
          ? error.name
          : "Error",
      stack:
        error instanceof Error
          ? error.stack ?? null
          : null,
      aborted,
    });
  } finally {
    executions.delete(
      executionId
    );
  }
}

workerScope.addEventListener(
  "message",
  (
    event:
      MessageEvent<MainToWorkerMessage>
  ) => {
    const message =
      event.data;

    if (
      message.type ===
      "blockCatalog"
    ) {
      blockNamesExact.clear();
      blockNamesFolded.clear();

      for (
        const block of
        message.blocks
      ) {
        const name =
          String(
            block.name ?? ""
          ).trim();

        const id =
          String(
            block.id ?? ""
          ).trim();

        if (
          !name ||
          !/^\d+$/.test(id)
        ) {
          continue;
        }

        blockNamesExact.set(
          name,
          id
        );

        const folded =
          name.toLocaleLowerCase();

        if (
          !blockNamesFolded.has(
            folded
          )
        ) {
          blockNamesFolded.set(
            folded,
            id
          );
        } else if (
          blockNamesFolded.get(
            folded
          ) !== id
        ) {
          blockNamesFolded.set(
            folded,
            null
          );
        }
      }

      blockCatalogReady =
        message.ready;

      return;
    }

    if (
      message.type ===
      "blockSnapshot"
    ) {
      blockAddresses.clear();

      for (
        const [
          blockId,
          locoAddress,
        ] of Object.entries(
          message.blocks
        )
      ) {
        blockAddresses.set(
          blockId,
          Number(locoAddress) || 0
        );
      }

      blockSnapshotReady =
        message.ready;

      return;
    }

    if (
      message.type ===
      "blockTargetSnapshot"
    ) {
      blockTargetAddresses.clear();

      for (
        const [
          blockId,
          locoAddress,
        ] of Object.entries(
          message.targets
        )
      ) {
        blockTargetAddresses.set(
          blockId,
          Number.isInteger(
            locoAddress
          ) &&
          locoAddress > 0
            ? locoAddress
            : 0
        );
      }

      blockTargetSnapshotReady =
        message.ready;

      return;
    }

    if (
      message.type ===
      "start"
    ) {
      void runExecution(
        message.executionId,
        message.script,
        message.element
      );

      return;
    }

    const execution =
      executionFor(
        message.executionId
      );

    if (!execution) {
      return;
    }

    if (
      message.type ===
      "pause"
    ) {
      pauseExecution(
        execution
      );

      return;
    }

    if (
      message.type ===
      "resume"
    ) {
      resumeExecution(
        execution
      );

      return;
    }

    if (
      message.type ===
      "abort"
    ) {
      abortExecution(
        execution,
        message.reason
      );

      return;
    }

    if (
      message.type ===
      "commandError"
    ) {
      abortExecution(
        execution,
        message.message
      );
    }
  }
);
