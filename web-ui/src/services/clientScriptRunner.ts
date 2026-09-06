import {
  wsApi,
} from "./wsApi";

import {
  wsClient,
} from "./wsClient";

import type {
  ClientScriptWorkerDccMethod,
  MainToWorkerMessage,
  WorkerToMainMessage,
} from "./clientScriptWorkerProtocol";

export type ClientScriptExecutionId =
  | number
  | string;

export type ClientScriptElementContext = {
  id: ClientScriptExecutionId;
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

type StateListener =
  (state: ClientScriptState) => void;

type ExecutionControl = {
  element: ClientScriptElementContext;
  status: "running" | "paused";
  startedAt: number;
  aborted: boolean;
  abortReason: string | null;
  commandError: string | null;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

const executions =
  new Map<ClientScriptExecutionId, ExecutionControl>();

const listeners =
  new Map<ClientScriptExecutionId, Set<StateListener>>();

const lastErrors =
  new Map<ClientScriptExecutionId, string | null>();

let automationWorker:
  Worker | null = null;

let visibilityLoggingInstalled =
  false;

let blockTrackingInstalled =
  false;

let blockSnapshotReady =
  false;

let blockSnapshot =
  new Map<string, number>();


type LayoutBlockCatalogItem = {
  id: string;
  name: string;
};

type LayoutForBlockCatalog = {
  layers?: Array<{
    elements?: Array<{
      id?: number | string;
      type?: string;
      name?: string;
    }>;
  }>;
};

let blockCatalogReady =
  false;

let blockCatalog:
  LayoutBlockCatalogItem[] = [];

let blockCatalogLoadPromise:
  Promise<void> | null = null;

function sendBlockCatalogToWorker(): void {
  if (!automationWorker) {
    return;
  }

  const message:
    MainToWorkerMessage = {
      type: "blockCatalog",
      blocks:
        blockCatalog.map(
          block => ({
            ...block,
          })
        ),
      ready:
        blockCatalogReady,
    };

  automationWorker.postMessage(
    message
  );
}

async function refreshBlockCatalog(): Promise<void> {
  if (
    blockCatalogLoadPromise
  ) {
    return blockCatalogLoadPromise;
  }

  blockCatalogLoadPromise =
    (async () => {
      const response =
        await fetch(
          "/api/layout",
          {
            cache: "no-store",
          }
        );

      if (!response.ok) {
        throw new Error(
          `Layout could not be loaded for script block-name lookup (HTTP ${response.status}).`
        );
      }

      const layout =
        await response.json() as LayoutForBlockCatalog;

      const next:
        LayoutBlockCatalogItem[] = [];

      for (
        const layer of
        layout.layers ?? []
      ) {
        for (
          const element of
          layer.elements ?? []
        ) {
          if (
            element.type !==
            "trackblock"
          ) {
            continue;
          }

          const rawId =
            String(
              element.id ?? ""
            ).trim();

          const name =
            String(
              element.name ?? ""
            ).trim();

          if (
            !/^\d+$/.test(
              rawId
            ) ||
            !name
          ) {
            continue;
          }

          const numericId =
            Number(rawId);

          if (
            !Number.isInteger(
              numericId
            ) ||
            numericId < 1 ||
            numericId > 65535
          ) {
            continue;
          }

          next.push({
            id:
              String(
                numericId
              ),
            name,
          });
        }
      }

      blockCatalog =
        next;

      blockCatalogReady =
        true;

      sendBlockCatalogToWorker();
    })().finally(
      () => {
        blockCatalogLoadPromise =
          null;
      }
    );

  return blockCatalogLoadPromise;
}

type BlockStateSnapshot =
  Record<
    string,
    {
      blockId: string;
      locoId: string | null;
      locoAddress?: number;
    }
  >;

function blockSnapshotRecord(): Record<string, number> {
  const result:
    Record<string, number> = {};

  for (
    const [
      blockId,
      locoAddress,
    ] of blockSnapshot
  ) {
    result[blockId] =
      locoAddress;
  }

  return result;
}

function sendBlockSnapshotToWorker(): void {
  if (!automationWorker) {
    return;
  }

  const message:
    MainToWorkerMessage = {
      type: "blockSnapshot",
      blocks:
        blockSnapshotRecord(),
      ready:
        blockSnapshotReady,
    };

  automationWorker.postMessage(
    message
  );
}

function applyBlockSnapshot(
  data: BlockStateSnapshot
): void {
  const next =
    new Map<string, number>();

  for (
    const [
      key,
      state,
    ] of Object.entries(
      data
    )
  ) {
    const blockId =
      String(
        state?.blockId ??
        key
      );

    const locoAddress =
      Number(
        state?.locoAddress ??
        0
      );

    next.set(
      blockId,
      Number.isInteger(locoAddress) &&
      locoAddress > 0
        ? locoAddress
        : 0
    );
  }

  blockSnapshot =
    next;

  blockSnapshotReady =
    true;

  sendBlockSnapshotToWorker();
}

function installBlockTracking(): void {
  if (
    blockTrackingInstalled
  ) {
    return;
  }

  blockTrackingInstalled =
    true;

  wsClient.on<BlockStateSnapshot>(
    "blockStateChanged",
    data => {
      applyBlockSnapshot(
        data
      );
    }
  );

  wsClient.subscribeStatus(
    status => {
      if (
        status !==
        "connected"
      ) {
        return;
      }

      wsApi.getBlocks();

      void refreshBlockCatalog().catch(
        error => {
          console.warn(
            "[Automation Worker] layout block catalog refresh failed:",
            error
          );
        }
      );
    }
  );
}

export class ScriptAbortError extends Error {
  constructor(
    message = "Script aborted."
  ) {
    super(message);
    this.name = "ScriptAbortError";
  }
}

function stateFor(
  elementId: ClientScriptExecutionId
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
  elementId: ClientScriptExecutionId
): void {
  const state =
    stateFor(elementId);

  for (
    const listener of
    listeners.get(elementId) ?? []
  ) {
    listener(
      state
    );
  }
}

export function getClientScriptState(
  elementId: ClientScriptExecutionId
): ClientScriptState {
  return stateFor(
    elementId
  );
}

export function subscribeClientScriptState(
  elementId: ClientScriptExecutionId,
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

  set.add(
    listener
  );

  listener(
    stateFor(
      elementId
    )
  );

  return () => {
    const current =
      listeners.get(elementId);

    if (!current) {
      return;
    }

    current.delete(
      listener
    );

    if (
      current.size === 0
    ) {
      listeners.delete(
        elementId
      );
    }
  };
}

function installVisibilityLogging(): void {
  if (
    visibilityLoggingInstalled ||
    typeof document ===
      "undefined"
  ) {
    return;
  }

  visibilityLoggingInstalled =
    true;

  document.addEventListener(
    "visibilitychange",
    () => {
      if (
        executions.size === 0
      ) {
        return;
      }

      console.info(
        `[Automation Worker] browser ${
          document.hidden
            ? "hidden"
            : "visible"
        }; ${executions.size} script(s) active.`
      );
    }
  );
}

function postToWorker(
  message: MainToWorkerMessage
): void {
  ensureWorker().postMessage(
    message
  );
}

function failAllExecutions(
  error: Error
): void {
  const active =
    [
      ...executions.entries(),
    ];

  executions.clear();

  for (
    const [
      elementId,
      execution,
    ] of active
  ) {
    lastErrors.set(
      elementId,
      error.message
    );

    execution.reject(
      error
    );

    emitState(
      elementId
    );
  }
}

function ensureWorker(): Worker {
  if (
    automationWorker
  ) {
    return automationWorker;
  }

  installVisibilityLogging();
  installBlockTracking();

  const worker =
    new Worker(
      new URL(
        "./clientScriptWorker.ts",
        import.meta.url
      ),
      {
        type: "module",
        name:
          "dcc-express-automation",
      }
    );

  worker.addEventListener(
    "message",
    (
      event:
        MessageEvent<WorkerToMainMessage>
    ) => {
      handleWorkerMessage(
        event.data
      );
    }
  );

  worker.addEventListener(
    "error",
    event => {
      const error =
        new Error(
          event.message ||
            "Automation Worker crashed."
        );

      console.error(
        "[Automation Worker]",
        error
      );

      failAllExecutions(
        error
      );

      worker.terminate();

      if (
        automationWorker ===
        worker
      ) {
        automationWorker =
          null;
      }
    }
  );

  worker.addEventListener(
    "messageerror",
    () => {
      const error =
        new Error(
          "Automation Worker message could not be decoded."
        );

      console.error(
        "[Automation Worker]",
        error
      );

      failAllExecutions(
        error
      );
    }
  );

  automationWorker =
    worker;

  sendBlockCatalogToWorker();
  sendBlockSnapshotToWorker();

  if (
    wsClient.isConnected() &&
    !blockSnapshotReady
  ) {
    wsApi.getBlocks();
  }

  return worker;
}

function requireSend(
  ok: boolean,
  label: string
): string | null {
  if (
    ok
  ) {
    return null;
  }

  return (
    `${label}: WebSocket command could not be sent.`
  );
}

function numberArg(
  args: unknown[],
  index: number
): number {
  return Number(
    args[index]
  );
}

function booleanArg(
  args: unknown[],
  index: number
): boolean {
  return Boolean(
    args[index]
  );
}

function stringArg(
  args: unknown[],
  index: number
): string {
  return String(
    args[index] ?? ""
  );
}

function executeDccCommand(
  method: ClientScriptWorkerDccMethod,
  args: unknown[]
): string | null {
  switch (
    method
  ) {
    case "power":
      return requireSend(
        wsApi.setTrackPower(
          booleanArg(
            args,
            0
          )
        ),
        "dcc.power"
      );

    case "programmingPower":
      return requireSend(
        wsApi.setProgrammingPower(
          booleanArg(
            args,
            0
          )
        ),
        "dcc.programmingPower"
      );

    case "emergencyStop":
      return requireSend(
        wsApi.emergencyStop(),
        "dcc.emergencyStop"
      );

    case "loco": {
      const direction =
        args[2] === "reverse"
          ? "reverse"
          : "forward";

      return requireSend(
        wsApi.setLoco(
          numberArg(
            args,
            0
          ),
          numberArg(
            args,
            1
          ),
          direction
        ),
        "dcc.loco"
      );
    }

    case "locoFunction":
      return requireSend(
        wsApi.setLocoFunction(
          numberArg(
            args,
            0
          ),
          numberArg(
            args,
            1
          ),
          booleanArg(
            args,
            2
          )
        ),
        "dcc.locoFunction"
      );

    case "turnout":
      return requireSend(
        wsApi.setTurnout(
          numberArg(
            args,
            0
          ),
          booleanArg(
            args,
            1
          )
        ),
        "dcc.turnout"
      );

    case "sensor":
      return requireSend(
        wsApi.setSensor(
          numberArg(
            args,
            0
          ),
          booleanArg(
            args,
            1
          )
        ),
        "dcc.sensor"
      );

    case "accessory":
      return requireSend(
        wsApi.setBasicAccessory(
          numberArg(
            args,
            0
          ),
          booleanArg(
            args,
            1
          )
        ),
        "dcc.accessory"
      );

    case "signal":
      return requireSend(
        wsApi.setSignalAspect(
          numberArg(
            args,
            0
          ),
          numberArg(
            args,
            1
          )
        ),
        "dcc.signal"
      );

    case "setBlock":
      return requireSend(
        wsApi.setBlock(
          stringArg(
            args,
            0
          ),
          null,
          numberArg(
            args,
            1
          )
        ),
        "dcc.setBlock"
      );

    case "block": {
      const rawLocoId =
        args[1];

      const locoId =
        rawLocoId === null ||
        rawLocoId === undefined
          ? null
          : String(
              rawLocoId
            );

      const rawAddress =
        args[2];

      const locoAddress =
        rawAddress === undefined
          ? undefined
          : Number(
              rawAddress
            );

      return requireSend(
        wsApi.setBlock(
          stringArg(
            args,
            0
          ),
          locoId,
          locoAddress
        ),
        "dcc.block"
      );
    }

    case "clearBlock": {
      const rawLocoId =
        args[1];

      const locoId =
        rawLocoId === null ||
        rawLocoId === undefined
          ? null
          : String(
              rawLocoId
            );

      return requireSend(
        wsApi.setBlockRemove(
          stringArg(
            args,
            0
          ),
          locoId
        ),
        "dcc.clearBlock"
      );
    }

    case "resetBlocks":
      return requireSend(
        wsApi.setBlocksReset(),
        "dcc.resetBlocks"
      );

    case "raw":
      return requireSend(
        wsApi.writeDccExDirectCommand(
          stringArg(
            args,
            0
          )
        ),
        "dcc.raw"
      );
  }
}

function handleDccCommand(
  message:
    Extract<
      WorkerToMainMessage,
      {
        type: "dcc";
      }
    >
): void {
  const execution =
    executions.get(
      message.executionId
    );

  if (
    !execution ||
    execution.aborted
  ) {
    return;
  }

  let errorMessage:
    string | null = null;

  try {
    errorMessage =
      executeDccCommand(
        message.method,
        message.args
      );
  } catch (
    error
  ) {
    errorMessage =
      error instanceof Error
        ? error.message
        : String(error);
  }

  if (
    !errorMessage
  ) {
    return;
  }

  execution.commandError =
    errorMessage;

  postToWorker({
    type: "commandError",
    executionId:
      message.executionId,
    message:
      errorMessage,
  });
}

function finishExecution(
  elementId: ClientScriptExecutionId
): void {
  executions.delete(
    elementId
  );

  emitState(
    elementId
  );
}

function handleWorkerMessage(
  message: WorkerToMainMessage
): void {
  const execution =
    executions.get(
      message.executionId
    );

  if (
    message.type ===
    "dcc"
  ) {
    handleDccCommand(
      message
    );

    return;
  }

  if (
    !execution
  ) {
    return;
  }

  if (
    message.type ===
    "log"
  ) {
    console.log(
      `[ScriptButton ${execution.element.name || execution.element.id}]`,
      ...message.values
    );

    return;
  }

  if (
    message.type ===
    "done"
  ) {
    if (
      execution.commandError
    ) {
      const error =
        new Error(
          execution.commandError
        );

      lastErrors.set(
        message.executionId,
        error.message
      );

      execution.reject(
        error
      );
    } else if (
      execution.aborted
    ) {
      lastErrors.set(
        message.executionId,
        null
      );

      execution.reject(
        new ScriptAbortError(
          execution.abortReason ??
            "Script aborted."
        )
      );
    } else {
      lastErrors.set(
        message.executionId,
        null
      );

      execution.resolve(
        message.result
      );
    }

    finishExecution(
      message.executionId
    );

    return;
  }

  if (
    message.type ===
    "error"
  ) {
    if (
      message.aborted ||
      execution.aborted
    ) {
      lastErrors.set(
        message.executionId,
        execution.commandError
          ? execution.commandError
          : null
      );

      if (
        execution.commandError
      ) {
        execution.reject(
          new Error(
            execution.commandError
          )
        );
      } else {
        execution.reject(
          new ScriptAbortError(
            execution.abortReason ??
              message.message
          )
        );
      }
    } else {
      const error =
        new Error(
          message.message
        );

      error.name =
        message.name;

      if (
        message.stack
      ) {
        error.stack =
          message.stack;
      }

      lastErrors.set(
        message.executionId,
        error.message
      );

      execution.reject(
        error
      );
    }

    finishExecution(
      message.executionId
    );
  }
}

export function pauseClientScript(
  elementId: ClientScriptExecutionId
): boolean {
  const execution =
    executions.get(
      elementId
    );

  if (
    !execution ||
    execution.aborted ||
    execution.status ===
      "paused"
  ) {
    return false;
  }

  execution.status =
    "paused";

  postToWorker({
    type: "pause",
    executionId:
      elementId,
  });

  emitState(
    elementId
  );

  return true;
}

export function resumeClientScript(
  elementId: ClientScriptExecutionId
): boolean {
  const execution =
    executions.get(
      elementId
    );

  if (
    !execution ||
    execution.aborted ||
    execution.status !==
      "paused"
  ) {
    return false;
  }

  execution.status =
    "running";

  postToWorker({
    type: "resume",
    executionId:
      elementId,
  });

  emitState(
    elementId
  );

  return true;
}

export function abortClientScript(
  elementId: ClientScriptExecutionId,
  reason =
    "Script aborted by user."
): boolean {
  const execution =
    executions.get(
      elementId
    );

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

  postToWorker({
    type: "abort",
    executionId:
      elementId,
    reason,
  });

  emitState(
    elementId
  );

  return true;
}

export async function runClientScript(
  script: string,
  element: ClientScriptElementContext
): Promise<unknown> {
  if (
    !script.trim()
  ) {
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

  await refreshBlockCatalog();

  const worker =
    ensureWorker();

  return await new Promise<unknown>(
    (
      resolve,
      reject
    ) => {
      const execution:
        ExecutionControl = {
          element: {
            ...element,
          },
          status: "running",
          startedAt: Date.now(),
          aborted: false,
          abortReason: null,
          commandError: null,
          resolve,
          reject,
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

      const message:
        MainToWorkerMessage = {
          type: "start",
          executionId:
            element.id,
          script,
          element: {
            ...element,
          },
        };

      try {
        worker.postMessage(
          message
        );
      } catch (
        error
      ) {
        executions.delete(
          element.id
        );

        const sendError =
          error instanceof Error
            ? error
            : new Error(
                String(
                  error
                )
              );

        lastErrors.set(
          element.id,
          sendError.message
        );

        emitState(
          element.id
        );

        reject(
          sendError
        );
      }
    }
  );
}


installBlockTracking();
