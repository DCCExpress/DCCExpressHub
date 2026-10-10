import type {
  MovementPage,
} from "../domain/movement";

import {
  wsApi,
} from "./wsApi";

import {
  wsClient,
} from "./wsClient";

import {
  isTrackPowerOn,
} from "./trackPowerRuntime";

import {
  loadAutomationMovement,
  saveAutomationMovement,
} from "./automationApi";

export type MovementEngineStatus =
  | "idle"
  | "running"
  | "stopping"
  | "error";

export type MovementEngineState = {
  movementName?: string | undefined;
  routeDescription?: string | null | undefined;
  currentBlockName?: string | null | undefined;
  targetBlockName?: string | null | undefined;
  status: MovementEngineStatus;
  startedAt: number | null;
  stoppedAt: number | null;
  locoAddress: number | null;
  desiredSpeed: number;
  currentBlockId?: number | null;
  targetBlockId?: number | null;
  currentResourceKey: string | null;
  activeRouteResourceKey: string | null;
  info: string | null;
  error: string | null;
};

type BackendMovementState =
  MovementEngineState & {
    pageId: string;
  };

type StateListener =
  (
    state:
      MovementEngineState
  ) => void;

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

const allStateListeners = new Set<() => void>();

export function getMovementTaskStates(): Array<{ pageId: string; state: MovementEngineState }> {
  installTracking();
  return Array.from(states, ([pageId, state]) => ({ pageId, state: copyState(state) }));
}

export function subscribeMovementTaskStates(listener: () => void): () => void {
  installTracking();
  allStateListeners.add(listener);
  listener();
  return () => { allStateListeners.delete(listener); };
}

function notifyAllStateListeners(): void {
  for (const listener of allStateListeners) listener();
}

let installed =
  false;

let requestSequence =
  0;

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
    currentBlockId: null,
    targetBlockId: null,
    currentResourceKey:
      null,
    activeRouteResourceKey:
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

function applyBackendState(
  state:
    BackendMovementState
): void {
  if (
    !state ||
    typeof state.pageId !==
      "string" ||
    !state.pageId
  ) {
    return;
  }

  const next:
    MovementEngineState = {
    movementName: state.movementName,
    routeDescription: state.routeDescription,
    currentBlockName: state.currentBlockName,
    targetBlockName: state.targetBlockName,
    status:
      state.status,
    startedAt:
      state.startedAt,
    stoppedAt:
      state.stoppedAt,
    locoAddress:
      state.locoAddress,
    desiredSpeed:
      state.desiredSpeed,
    currentBlockId: state.currentBlockId ?? null,
    targetBlockId: state.targetBlockId ?? null,
    currentResourceKey:
      state.currentResourceKey,
    activeRouteResourceKey:
      state.activeRouteResourceKey,
    info:
      state.info,
    error:
      state.error,
  };

  states.set(
    state.pageId,
    next
  );

  notifyAllStateListeners();

  for (
    const listener of
    listeners.get(
      state.pageId
    ) ??
    []
  ) {
    listener(
      copyState(
        next
      )
    );
  }
}

function requestId(
  action: string
): string {
  requestSequence +=
    1;

  return (
    `${wsApi.clientUuid}:movement:` +
    `${action}:` +
    `${Date.now()}:` +
    `${requestSequence}`
  );
}

function requestSnapshot():
  void {
  wsApi.movementCommand(
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
    "movementStateChanged",
    data => {
      applyBackendState(
        data as
          BackendMovementState
      );
    }
  );

  wsClient.on(
    "movementSnapshot",
    data => {
      for (
        const state of
        data.states
      ) {
        applyBackendState(
          state as
            BackendMovementState
        );
      }
    }
  );

  wsClient.on(
    "movementResponse",
    data => {
      const extra =
        data.extra;

      if (
        extra?.state
      ) {
        applyBackendState(
          extra.state as
            BackendMovementState
        );
      }

      for (
        const state of
        extra?.states ??
        []
      ) {
        applyBackendState(
          state as
            BackendMovementState
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

export function getMovementEngineState(
  pageId: string
): MovementEngineState {
  installTracking();

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
  installTracking();

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

/*
 * The browser no longer executes Movement.
 *
 * It sends only the selected Movement ID to the Windows backend.
 * The backend reloads the saved Movement definition and rebuilds its physical
 * route plan from persisted layout.json, so definition, plan selection, safety,
 * Dispatcher authority, turnout control, sensor waits, block transitions,
 * actions and throttle commands are authoritative.
 */
export async function startMovement(
  page:
    MovementPage
): Promise<void> {
  installTracking();

  if (
    getMovementEngineState(
      page.id
    ).status ===
      "running"
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

  const stored =
    await loadAutomationMovement();

  const existingIndex =
    stored.pages.findIndex(
      item =>
        item.id === page.id
    );

  const pages =
    existingIndex >= 0
      ? stored.pages.map(
          item =>
            item.id === page.id
              ? page
              : item
        )
      : [
          ...stored.pages,
          page,
        ];

  await saveAutomationMovement({
    ...stored,
    pages,
    activePageId:
      stored.activePageId ||
      page.id,
  });

  const id =
    requestId(
      "start"
    );

  const response =
    await wsApi.request(
      "movementCommand",
      {
        requestId:
          id,
        action:
          "start",
        pageId:
          page.id,
      },
      "movementResponse",
      data =>
        data.requestId ===
          id,
      10000
    );

  if (
    !response.ok
  ) {
    throw new Error(
      response.message ||
      "Movement could not be started."
    );
  }

  if (
    response.extra?.state
  ) {
    applyBackendState(
      response.extra.state as
        BackendMovementState
    );
  }
}

export function stopMovement(
  pageId: string
): boolean {
  installTracking();

  const current =
    getMovementEngineState(
      pageId
    );

  if (
    current.status !==
      "running" &&
    current.status !==
      "stopping"
  ) {
    return false;
  }

  const sent =
    wsApi.movementCommand(
      requestId(
        "stop"
      ),
      "stop",
      {
        pageId,
      }
    );

  if (sent) {
    const next = {
      ...current,
      status:
        "stopping" as const,
      desiredSpeed:
        0,
      info:
        "Stopping Movement...",
    };

    states.set(
      pageId,
      next
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
          next
        )
      );
    }
  }

  return sent;
}

export function abortMovement(
  pageId: string,
  requestEmergencyStop =
    true
): boolean {
  installTracking();

  const current =
    getMovementEngineState(
      pageId
    );

  if (
    current.status !==
      "running" &&
    current.status !==
      "stopping"
  ) {
    return false;
  }

  return wsApi.movementCommand(
    requestId(
      "abort"
    ),
    "abort",
    {
      pageId,
      emergencyStop:
        requestEmergencyStop,
    }
  );
}

export function stopAllMovements():
  boolean {
  installTracking();

  return wsApi.movementCommand(
    requestId(
      "stopAll"
    ),
    "stopAll"
  );
}

export function abortAllMovements():
  boolean {
  installTracking();

  return wsApi.movementCommand(
    requestId(
      "abortAll"
    ),
    "abortAll"
  );
}

installTracking();
