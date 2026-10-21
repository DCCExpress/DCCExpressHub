import type { SequentialMovementStep } from "@/domain/movement";
import type { PersistedRouteTableEntry } from "@/services/clientRouteGraphCache";

/**
 * The next destination is part of the uninterrupted run since the last stop.
 * At a reversing stop (e.g. C1 after A1 -> B1 -> C1), C1 becomes the
 * departure block for the new reverse leg.
 */
function segmentStartIndex(steps: SequentialMovementStep[], nextIndex: number): number {
  for (let i = nextIndex - 1; i > 0; i--) {
    if (steps[i]?.waitMode !== "pass") return i;
  }
  return 0;
}

/**
 * Returns the last index of the ordered prefix on this physical route.
 * A selected intermediate block is a checkpoint, not necessarily the
 * routeTable entry's final destination.
 */
function lastCheckpointIndex(blockPath: PersistedRouteTableEntry["blockPath"], prefix: number[]): number {
  let matched = 0;
  let lastIndex = -1;
  for (let i = 0; i < blockPath.length && matched < prefix.length; i++) {
    if (blockPath[i]?.id === prefix[matched]) {
      lastIndex = i;
      matched++;
    }
  }
  return matched === prefix.length ? lastIndex : -1;
}

/** Only offer blocks reachable AFTER the selected checkpoints, in the actual departure direction. */
export function reachableNextBlocks(
  steps: SequentialMovementStep[],
  index: number,
  routeTable: PersistedRouteTableEntry[],
): Set<number> {
  if (index <= 0 || index >= steps.length) return new Set<number>();
  const start = segmentStartIndex(steps, index);
  const source = steps[start];
  const previous = steps[index - 1];
  if (!source?.blockId || !previous?.blockId) return new Set<number>();

  const prefix = steps.slice(start, index).map(step => step.blockId);
  if (prefix.some(id => !id)) return new Set<number>();

  const result = new Set<number>();
  for (const route of routeTable) {
    if (route.fromBlockId !== source.blockId ||
        route.locoDirection !== source.direction) continue;

    const lastIndex = lastCheckpointIndex(route.blockPath, prefix);
    if (lastIndex < 0) continue;

    // The old filter only offered route.toBlockId, dropping B1 from
    // C1 -> B1 -> A1 whenever the saved entry ended at A1.
    for (const block of route.blockPath.slice(lastIndex + 1)) {
      if (block.id > 0 && block.id !== previous.blockId) result.add(block.id);
    }
  }

  // A closed circuit may return to its start after an intermediate stop.
  // A same-source-and-destination Movement without a stop is not supported.
  if (index >= 2 && source.blockId !== previous.blockId &&
      routeTable.some(route => route.fromBlockId === previous.blockId &&
        route.toBlockId === source.blockId &&
        route.locoDirection === previous.direction)) {
    result.add(source.blockId);
  }
  return result;
}

/** Changing departure direction at a block requires a stop, never a Pass. */
export function normalizeReversals(steps: SequentialMovementStep[]): SequentialMovementStep[] {
  return steps.map((step, i): SequentialMovementStep => {
    if (i > 0 && i < steps.length - 1 &&
        steps[i - 1]?.direction !== step.direction && step.waitMode === "pass") {
      return { ...step, waitMode: "fixed", waitSeconds: 0 };
    }
    return step;
  });
}
