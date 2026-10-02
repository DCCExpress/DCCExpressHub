import {
  wsApi,
} from "./wsApi";

import {
  wsClient,
} from "./wsClient";

import {
  clearTrainTrackingPredictions,
  replaceTrainTrackingPredictions,
} from "./trainTrackingPredictionRuntime";

type TrackingLogLevel =
  | "info"
  | "match"
  | "warn"
  | "error";

export type LocoTrackingConfidence =
  | "certain"
  | "likely"
  | "ambiguous";

export type LocoTrackingState = {
  locoAddress: number;
  locoId: string | null;
  currentBlockId: number | null;
  currentBlockName: string | null;
  currentSensors: number[];
  currentSectionParts: string[];
  predictedNextBlockId: number | null;
  predictedNextBlockName: string | null;
  lastSensor: number | null;
  recentSensorPath: number[];
  confidence: LocoTrackingConfidence;
  updatedAt: number;
};

export type TrainTrackingLogEntry = {
  id: string;
  timestamp: number;
  level: TrackingLogLevel;
  message: string;
};

export type TrainTrackingState = {
  enabled: boolean;
  active: boolean;
  ready: boolean;
  readinessIssues: string[];
  readinessWarnings: string[];
  locos: LocoTrackingState[];
  logs: TrainTrackingLogEntry[];
};

type Listener =
  (
    state:
      TrainTrackingState
  ) => void;

const emptyState =
  (): TrainTrackingState => ({
    enabled:
      false,
    active:
      false,
    ready:
      false,
    readinessIssues:
      [],
    readinessWarnings:
      [],
    locos:
      [],
    logs:
      [],
  });

let state =
  emptyState();

let installed =
  false;

let sequence =
  0;

const listeners =
  new Set<
    Listener
  >();

function requestId(
  action: string
): string {
  sequence += 1;

  return (
    `${wsApi.clientUuid}:tracking:` +
    `${action}:${Date.now()}:${sequence}`
  );
}

function normalize(
  raw: unknown
): TrainTrackingState {
  const value =
    raw &&
    typeof raw ===
      "object"
      ? raw as Partial<TrainTrackingState>
      : {};

  return {
    enabled:
      Boolean(
        value.enabled
      ),
    active:
      Boolean(
        value.active
      ),
    ready:
      Boolean(
        value.ready
      ),
    readinessIssues:
      Array.isArray(
        value.readinessIssues
      )
        ? value.readinessIssues
            .map(String)
        : [],
    readinessWarnings:
      Array.isArray(
        value.readinessWarnings
      )
        ? value.readinessWarnings
            .map(String)
        : [],
    locos:
      Array.isArray(
        value.locos
      )
        ? value.locos.map(
            item => ({
              ...item,
              currentSensors:
                [
                  ...(
                    item.currentSensors ??
                    []
                  ),
                ],
              currentSectionParts:
                [
                  ...(
                    item.currentSectionParts ??
                    []
                  ),
                ],
              recentSensorPath:
                [
                  ...(
                    item.recentSensorPath ??
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
            item => ({
              ...item,
            })
          )
        : [],
  };
}

function syncPredictions():
  void {
  if (
    !state.active
  ) {
    clearTrainTrackingPredictions();
    return;
  }

  replaceTrainTrackingPredictions(
    state.locos
      .filter(
        loco =>
          loco.predictedNextBlockId !==
            null &&
          loco.predictedNextBlockId !==
            loco.currentBlockId
      )
      .map(
        loco => ({
          blockId:
            loco.predictedNextBlockId!,
          blockName:
            loco.predictedNextBlockName,
          locoAddress:
            loco.locoAddress,
        })
      )
  );
}

function emit():
  void {
  syncPredictions();

  const snapshot =
    getTrainTrackingState();

  for (
    const listener of
    listeners
  ) {
    listener(
      snapshot
    );
  }
}

function apply(
  raw: unknown
): void {
  state =
    normalize(
      raw
    );

  emit();
}

function send(
  action: string,
  values:
    Record<string, unknown> =
      {}
): boolean {
  return wsApi.send(
    "trainTrackingCommand",
    {
      requestId:
        requestId(
          action
        ),
      action:
        action as
          | "snapshot"
          | "setEnabled"
          | "refresh"
          | "reset"
          | "clearLogs",
      ...values,
    }
  );
}

export function installTrainTrackingRuntime():
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
          "trainTrackingChanged"
      ) {
        apply(
          raw.data
        );
        return;
      }

      if (
        raw.type ===
          "trainTrackingResponse"
      ) {
        const response =
          raw.data as {
            snapshot?: unknown;
          };

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

export function setTrainTrackingEnabled(
  value: boolean
): void {
  installTrainTrackingRuntime();

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

export function clearTrainTrackingLogs():
  void {
  installTrainTrackingRuntime();

  send(
    "clearLogs"
  );
}

export function resetTrainTrackingState():
  void {
  installTrainTrackingRuntime();

  send(
    "reset"
  );
}

export function getLocoTrackingState(
  locoAddress: number
): LocoTrackingState | null {
  installTrainTrackingRuntime();

  return (
    state.locos.find(
      loco =>
        loco.locoAddress ===
        locoAddress
    ) ??
    null
  );
}

export function getLocoAtSensor(
  sensorAddress: number
): LocoTrackingState | null {
  installTrainTrackingRuntime();

  return (
    state.locos.find(
      loco =>
        loco.currentSensors.includes(
          sensorAddress
        ) ||
        loco.lastSensor ===
          sensorAddress
    ) ??
    null
  );
}

export function getTrainTrackingState():
  TrainTrackingState {
  installTrainTrackingRuntime();

  return {
    ...state,
    readinessIssues:
      [
        ...state.readinessIssues,
      ],
    readinessWarnings:
      [
        ...state.readinessWarnings,
      ],
    locos:
      state.locos.map(
        loco => ({
          ...loco,
          currentSensors:
            [
              ...loco.currentSensors,
            ],
          currentSectionParts:
            [
              ...loco.currentSectionParts,
            ],
          recentSensorPath:
            [
              ...loco.recentSensorPath,
            ],
        })
      ),
    logs:
      state.logs.map(
        entry => ({
          ...entry,
        })
      ),
  };
}

export function subscribeTrainTrackingState(
  listener:
    Listener
): () => void {
  installTrainTrackingRuntime();

  listeners.add(
    listener
  );

  listener(
    getTrainTrackingState()
  );

  return () => {
    listeners.delete(
      listener
    );
  };
}

export function refreshTrainTracking():
  void {
  installTrainTrackingRuntime();

  send(
    "refresh"
  );
}

installTrainTrackingRuntime();
