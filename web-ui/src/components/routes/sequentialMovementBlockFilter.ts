import type { SequentialMovementStep } from "@/domain/movement";
import type { PersistedRouteTableEntry } from "@/services/clientRouteGraphCache";

/**
 * A sequence's next selectable block is the immediate next block in the
 * saved route table for the LAST selected block and its DEPARTURE direction.
 *
 * We must not search from the beginning of a sequence/leg or require that an
 * entire previous checkpoint prefix matches the same route-table entry:
 * A1 -> B1 -> C1, then C1 (reverse) -> B1 -> A1 is perfectly valid.
 * A block may also occur inside a longer saved route, not only at its start.
 */
export function reachableNextBlocks(
  steps: SequentialMovementStep[],
  index: number,
  routeTable: PersistedRouteTableEntry[],
): Set<number> {
  const next = new Set<number>();
  if (index <= 0 || index >= steps.length) return next;

  const last = steps[index - 1];
  if (!last?.blockId) return next;

  for (const route of routeTable) {
    if (route.locoDirection !== last.direction) continue;

    const path = route.blockPath;
    for (let i = 0; i < path.length - 1; i++) {
      if (path[i]?.id !== last.blockId) continue;
      const nextBlockId = path[i + 1]?.id;
      if (nextBlockId && nextBlockId !== last.blockId) {
        next.add(nextBlockId);
      }
    }
  }
  return next;
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
