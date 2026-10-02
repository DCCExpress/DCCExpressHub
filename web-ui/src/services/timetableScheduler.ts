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

type Listener =
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

  private readonly listeners =
    new Set<
      Listener
    >();

  private installed =
    false;

  private sequence =
    0;

  constructor() {
    this.install();
  }

  private requestId(
    action: string
  ): string {
    this.sequence +=
      1;

    return (
      `${wsApi.clientUuid}:timetable:` +
      `${action}:${Date.now()}:${this.sequence}`
    );
  }

  private apply(
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
      raw as Partial<TimetableSchedulerState>;

    this.state = {
      running:
        Boolean(
          value.running
        ),
      lastTriggeredAt:
        value.lastTriggeredAt ??
        null,
      lastTriggeredTargetName:
        value.lastTriggeredTargetName ??
        null,
      activeRuns:
        Array.isArray(
          value.activeRuns
        )
          ? value.activeRuns.map(
              run => ({
                ...run,
              })
            )
          : [],
    };

    this.emit();
  }

  private send(
    action: string,
    values:
      Record<string, unknown> =
        {}
  ): boolean {
    return wsApi.sendBackendCommand(
      "timetableCommand",
      {
        requestId:
          this.requestId(
            action
          ),
        action,
        ...values,
      }
    );
  }

  private install():
    void {
    if (this.installed) {
      return;
    }

    this.installed =
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
            "timetableStateChanged"
        ) {
          this.apply(
            raw.data
          );
          return;
        }

        if (
          raw.type ===
            "timetableResponse"
        ) {
          const response =
            raw.data as {
              state?: unknown;
            };

          if (
            response?.state
          ) {
            this.apply(
              response.state
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
          this.send(
            "snapshot"
          );
        }
      }
    );

    if (
      wsClient.getStatus() ===
        "connected"
    ) {
      this.send(
        "snapshot"
      );
    }
  }

  configure(
    _scripts:
      AutomationScriptDefinition[],
    _movements:
      MovementPage[],
    _timetable:
      TimetableEntryDefinition[]
  ): void {
    this.send(
      "snapshot"
    );
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
      Listener
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

    this.send(
      "start"
    );
  }

  stop(): void {
    this.install();

    this.send(
      "stop"
    );
  }

  rebase(): void {
    this.install();

    this.send(
      "rebase"
    );
  }

  private emit():
    void {
    const snapshot =
      this.getState();

    for (
      const listener of
      this.listeners
    ) {
      listener(
        snapshot
      );
    }
  }
}

export const timetableScheduler =
  new TimetableScheduler();
