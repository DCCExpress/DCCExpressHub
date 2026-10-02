import type {
  MovementPage,
} from "../domain/movement";

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

export type DispatcherState = {
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

export type DispatcherLogLevel =
  | "info"
  | "match"
  | "warn"
  | "error";

export type DispatcherLogEntry = {
  id: string;
  timestamp: number;
  level: DispatcherLogLevel;
  message: string;
};

export type DispatcherTaskState = {
  movementId: string;
  movementName: string;
  locoAddress: number;
  requestedBlocks: number[];
  currentBlockId: number | null;
  nextBlockId: number | null;
  status:
    DispatcherState["status"];
  info: string | null;
  error: string | null;
  startedAt: number | null;
};

export type DispatcherRuntimeSnapshot = {
  enabled: boolean;
  tasks: DispatcherTaskState[];
  logs: DispatcherLogEntry[];
};

type RuntimeListener =
  (
    state:
      DispatcherRuntimeSnapshot
  ) => void;

type StateListener =
  (
    state:
      DispatcherState
  ) => void;

type CoordinatorResponse = {
  requestId?: string;
  action?: string;
  ok?: boolean;
  message?: string | null;
  count?: number;
  snapshot?: DispatcherRuntimeSnapshot;
};

const emptyRuntime =
  (): DispatcherRuntimeSnapshot => ({
    enabled:
      true,
    tasks:
      [],
    logs:
      [],
  });

const idleState =
  (): DispatcherState => ({
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

let runtime =
  emptyRuntime();

let installed =
  false;

let sequence =
  0;

const runtimeListeners =
  new Set<
    RuntimeListener
  >();

const stateListeners =
  new Map<
    string,
    Set<StateListener>
  >();

function requestId(
  action: string
): string {
  sequence +=
    1;

  return (
    `${wsApi.clientUuid}:dispatcher-coordinator:` +
    `${action}:${Date.now()}:${sequence}`
  );
}

function copyRuntime():
  DispatcherRuntimeSnapshot {
  return {
    enabled:
      runtime.enabled,
    tasks:
      runtime.tasks.map(
        task => ({
          ...task,
          requestedBlocks:
            [
              ...task.requestedBlocks,
            ],
        })
      ),
    logs:
      runtime.logs.map(
        entry => ({
          ...entry,
        })
      ),
  };
}

function stateFor(
  pageId: string
): DispatcherState {
  const task =
    runtime.tasks.find(
      candidate =>
        candidate.movementId ===
        pageId
    );

  if (!task) {
    return idleState();
  }

  return {
    status:
      task.status,
    startedAt:
      task.startedAt,
    stoppedAt:
      task.status ===
        "idle" ||
      task.status ===
        "error"
        ? Date.now()
        : null,
    locoAddress:
      task.locoAddress,
    desiredSpeed:
      0,
    currentResourceKey:
      task.currentBlockId ===
        null
        ? null
        : `block:${task.currentBlockId}`,
    activeRouteResourceKey:
      task.nextBlockId ===
        null
        ? null
        : `block:${task.nextBlockId}`,
    info:
      task.info,
    error:
      task.error,
  };
}

function emit():
  void {
  const snapshot =
    copyRuntime();

  for (
    const listener of
    runtimeListeners
  ) {
    listener(
      snapshot
    );
  }

  for (
    const [
      pageId,
      listeners,
    ] of
    stateListeners
  ) {
    const state =
      stateFor(
        pageId
      );

    for (
      const listener of
      listeners
    ) {
      listener(
        state
      );
    }
  }
}

function apply(
  raw: unknown
): void {
  if (
    !raw ||
    typeof raw !==
      "object"
  ) {
    return;
  }

  const value =
    raw as Partial<DispatcherRuntimeSnapshot>;

  runtime = {
    enabled:
      value.enabled !==
        false,
    tasks:
      Array.isArray(
        value.tasks
      )
        ? value.tasks.map(
            task => ({
              ...task,
              requestedBlocks:
                [
                  ...(
                    task.requestedBlocks ??
                    []
                  ),
                ],
            })
          )
        : [],
    logs:
      Array.isArray(
        value.logs
      )
        ? value.logs.map(
            entry => ({
              ...entry,
            })
          )
        : [],
  };

  emit();
}

function send(
  action: string,
  values:
    Record<string, unknown> =
      {}
): boolean {
  return wsApi.sendBackendCommand(
    "dispatcherCoordinatorCommand",
    {
      requestId:
        requestId(
          action
        ),
      action,
      ...values,
    }
  );
}

async function request(
  action: string,
  values:
    Record<string, unknown> =
      {}
): Promise<CoordinatorResponse> {
  const id =
    requestId(
      action
    );

  const response =
    await wsApi.requestBackendCommand<CoordinatorResponse>(
      "dispatcherCoordinatorCommand",
      {
        requestId:
          id,
        action,
        ...values,
      },
      "dispatcherCoordinatorResponse",
      data =>
        data.requestId ===
          id
    );

  if (
    response.snapshot
  ) {
    apply(
      response.snapshot
    );
  }

  return response;
}

function install():
  void {
  if (installed) {
    return;
  }

  installed =
    true;

  wsClient.subscribeMessages(
    message => {
      const raw =
        message as unknown as {
          type?: string;
          data?: unknown;
        };

      if (
        raw.type ===
          "dispatcherCoordinatorChanged"
      ) {
        apply(
          raw.data
        );
        return;
      }

      if (
        raw.type ===
          "dispatcherCoordinatorResponse"
      ) {
        const response =
          raw.data as
            CoordinatorResponse;

        if (
          response?.snapshot
        ) {
          apply(
            response.snapshot
          );
        }
      }
    }
  );

  wsClient.subscribeStatus(
    status => {
      if (
        status ===
          "connected"
      ) {
        send(
          "snapshot"
        );
      }
    }
  );

  if (
    wsClient.getStatus() ===
      "connected"
  ) {
    send(
      "snapshot"
    );
  }
}

export async function startDispatcherMovement(
  page:
    MovementPage
): Promise<void> {
  install();

  const response =
    await request(
      "start",
      {
        movementId:
          page.id,
      }
    );

  if (
    response.ok ===
      false
  ) {
    throw new Error(
      response.message ||
      "Dispatcher movement could not be started."
    );
  }
}

export function holdDispatcherMovement(
  pageId: string,
  ownerId =
    "external"
): boolean {
  install();

  return send(
    "hold",
    {
      movementId:
        pageId,
      ownerId,
    }
  );
}

export function releaseDispatcherMovement(
  pageId: string,
  ownerId =
    "external"
): boolean {
  install();

  return send(
    "release",
    {
      movementId:
        pageId,
      ownerId,
    }
  );
}

export function stopDispatcherMovement(
  pageId: string
): boolean {
  install();

  return send(
    "stop",
    {
      movementId:
        pageId,
    }
  );
}

export function abortDispatcherMovement(
  pageId: string,
  emergency =
    true
): boolean {
  install();

  return send(
    "abort",
    {
      movementId:
        pageId,
      emergencyStop:
        emergency,
    }
  );
}

export function stopAllDispatcherMovements():
  number {
  install();

  const count =
    runtime.tasks.filter(
      task =>
        task.status ===
          "running" ||
        task.status ===
          "stopping"
    ).length;

  send(
    "stopAll"
  );

  return count;
}

export function abortAllDispatcherMovements(
  emergencyStop =
    false
): number {
  install();

  const count =
    runtime.tasks.filter(
      task =>
        task.status ===
          "running" ||
        task.status ===
          "stopping"
    ).length;

  send(
    "abortAll",
    {
      emergencyStop,
    }
  );

  return count;
}

export function setDispatcherEnabled(
  value: boolean
): void {
  install();

  send(
    "setEnabled",
    {
      enabled:
        Boolean(
          value
        ),
    }
  );
}

export function getDispatcherEnabled():
  boolean {
  install();

  return runtime.enabled;
}

export function getDispatcherState(
  pageId: string
): DispatcherState {
  install();

  return stateFor(
    pageId
  );
}

export function subscribeDispatcherState(
  pageId:
    string,
  listener:
    StateListener
): () => void {
  install();

  let set =
    stateListeners.get(
      pageId
    );

  if (!set) {
    set =
      new Set<
        StateListener
      >();

    stateListeners.set(
      pageId,
      set
    );
  }

  set.add(
    listener
  );

  listener(
    stateFor(
      pageId
    )
  );

  return () => {
    const current =
      stateListeners.get(
        pageId
      );

    current?.delete(
      listener
    );

    if (
      current?.size ===
        0
    ) {
      stateListeners.delete(
        pageId
      );
    }
  };
}

export function getDispatcherRuntimeSnapshot():
  DispatcherRuntimeSnapshot {
  install();

  return copyRuntime();
}

export function subscribeDispatcherRuntime(
  listener:
    RuntimeListener
): () => void {
  install();

  runtimeListeners.add(
    listener
  );

  listener(
    copyRuntime()
  );

  return () => {
    runtimeListeners.delete(
      listener
    );
  };
}

export function clearDispatcherLog():
  void {
  install();

  send(
    "clearLogs"
  );
}

install();
