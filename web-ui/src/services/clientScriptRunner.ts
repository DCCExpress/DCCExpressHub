import {
  wsApi,
} from "./wsApi";

import {
  wsClient,
} from "./wsClient";

export type ClientScriptExecutionId =
  | number
  | string;

export type ClientScriptElementContext = {
  id:
    ClientScriptExecutionId;
  name: string;
  type: string;
};

export type ClientScriptStatus =
  | "idle"
  | "running"
  | "paused";

export type ClientScriptState = {
  status:
    ClientScriptStatus;
  startedAt:
    number | null;
  error:
    string | null;
  info:
    string | null;
};

export type ClientScriptLogEntry = {
  timestamp: number;
  values: unknown[];
};

export type ActiveClientScriptExecution = {
  id:
    ClientScriptExecutionId;
  name: string;
  status:
    | "running"
    | "paused";
};

type BackendState = {
  executionId: string;
  scriptId?: string | null;
  name: string;
  type?: string;
  status:
    | "idle"
    | "running"
    | "paused"
    | "error";
  startedAt:
    number | null;
  stoppedAt:
    number | null;
  error:
    string | null;
  info:
    string | null;
};

type ScriptResponse = {
  requestId?: string;
  action?: string;
  ok?: boolean;
  message?: string | null;
  extra?: {
    state?: BackendState;
    states?: BackendState[];
    count?: number;
    finishing?: boolean;
  } | null;
};

type StateListener =
  (
    state:
      ClientScriptState
  ) => void;

type LogListener =
  (
    entry:
      ClientScriptLogEntry
  ) => void;

type FinishingListener =
  (
    finishing:
      boolean
  ) => void;

type RunWaiter = {
  started: boolean;
  aborted: boolean;
  resolve:
    (value: unknown) => void;
  reject:
    (reason: unknown) => void;
};

const states =
  new Map<
    string,
    BackendState
  >();

const stateListeners =
  new Map<
    string,
    Set<StateListener>
  >();

const logListeners =
  new Map<
    string,
    Set<LogListener>
  >();

const finishingListeners =
  new Set<
    FinishingListener
  >();

const runWaiters =
  new Map<
    string,
    RunWaiter
  >();

let finishing =
  false;

let installed =
  false;

let sequence =
  0;

function key(
  value:
    ClientScriptExecutionId
): string {
  return String(
    value
  );
}

function requestId(
  action: string
): string {
  sequence +=
    1;

  return (
    `${wsApi.clientUuid}:script:` +
    `${action}:${Date.now()}:${sequence}`
  );
}

function clientState(
  state:
    BackendState |
    undefined
): ClientScriptState {
  if (!state) {
    return {
      status:
        "idle",
      startedAt:
        null,
      error:
        null,
      info:
        null,
    };
  }

  return {
    status:
      state.status ===
        "running"
        ? "running"
        : state.status ===
            "paused"
          ? "paused"
          : "idle",
    startedAt:
      state.startedAt,
    error:
      state.status ===
        "error"
        ? state.error
        : null,
    info:
      state.info,
  };
}

function emitState(
  executionId: string
): void {
  const value =
    clientState(
      states.get(
        executionId
      )
    );

  for (
    const listener of
    stateListeners.get(
      executionId
    ) ??
    []
  ) {
    listener(
      value
    );
  }
}

function settle(
  state:
    BackendState
): void {
  const waiter =
    runWaiters.get(
      state.executionId
    );

  if (!waiter) {
    return;
  }

  if (
    state.status ===
      "running" ||
    state.status ===
      "paused"
  ) {
    waiter.started =
      true;
    return;
  }

  if (
    !waiter.started &&
    state.stoppedAt ===
      null
  ) {
    return;
  }

  runWaiters.delete(
    state.executionId
  );

  if (
    state.status ===
      "error"
  ) {
    waiter.reject(
      new Error(
        state.error ||
        "Script execution failed."
      )
    );

    return;
  }

  if (
    waiter.aborted
  ) {
    waiter.reject(
      new ScriptAbortError()
    );

    return;
  }

  waiter.resolve(
    undefined
  );
}

function applyState(
  state:
    BackendState
): void {
  if (
    !state?.executionId
  ) {
    return;
  }

  states.set(
    state.executionId,
    {
      ...state,
    }
  );

  emitState(
    state.executionId
  );

  settle(
    state
  );
}

function applyFinishing(
  value: boolean
): void {
  const next =
    Boolean(
      value
    );

  if (
    finishing ===
      next
  ) {
    return;
  }

  finishing =
    next;

  for (
    const listener of
    finishingListeners
  ) {
    listener(
      next
    );
  }
}

