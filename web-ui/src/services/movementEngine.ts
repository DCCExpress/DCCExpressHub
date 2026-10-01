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
  isControlStationRuntimeActive,
} from "./controlStationRuntime";

import {
  isTrackPowerOn,
} from "./trackPowerRuntime";

export type MovementEngineStatus =
  | "idle"
  | "running"
  | "stopping"
  | "error";

export type MovementEngineState = {
  status: MovementEngineStatus;
  startedAt: number | null;
  stoppedAt: number | null;
  locoAddress: number | null;
  desiredSpeed: number;
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
 * It sends only the selected Movement definition to the Windows backend.
 * The backend rebuilds the physical route plan from persisted layout.json, so
 * all plan selection, safety, Dispatcher authority, turnout control, sensor
 * waits, block transitions, actions and throttle commands are authoritative.
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

  if (
    !isControlStationRuntimeActive()
  ) {
    throw new Error(
      "This browser is not the active Control Station."
    );
  }

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
        page,
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

installTracking();
