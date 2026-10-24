import type {
  SequentialMovementStatePayload,
  TrainDriverStatePayload,
} from "@/domain/wsTypes";
import type { MovementEngineState } from "./movementEngine";

export type LiveMovementTask = { pageId: string; state: MovementEngineState };

export type LocoTaskStatus = {
  /** Most useful live message for this locomotive, without route-counter clutter. */
  message: string;
  /** Lower priority sequence progress, e.g. "route 4/10". */
  progress: string | null;
  /** The parent task remains active even when no child Movement is running. */
  sequence: SequentialMovementStatePayload | null;
  movement: LiveMovementTask | null;
  driver: TrainDriverStatePayload | null;
};

const LIVE_SEQUENCES = new Set(["running", "waiting", "finishing"]);
const LIVE_DRIVERS = new Set(["created", "running", "waiting", "paused", "stopping"]);

export function resolveLocoTaskStatus(
  locoAddress: number,
  movements: readonly LiveMovementTask[],
  sequences: readonly SequentialMovementStatePayload[],
  drivers: readonly TrainDriverStatePayload[],
  blockName?: (id: number) => string,
): LocoTaskStatus | null {
  const sequence = [...sequences].reverse().find(item =>
    item.locoAddress === locoAddress && LIVE_SEQUENCES.has(item.status)) ?? null;
  const movement = movements
    .filter(item => item.state.locoAddress === locoAddress &&
      (item.state.status === "running" || item.state.status === "stopping"))
    .sort((a, b) =>
      Number(b.pageId.startsWith("sequence-step-")) - Number(a.pageId.startsWith("sequence-step-")) ||
      (b.state.startedAt ?? 0) - (a.state.startedAt ?? 0))[0] ?? null;
  const driver = [...drivers].reverse().find(item =>
    item.locoAddress === locoAddress && LIVE_DRIVERS.has(item.status)) ?? null;

  if (!sequence && !movement && !driver) return null;

  const sequenceInfo = sequence?.info?.trim() || "";
  const movementInfo = movement?.state.info?.trim() || "";
  const driverInfo = driver?.info?.trim() || "";
  const routeMatch = /\bRunning route\s+(\d+\s*\/\s*\d+)\b/i.exec(sequenceInfo);
  const progress = routeMatch ? `route ${routeMatch[1]!.replace(/\s/g, "")}` : null;

  // The child movement reports useful live sensor/authority messages while
  // the parent only says "Running route n/m". Between child movements the
  // parent's station dwell/wait remains authoritative.
  const usefulMovementInfo = movementInfo &&
    !/^(?:Movement started|Movement completed|Movement in progress|Running|Stopping)$/i.test(movementInfo);
  const rawMessage =
    sequence?.status === "waiting"
      ? sequenceInfo || "Waiting for next route"
      : sequence?.status === "finishing"
        ? sequenceInfo || "Finishing at next safe block"
        : usefulMovementInfo
          ? movementInfo
          : (sequenceInfo && !routeMatch)
            ? sequenceInfo
            : movementInfo && !/^(?:Movement started|Movement completed)$/i.test(movementInfo)
              ? movementInfo
              : sequence
                ? "Running sequence"
                : driver?.status === "paused"
                  ? driverInfo || "Train Driver paused"
                  : driver?.status === "waiting"
                    ? driverInfo || "Train Driver waiting"
                    : movement?.state.status === "stopping"
                      ? "Stopping"
                      : movement
                        ? movement.state.targetBlockName
                          ? `Moving to ${movement.state.targetBlockName}`
                          : "Movement running"
                        : driverInfo || `Train Driver: ${driver?.status ?? "running"}`;

  const message = blockName
    ? rawMessage.replace(/\bblock\s+#(\d+)\b/gi, (_match, id: string) =>
        blockName(Number(id)))
    : rawMessage;

  return { message, progress, sequence, movement, driver };
}

/** Resolve a block label from the last backend Movement snapshots, including
 * completed sequence legs (which still carry their known block names). */
export function movementBlockLabel(
  movements: readonly LiveMovementTask[],
  locoAddress: number,
  blockId: number,
): string {
  const recent = movements
    .filter(item => item.state.locoAddress === locoAddress)
    .sort((a, b) => (b.state.startedAt ?? 0) - (a.state.startedAt ?? 0));
  for (const item of recent) {
    if (item.state.currentBlockId === blockId && item.state.currentBlockName)
      return item.state.currentBlockName;
    if (item.state.targetBlockId === blockId && item.state.targetBlockName)
      return item.state.targetBlockName;
  }
  return `Block #${blockId}`;
}

export function formatLocoTaskStatus(status: LocoTaskStatus): string {
  return status.progress
    ? `${status.message} (${status.progress})`
    : status.message;
}
