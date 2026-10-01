import type {
  AutomationScriptDefinition,
  TimetableEntryDefinition,
  TimetableTargetType,
} from "@/services/automationApi";

import type {
  MovementPage,
} from "@/domain/movement";

import {
  isControlStationRuntimeActive,
} from "@/services/controlStationRuntime";

import {
  runClientScript,
  ScriptAbortError,
  subscribeClientScriptState,
} from "@/services/clientScriptRunner";

import {
  subscribeSharedScriptInfo,
} from "@/services/scriptInfoRuntime";

import {
  wsApi,
} from "@/services/wsApi";

import {
  wsClient,
} from "@/services/wsClient";

export type TimetableRunStatus =
  | "launching"
  | "running"
  | "paused";

export type TimetableActiveRun = {
  id: string;
  timetableEntryId: string;
  timetableActionId: string;
  targetType:
    TimetableTargetType;
  targetId: string;
  targetName: string;
  executionId:
    string | null;
  scheduledTime: string;
  scheduledMinuteOfDay: number;
  status:
    TimetableRunStatus;
  message: string | null;
};

export type TimetableSchedulerState = {
  running: boolean;
  lastTriggeredAt:
    string | null;
  lastTriggeredTargetName:
    string | null;
  activeRuns:
    TimetableActiveRun[];
};

type TimetableSchedulerListener =
  (
    state:
      TimetableSchedulerState
  ) => void;

const emptyState =
  (): TimetableSchedulerState => ({
    running:
      false,
    lastTriggeredAt:
      null,
    lastTriggeredTargetName:
      null,
    activeRuns:
      [],
  });

class TimetableScheduler {
  private state:
    TimetableSchedulerState =
      emptyState();

  private listeners =
    new Set<
      TimetableSchedulerListener
    >();

  private installed =
    false;

  private requestSequence =
    0;

  constructor() {
    this.install();
  }

  private requestId(
    action: string
  ): string {
    this.requestSequence +=
      1;

    return (
      `${wsApi.clientUuid}:timetable:` +
      `${action}:` +
      `${Date.now()}:` +
      `${this.requestSequence}`
    );
  }

  private applyState(
    state:
      TimetableSchedulerState
  ): void {
    this.state = {
      running:
        Boolean(
          state.running
        ),
      lastTriggeredAt:
        state.lastTriggeredAt ??
        null,
      lastTriggeredTargetName:
        state.lastTriggeredTargetName ??
        null,
      activeRuns:
        (
          state.activeRuns ??
          []
        ).map(
          run => ({
            ...run,
          })
        ),
    };

    this.emit();
  }

  private install():
    void {
    if (this.installed) {
      return;
    }

    this.installed =
      true;

    wsClient.on(
      "timetableStateChanged",
      state => {
        this.applyState(
          state
        );
      }
    );

    wsClient.on(
      "timetableResponse",
      response => {
        if (
          response.state
        ) {
          this.applyState(
            response.state
          );
        }
      }
    );

    wsClient.on(
      "timetableScriptRequested",
      request => {
        /*
         * Timetable timing/decision is backend-authoritative.
         * Only the active Control Station is allowed to execute the existing
         * browser JavaScript worker requested by that backend decision.
         */
        if (
          !isControlStationRuntimeActive()
        ) {
          return;
        }

        let started =
          false;

        let currentStatus:
          "running" |
          "paused" =
          "running";

        let currentMessage:
          string | null =
          null;

        const reportStatus =
          (): void => {
            wsApi.timetableScriptStatus(
              request.runId,
              currentStatus,
              currentMessage
            );
          };

        const unsubscribeState =
          subscribeClientScriptState(
            request.executionId,
            state => {
              if (
                state.status !==
                  "running" &&
                state.status !==
                  "paused"
              ) {
                return;
              }

              started =
                true;

              currentStatus =
                state.status;

              reportStatus();
            }
          );

        const unsubscribeInfo =
          subscribeSharedScriptInfo(
            request.executionId,
            message => {
              /*
               * Ignore stale text left from an older/manual run until the
               * newly requested worker execution has actually registered.
               */
              if (
                !started &&
                message
              ) {
                return;
              }

              currentMessage =
                message ||
                null;

              if (started) {
                reportStatus();
              }
            }
          );

        void runClientScript(
          request.script,
          {
            id:
              request.executionId,
            name:
              request.name,
            type:
              "automation",
          }
        )
          .then(
            () => {
              wsApi.timetableScriptComplete(
                request.runId,
                true
              );
            }
          )
          .catch(
            error => {
              const aborted =
                error instanceof
                  ScriptAbortError;

              wsApi.timetableScriptComplete(
                request.runId,
                aborted,
                error instanceof
                  Error
                  ? error.message
                  : String(
                      error
                    )
              );
            }
          )
          .finally(
            () => {
              unsubscribeState();
              unsubscribeInfo();
            }
          );
      }
    );

    wsClient.subscribeStatus(
      status => {
        if (
          status ===
            "connected"
        ) {
          this.requestSnapshot();
        }
      }
    );

    this.requestSnapshot();
  }

  private requestSnapshot():
    void {
    wsApi.timetableCommand(
      this.requestId(
        "snapshot"
      ),
      "snapshot"
    );
  }

  /*
   * Kept for component/API compatibility.
   *
   * The backend reads automations.json directly, therefore it does not accept
   * an execution copy from the browser. Saving the editor document remains the
   * only way to change the authoritative timetable/Movement definitions.
   */
  configure(
    _scripts:
      AutomationScriptDefinition[],
    _movements:
      MovementPage[],
    _timetable:
      TimetableEntryDefinition[]
  ): void {
    this.requestSnapshot();
  }

  getState():
    TimetableSchedulerState {
    this.install();

    return {
      ...this.state,
      activeRuns:
        this.state.activeRuns.map(
          run => ({
            ...run,
          })
        ),
    };
  }

  subscribe(
    listener:
      TimetableSchedulerListener
  ): () => void {
    this.install();

    this.listeners.add(
      listener
    );

    listener(
      this.getState()
    );

    return () => {
      this.listeners.delete(
        listener
      );
    };
  }

  start(): void {
    this.install();

    if (
      !isControlStationRuntimeActive()
    ) {
      return;
    }

    wsApi.timetableCommand(
      this.requestId(
        "start"
      ),
      "start"
    );
  }

  stop(): void {
    this.install();

    if (
      !isControlStationRuntimeActive()
    ) {
      return;
    }

    wsApi.timetableCommand(
      this.requestId(
        "stop"
      ),
      "stop"
    );
  }

  rebase(): void {
    this.install();

    if (
      !isControlStationRuntimeActive()
    ) {
      return;
    }

    wsApi.timetableCommand(
      this.requestId(
        "rebase"
      ),
      "rebase"
    );
  }

  private emit(): void {
    const state =
      this.getState();

    for (
      const listener of
      this.listeners
    ) {
      listener(
        state
      );
    }
  }
}

export const timetableScheduler =
  new TimetableScheduler();
