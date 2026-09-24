import {
  timetableCronMatches,
} from "@/domain/timetableCron";

import type {
  AutomationScriptDefinition,
  TimetableEntryDefinition,
} from "@/services/automationApi";

import {
  fastClockStore,
} from "@/services/fastClockStore";

import {
  getAutomationFinishing,
  getClientScriptState,
  runClientScript,
  ScriptAbortError,
  subscribeClientScriptState,
} from "@/services/clientScriptRunner";

import {
  subscribeSharedScriptInfo,
} from "@/services/scriptInfoRuntime";

const MINUTE_MS = 60 * 1000;
const MINUTES_PER_DAY = 24 * 60;
const DAY_MS = MINUTES_PER_DAY * MINUTE_MS;

/**
 * Catch up ordinary accelerated FastClock jumps, but never replay an unlimited
 * amount of historical timetable after a reset/reconnect/long browser sleep.
 */
const MAX_CATCH_UP_MINUTES = 180;
const MAX_CATCH_UP_MS = MAX_CATCH_UP_MINUTES * MINUTE_MS;
const WATCH_INTERVAL_MS = 250;

type TimetableSchedulerListener =
  (state: TimetableSchedulerState) => void;

export type TimetableRunStatus =
  | "launching"
  | "running"
  | "paused";

/**
 * One concrete run launched from one concrete timetable occurrence.
 * This is intentionally separate from the script definition because the same
 * script may appear at several timetable times.
 */
export type TimetableActiveRun = {
  id: string;
  timetableEntryId: string;
  scriptId: string;
  scriptName: string;
  executionId: string;
  scheduledTime: string;
  scheduledMinuteOfDay: number;
  status: TimetableRunStatus;
  message: string | null;
};

export type TimetableSchedulerState = {
  running: boolean;
  lastTriggeredAt: string | null;
  lastTriggeredScriptName: string | null;
  activeRuns: TimetableActiveRun[];
};

class TimetableScheduler {
  private running = false;
  private timerId: number | null = null;
  private previousFastClockTimeMs: number | null = null;

  private scripts: AutomationScriptDefinition[] = [];
  private timetable: TimetableEntryDefinition[] = [];

  private listeners =
    new Set<TimetableSchedulerListener>();

  /** Guards the async gap before runClientScript registers its execution. */
  private launchingScriptIds =
    new Set<string>();

  private activeRuns =
    new Map<string, TimetableActiveRun>();

  private nextRunSequence = 1;

  private lastTriggeredAt: string | null = null;
  private lastTriggeredScriptName: string | null = null;

  configure(
    scripts: AutomationScriptDefinition[],
    timetable: TimetableEntryDefinition[]
  ): void {
    this.scripts = scripts.map(script => ({ ...script }));
    this.timetable = timetable.map(entry => ({ ...entry }));
  }

  getState(): TimetableSchedulerState {
    return {
      running: this.running,
      lastTriggeredAt: this.lastTriggeredAt,
      lastTriggeredScriptName: this.lastTriggeredScriptName,
      activeRuns: [...this.activeRuns.values()].map(run => ({ ...run })),
    };
  }

