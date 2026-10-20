import {
  wsApi,
} from "./wsApi";

import {
  wsClient,
} from "./wsClient";

import type {
  AutomationScriptRuntimeStatePayload,
} from "../domain/wsTypes";

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

type AutomationFinishingListener =
  (
    finishing:
      boolean
  ) => void;

type RunWaiter = {
  started: boolean;
  aborted: boolean;
  resolve: (
    value:
      unknown
  ) => void;
  reject: (
    reason:
      unknown
  ) => void;
};

const states =
  new Map<
    string,
    AutomationScriptRuntimeStatePayload
  >();

const listeners =
  new Map<
    string,
    Set<StateListener>
  >();

const logListeners =
  new Map<
    string,
    Set<LogListener>
  >();

const runWaiters =
  new Map<
    string,
    RunWaiter
  >();

const finishingListeners =
  new Set<
    AutomationFinishingListener
  >();

let automationFinishing =
  false;

let installed =
  false;

let requestSequence =
  0;

function executionKey(
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
  requestSequence +=
    1;

  return (
    `${wsApi.clientUuid}:automation-script:` +
    `${action}:` +
    `${Date.now()}:` +
    `${requestSequence}`
  );
}

function clientState(
  state:
    AutomationScriptRuntimeStatePayload |
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
  const state =
    clientState(
      states.get(
        executionId
      )
    );

  for (
    const listener of
    listeners.get(
      executionId
    ) ??
    []
  ) {
    listener(
      state
    );
  }
}