function send(
  action: string,
  values:
    Record<string, unknown> =
      {}
): boolean {
  return wsApi.sendBackendCommand(
    "scriptCommand",
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
      {},
  timeoutMs =
    15000
): Promise<ScriptResponse> {
  const id =
    requestId(
      action
    );

  const response =
    await wsApi.requestBackendCommand<ScriptResponse>(
      "scriptCommand",
      {
        requestId:
          id,
        action,
        ...values,
      },
      "automationScriptResponse",
      value =>
        value.requestId ===
          id,
      timeoutMs
    );

  if (
    response.extra?.state
  ) {
    applyState(
      response.extra.state
    );
  }

  for (
    const state of
    response.extra?.states ??
    []
  ) {
    applyState(
      state
    );
  }

  if (
    typeof response.extra
      ?.finishing ===
      "boolean"
  ) {
    applyFinishing(
      response.extra.finishing
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
          "automationScriptStateChanged"
      ) {
        applyState(
          raw.data as
            BackendState
        );
        return;
      }

      if (
        raw.type ===
          "automationScriptSnapshot"
      ) {
        const snapshot =
          raw.data as {
            states?: BackendState[];
            finishing?: boolean;
          };

        applyFinishing(
          Boolean(
            snapshot.finishing
          )
        );

        for (
          const state of
          snapshot.states ??
          []
        ) {
          applyState(
            state
          );
        }

        return;
      }

      if (
        raw.type ===
          "automationScriptLog"
      ) {
        const entry =
          raw.data as {
            executionId?: string;
            timestamp?: number;
            message?: string;
          };

        if (
          !entry.executionId
        ) {
          return;
        }

        const log:
          ClientScriptLogEntry = {
          timestamp:
            entry.timestamp ??
            Date.now(),
          values: [
            entry.message ??
            "",
          ],
        };

        for (
          const listener of
          logListeners.get(
            entry.executionId
          ) ??
          []
        ) {
          listener(
            log
          );
        }

        return;
      }

      if (
        raw.type ===
          "automationScriptResponse"
      ) {
        const response =
          raw.data as
            ScriptResponse;

        if (
          response.extra?.state
        ) {
          applyState(
            response.extra.state
          );
        }

        for (
          const state of
          response.extra?.states ??
          []
        ) {
          applyState(
            state
          );
        }

        if (
          typeof response.extra
            ?.finishing ===
            "boolean"
        ) {
          applyFinishing(
            response.extra.finishing
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

export function getAutomationFinishing():
  boolean {
  install();

  return finishing;
}

export function setAutomationFinishing(
  value: boolean
): void {
  install();

  applyFinishing(
    value
  );

  send(
    "setFinishing",
    {
      finishing:
        Boolean(
          value
        ),
    }
  );
}

export function subscribeAutomationFinishing(
  listener:
    FinishingListener
): () => void {
  install();

  finishingListeners.add(
    listener
  );

  listener(
    finishing
  );

  return () => {
    finishingListeners.delete(
      listener
    );
  };
}

export class ScriptAbortError extends Error {
  constructor(
    message =
      "Script aborted."
  ) {
    super(
      message
    );

    this.name =
      "ScriptAbortError";
  }
}

export function getClientScriptState(
  elementId:
    ClientScriptExecutionId
): ClientScriptState {
  install();

  return clientState(
    states.get(
      key(
        elementId
      )
    )
  );
}

export function getActiveClientScriptExecutions():
  ActiveClientScriptExecution[] {
  install();

  return [
    ...states.values(),
  ]
    .filter(
      state =>
        state.status ===
          "running" ||
        state.status ===
          "paused"
    )
    .map(
      state => ({
        id:
          state.executionId,
        name:
          state.name ||
          state.executionId,
        status:
          state.status as
            | "running"
            | "paused",
      })
    );
}

export function subscribeClientScriptLog(
  elementId:
    ClientScriptExecutionId,
  listener:
    LogListener
): () => void {
  install();

  const id =
    key(
      elementId
    );

  let set =
    logListeners.get(
      id
    );

  if (!set) {
    set =
      new Set<
        LogListener
      >();

    logListeners.set(
      id,
      set
    );
  }

  set.add(
    listener
  );

  return () => {
    const current =
      logListeners.get(
        id
      );

    current?.delete(
      listener
    );

    if (
      current?.size ===
        0
    ) {
      logListeners.delete(
        id
      );
    }
  };
}

export function subscribeClientScriptState(
  elementId:
    ClientScriptExecutionId,
  listener:
    StateListener
): () => void {
  install();

  const id =
    key(
      elementId
    );

  let set =
    stateListeners.get(
      id
    );

  if (!set) {
    set =
      new Set<
        StateListener
      >();

    stateListeners.set(
      id,
      set
    );
  }

  set.add(
    listener
  );

  listener(
    getClientScriptState(
      elementId
    )
  );

  return () => {
    const current =
      stateListeners.get(
        id
      );

    current?.delete(
      listener
    );

    if (
      current?.size ===
        0
    ) {
      stateListeners.delete(
        id
      );
    }
  };
}

export function pauseClientScript(
  elementId:
    ClientScriptExecutionId
): boolean {
  install();

  return send(
    "pause",
    {
      executionId:
        key(
          elementId
        ),
    }
  );
}

export function resumeClientScript(
  elementId:
    ClientScriptExecutionId
): boolean {
  install();

  return send(
    "resume",
    {
      executionId:
        key(
          elementId
        ),
    }
  );
}

export function abortClientScript(
  elementId:
    ClientScriptExecutionId,
  _reason =
    "Script aborted by user."
): boolean {
  install();

  const id =
    key(
      elementId
    );

  const waiter =
    runWaiters.get(
      id
    );

  if (waiter) {
    waiter.aborted =
      true;
  }

  return send(
    "abort",
    {
      executionId:
        id,
    }
  );
}

export async function startAllSavedClientScripts():
  Promise<number> {
  const response =
    await request(
      "startAll"
    );

  if (
    response.ok ===
      false
  ) {
    throw new Error(
      response.message ||
      "Saved scripts could not be started."
    );
  }

  return (
    response.extra?.count ??
    0
  );
}

export async function pauseAllSavedClientScripts():
  Promise<number> {
  const response =
    await request(
      "pauseAllSaved"
    );

  if (
    response.ok ===
      false
  ) {
    throw new Error(
      response.message ||
      "Saved scripts could not be paused."
    );
  }

  return (
    response.extra?.count ??
    0
  );
}

export async function resumeAllSavedClientScripts():
  Promise<number> {
  const response =
    await request(
      "resumeAllSaved"
    );

  if (
    response.ok ===
      false
  ) {
    throw new Error(
      response.message ||
      "Saved scripts could not be resumed."
    );
  }

  return (
    response.extra?.count ??
    0
  );
}

export async function abortAllSavedClientScripts():
  Promise<number> {
  const response =
    await request(
      "abortAllSaved"
    );

  if (
    response.ok ===
      false
  ) {
    throw new Error(
      response.message ||
      "Saved scripts could not be aborted."
    );
  }

  return (
    response.extra?.count ??
    0
  );
}

export function abortAllClientScriptExecutions(
  _reason =
    "Scripts aborted."
): number {
  install();

  const count =
    getActiveClientScriptExecutions()
      .length;

  for (
    const waiter of
    runWaiters.values()
  ) {
    waiter.aborted =
      true;
  }

  send(
    "abortAll"
  );

  return count;
}

export async function runClientScript(
  script: string,
  element:
    ClientScriptElementContext
): Promise<unknown> {
  install();

  if (
    !script.trim()
  ) {
    return undefined;
  }

  const id =
    key(
      element.id
    );

  const current =
    states.get(
      id
    );

  if (
    current?.status ===
      "running" ||
    current?.status ===
      "paused" ||
    runWaiters.has(
      id
    )
  ) {
    throw new Error(
      `Script "${element.name || id}" is already running.`
    );
  }

  const completion =
    new Promise<unknown>(
      (
        resolve,
        reject
      ) => {
        runWaiters.set(
          id,
          {
            started:
              false,
            aborted:
              false,
            resolve,
            reject,
          }
        );
      }
    );

  let response:
    ScriptResponse;

  try {
    response =
      await request(
        "startSource",
        {
          executionId:
            id,
          name:
            element.name ||
            id,
          executionType:
            element.type ||
            "automation",
          source:
            script,
        },
        15000
      );
  } catch (
    error
  ) {
    runWaiters.delete(
      id
    );

    throw error;
  }

  if (
    response.ok ===
      false
  ) {
    runWaiters.delete(
      id
    );

    throw new Error(
      response.message ||
      "Script could not be started."
    );
  }

  const waiter =
    runWaiters.get(
      id
    );

  if (waiter) {
    waiter.started =
      true;
  }

  return await completion;
}

install();
