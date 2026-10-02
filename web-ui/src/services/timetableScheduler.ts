import type {
  AutomationScriptDefinition,
  TimetableEntryDefinition,
  TimetableTargetType,
} from "@/services/automationApi";

import type {
  MovementPage,
} from "@/domain/movement";

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

    wsApi.timetableCommand(
      this.requestId(
        "start"
      ),
      "start"
    );
  }

  stop(): void {
    this.install();

    wsApi.timetableCommand(
      this.requestId(
        "stop"
      ),
      "stop"
    );
  }

  rebase(): void {
    this.install();

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