  subscribe(
    listener: TimetableSchedulerListener
  ): () => void {
    this.listeners.add(listener);
    listener(this.getState());

    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;

    // Baseline exactly where Start was pressed. A schedule matching the
    // already-partially-elapsed current minute is deliberately NOT replayed.
    this.rebase();

    this.timerId = window.setInterval(
      () => this.tick(),
      WATCH_INTERVAL_MS
    );

    this.emit();
  }

  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.previousFastClockTimeMs = null;

    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }

    // Intentionally do not abort scripts that were already launched. Stop only
    // stops future timetable starts. Their active-run rows stay visible until
    // those scripts actually finish.
    this.emit();
  }

  /**
   * Forget all elapsed FastClock time and continue from the current instant.
   * Useful after an explicit clock reset/change so old slots are not replayed.
   */
  rebase(): void {
    const view = fastClockStore.getViewState();

    this.previousFastClockTimeMs =
      view.connected && view.snapshot
        ? this.normalizeDayTime(view.snapshot.timeMs)
        : null;
  }

  private tick(): void {
    if (!this.running) {
      return;
    }

    const view = fastClockStore.getViewState();
    const snapshot = view.snapshot;

    if (!view.connected || !snapshot) {
      // On reconnect we establish a fresh baseline: missed/past departures are
      // never replayed merely because the WebUI was disconnected.
      this.previousFastClockTimeMs = null;
      return;
    }

    const current = this.normalizeDayTime(snapshot.timeMs);

    if (!snapshot.running) {
      // Clock adjustments while paused are configuration changes, not elapsed
      // timetable time. Keep moving the baseline without starting anything.
      this.previousFastClockTimeMs = current;
      return;
    }

    const previous = this.previousFastClockTimeMs;
    this.previousFastClockTimeMs = current;

    if (previous === null) {
      return;
    }

    const forwardDelta =
      current >= previous
        ? current - previous
        : DAY_MS - previous + current;

    if (forwardDelta <= 0) {
      return;
    }

    if (forwardDelta > MAX_CATCH_UP_MS) {
      // Treat very large jumps as reset/discontinuity. Replaying hours of old
      // timetable entries would be much more dangerous than skipping them.
      return;
    }

    const previousMinute = Math.floor(previous / MINUTE_MS);
    let currentAbsoluteMinute = Math.floor(current / MINUTE_MS);

    if (current < previous) {
      // Legitimate midnight wrap. The small forwardDelta check above filters
      // ordinary backwards/reset jumps before they can become historical runs.
      currentAbsoluteMinute += MINUTES_PER_DAY;
    }

    if (currentAbsoluteMinute <= previousMinute) {
      return;
    }

    for (
      let absoluteMinute = previousMinute + 1;
      absoluteMinute <= currentAbsoluteMinute;
      absoluteMinute += 1
    ) {
      this.processMinute(absoluteMinute);
    }
  }

  private processMinute(
    absoluteMinute: number
  ): void {
    if (getAutomationFinishing()) {
      // Finishing means: let existing sequences finish, but do not start a new
      // timetable sequence. This slot is intentionally skipped, not queued.
      return;
    }

    const minuteOfDay =
      ((absoluteMinute % MINUTES_PER_DAY) + MINUTES_PER_DAY) %
      MINUTES_PER_DAY;

    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;

    const scriptsById = new Map(
      this.scripts.map(script => [script.id, script] as const)
    );

    for (const entry of this.timetable) {
      if (
        !entry.enabled ||
        !timetableCronMatches(entry.cron, hour, minute)
      ) {
        continue;
      }

      const script = scriptsById.get(entry.scriptId);

      if (!script || !script.script.trim()) {
        console.warn(
          `[Timetable] ${this.formatTime(hour, minute)} skipped: script ` +
          `"${entry.scriptId}" is missing or empty.`
        );
        continue;
      }

      this.launchScript(entry, script, hour, minute, minuteOfDay);
    }
  }

  private launchScript(
    entry: TimetableEntryDefinition,
    script: AutomationScriptDefinition,
    hour: number,
    minute: number,
    scheduledMinuteOfDay: number
  ): void {
    const executionId =
      `automation:${script.id}`;

    const currentState =
      getClientScriptState(executionId);

    if (
      currentState.status !== "idle" ||
      this.launchingScriptIds.has(script.id)
    ) {
      console.info(
        `[Timetable] ${this.formatTime(hour, minute)} skipped: ` +
        `"${script.name}" is already active.`
      );
      return;
    }

    this.launchingScriptIds.add(script.id);

    const runId =
      `timetable-run-${this.nextRunSequence}`;

    this.nextRunSequence += 1;

    const activeRun: TimetableActiveRun = {
      id: runId,
      timetableEntryId: entry.id,
      scriptId: script.id,
      scriptName: script.name,
      executionId,
      scheduledTime: this.formatTime(hour, minute),
      scheduledMinuteOfDay,
      status: "launching",
      message: null,
    };

    this.activeRuns.set(runId, activeRun);

    this.lastTriggeredAt = activeRun.scheduledTime;
    this.lastTriggeredScriptName = script.name;
    this.emit();

    const unsubscribeState =
      subscribeClientScriptState(
        executionId,
        state => {
          const currentRun = this.activeRuns.get(runId);

          if (!currentRun) {
            return;
          }

          if (state.status === "running") {
            if (currentRun.status !== "running") {
              currentRun.status = "running";
              this.emit();
            }

            return;
          }

          if (state.status === "paused") {
            if (currentRun.status !== "paused") {
              currentRun.status = "paused";
              this.emit();
            }
          }
        }
      );

    const unsubscribeInfo =
      subscribeSharedScriptInfo(
        executionId,
        message => {
          const currentRun = this.activeRuns.get(runId);

          if (!currentRun) {
            return;
          }

          // While launch is still pending there may be an old shared message
          // left from a previous/manual run. runClientScript claims and clears
          // the execution info before the new Worker starts, so ignore stale
          // non-empty text until this run is actually registered as running.
          if (
            currentRun.status === "launching" &&
            message
          ) {
            return;
          }

          if (currentRun.message !== message) {
            currentRun.message = message;
            this.emit();
          }
        }
      );

    void runClientScript(
      script.script,
      {
        id: executionId,
        name: script.name,
        type: "automation",
      }
    )
      .catch(error => {
        if (error instanceof ScriptAbortError) {
          return;
        }

        console.error(
          `[Timetable] Script "${script.name}" failed:`,
          error
        );
      })
      .finally(() => {
        unsubscribeState();
        unsubscribeInfo();
        this.launchingScriptIds.delete(script.id);
        this.activeRuns.delete(runId);
        this.emit();
      });
  }

  private normalizeDayTime(
    value: number
  ): number {
    const normalized = value % DAY_MS;
    return normalized < 0 ? normalized + DAY_MS : normalized;
  }

  private formatTime(
    hour: number,
    minute: number
  ): string {
    return (
      `${String(hour).padStart(2, "0")}:` +
      `${String(minute).padStart(2, "0")}`
    );
  }

  private emit(): void {
    const state = this.getState();

    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

export const timetableScheduler =
  new TimetableScheduler();