function settleRunWaiter(
  state:
    AutomationScriptRuntimeStatePayload
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
    AutomationScriptRuntimeStatePayload
): void {
  states.set(
    state.executionId,
    {
      ...state,
    }
  );

  emitState(
    state.executionId
  );

  settleRunWaiter(
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
    automationFinishing ===
      next
  ) {
    return;
  }

  automationFinishing =
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

function requestSnapshot():
  void {
  wsApi.scriptCommand(
    requestId(
      "snapshot"
    ),
    "snapshot"
  );
}

function installTracking():
  void {
  if (installed) {
    return;
  }

  installed =
    true;

  wsClient.on(
    "automationScriptStateChanged",
    state => {
      applyState(
        state
      );
    }
  );

  wsClient.on(
    "automationScriptSnapshot",
    snapshot => {
      applyFinishing(
        snapshot.finishing
      );

      for (
        const state of
        snapshot.states
      ) {
        applyState(
          state
        );
      }
    }
  );

  wsClient.on(
    "automationScriptLog",
    entry => {
      const log:
        ClientScriptLogEntry = {
        timestamp:
          entry.timestamp,
        values: [
          entry.message,
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
    }
  );

  wsClient.on(
    "automationScriptResponse",
    response => {
      const extra =
        response.extra;

      if (
        extra?.state
      ) {
        applyState(
          extra.state
        );
      }

      for (
        const state of
        extra?.states ??
        []
      ) {
        applyState(
          state
        );
      }

      if (
        typeof extra?.finishing ===
          "boolean"
      ) {
        applyFinishing(
          extra.finishing
        );
      }
    }
  );

  wsClient.subscribeStatus(
    status => {
      if (
        status ===
          "connected"
      ) {
        requestSnapshot();
      }
    }
  );

  requestSnapshot();
}

export function getAutomationFinishing():
  boolean {
  installTracking();

  return automationFinishing;
}

export function setAutomationFinishing(
  finishing: boolean
): void {
  installTracking();

  applyFinishing(
    finishing
  );

  wsApi.scriptCommand(
    requestId(
      "setFinishing"
    ),
    "setFinishing",
    {
      finishing:
        Boolean(
          finishing
        ),
    }
  );
}

export function subscribeAutomationFinishing(
  listener:
    AutomationFinishingListener
): () => void {
  installTracking();

  finishingListeners.add(
    listener
  );

  listener(
    automationFinishing
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
  installTracking();

  return clientState(
    states.get(
      executionKey(
        elementId
      )
    )
  );
}

export function getActiveClientScriptExecutions():
  ActiveClientScriptExecution[] {
  installTracking();

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
  installTracking();

  const key =
    executionKey(
      elementId
    );

  let set =
    logListeners.get(
      key
    );

  if (!set) {
    set =
      new Set<
        LogListener
      >();

    logListeners.set(
      key,
      set
    );
  }

  set.add(
    listener
  );

  return () => {
    const current =
      logListeners.get(
        key
      );

    current?.delete(
      listener
    );

    if (
      current?.size ===
        0
    ) {
      logListeners.delete(
        key
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
  installTracking();

  const key =
    executionKey(
      elementId
    );

  let set =
    listeners.get(
      key
    );

  if (!set) {
    set =
      new Set<
        StateListener
      >();

    listeners.set(
      key,
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
      listeners.get(
        key
      );

    current?.delete(
      listener
    );

    if (
      current?.size ===
        0
    ) {
      listeners.delete(
        key
      );
    }
  };
}

export function pauseClientScript(
  elementId:
    ClientScriptExecutionId
): boolean {
  installTracking();

  const key =
    executionKey(
      elementId
    );

  const state =
    states.get(
      key
    );

  if (
    !state ||
    state.status !==
      "running"
  ) {
    return false;
  }

  return wsApi.scriptCommand(
    requestId(
      "pause"
    ),
    "pause",
    {
      executionId:
        key,
    }
  );
}

export function resumeClientScript(
  elementId:
    ClientScriptExecutionId
): boolean {
  installTracking();

  const key =
    executionKey(
      elementId
    );

  const state =
    states.get(
      key
    );

  if (
    !state ||
    state.status !==
      "paused"
  ) {
    return false;
  }

  return wsApi.scriptCommand(
    requestId(
      "resume"
    ),
    "resume",
    {
      executionId:
        key,
    }
  );
}

export function abortClientScript(
  elementId:
    ClientScriptExecutionId,
  _reason =
    "Script aborted by user."
): boolean {
  installTracking();

  const key =
    executionKey(
      elementId
    );

  const state =
    states.get(
      key
    );

  if (
    !state ||
    (
      state.status !==
        "running" &&
      state.status !==
        "paused"
    )
  ) {
    return false;
  }

  const waiter =
    runWaiters.get(
      key
    );

  if (waiter) {
    waiter.aborted =
      true;
  }

  return wsApi.scriptCommand(
    requestId(
      "abort"
    ),
    "abort",
    {
      executionId:
        key,
    }
  );
}

export async function startAllSavedClientScripts():
  Promise<number> {
  installTracking();

  const response =
    await wsApi.scriptRequest(
      requestId(
        "startAll"
      ),
      "startAll"
    );

  if (!response.ok) {
    throw new Error(
      response.message ||
      "Saved automation scripts could not be started."
    );
  }

  return (
    response.extra?.count ??
    0
  );
}

export async function pauseAllSavedClientScripts():
  Promise<number> {
  installTracking();

  const response =
    await wsApi.scriptRequest(
      requestId(
        "pauseAllSaved"
      ),
      "pauseAllSaved"
    );

  if (!response.ok) {
    throw new Error(
      response.message ||
      "Saved automation scripts could not be paused."
    );
  }

  return (
    response.extra?.count ??
    0
  );
}

export async function resumeAllSavedClientScripts():
  Promise<number> {
  installTracking();

  const response =
    await wsApi.scriptRequest(
      requestId(
        "resumeAllSaved"
      ),
      "resumeAllSaved"
    );

  if (!response.ok) {
    throw new Error(
      response.message ||
      "Saved automation scripts could not be resumed."
    );
  }

  return (
    response.extra?.count ??
    0
  );
}

export async function abortAllSavedClientScripts():
  Promise<number> {
  installTracking();

  const response =
    await wsApi.scriptRequest(
      requestId(
        "abortAllSaved"
      ),
      "abortAllSaved"
    );

  if (!response.ok) {
    throw new Error(
      response.message ||
      "Saved automation scripts could not be aborted."
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
  installTracking();

  const count =
    getActiveClientScriptExecutions()
      .length;

  if (
    count > 0
  ) {
    for (
      const waiter of
      runWaiters.values()
    ) {
      waiter.aborted =
        true;
    }

    wsApi.scriptCommand(
      requestId(
        "abortAll"
      ),
      "abortAll"
    );
  }

  return count;
}

/*
 * Compatibility surface for the existing editor/UI. The browser no longer
 * evaluates JavaScript. It sends the source to the authoritative Windows
 * ScriptRuntime and waits for backend state to reach completion.
 */
export async function runClientScript(
  script: string,
  element:
    ClientScriptElementContext
): Promise<unknown> {
  installTracking();

  if (
    !script.trim()
  ) {
    return undefined;
  }


  const key =
    executionKey(
      element.id
    );

  const current =
    states.get(
      key
    );

  if (
    current?.status ===
      "running" ||
    current?.status ===
      "paused"
  ) {
    throw new Error(
      `Script "${element.name || key}" is already running.`
    );
  }

  if (
    runWaiters.has(
      key
    )
  ) {
    throw new Error(
      `Script "${element.name || key}" is already starting.`
    );
  }

  const completion =
    new Promise<unknown>(
      (
        resolve,
        reject
      ) => {
        runWaiters.set(
          key,
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

  const id =
    requestId(
      "startSource"
    );

  let response;

  try {
    response =
      await wsApi.scriptRequest(
        id,
        "startSource",
        {
          executionId:
            key,
          name:
            element.name ||
            key,
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
      key
    );

    throw error;
  }

  if (
    !response.ok
  ) {
    runWaiters.delete(
      key
    );

    throw new Error(
      response.message ||
      "Script could not be started."
    );
  }

  const waiter =
    runWaiters.get(
      key
    );

  if (waiter) {
    waiter.started =
      true;
  }

  if (
    response.extra?.state
  ) {
    applyState(
      response.extra.state
    );
  }

  return await completion;
}

installTracking();
