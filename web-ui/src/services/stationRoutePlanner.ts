import type { LayoutView } from "@/models/editor/core/LayoutView";
import { BlockElement } from "@/models/editor/elements/BlockElement";
import { createCurrentClientLayoutSnapshot } from "@/services/clientRouteGraphCache";
import type { StationRouteDefinition } from "@/domain/layout/stationRoutes";

export type StationRoutePlan = {
  direction: "forward" | "reverse";
  blockIds: number[];
  blockNames: string[];
};

/**
 * Preview the same COMPLETE, direction-aware routeTable entries that the
 * Movement Engine can actually execute. A graph reachability check between
 * isolated waypoints is insufficient: it can join incompatible directions
 * and omit intermediate blocks (e.g. falsely preview C3 -> B1 -> A3).
 */
export function previewStationRoute(
  layout: LayoutView,
  route: StationRouteDefinition,
  limit = 24
): StationRoutePlan[] {
  const topology = createCurrentClientLayoutSnapshot(layout).routeTopology;
  if (!topology || !Array.isArray(topology.routeTable)) return [];

  const blocks = layout.blocks.elements.filter((b): b is BlockElement => b instanceof BlockElement);
  const stationIds = (id: string) => new Set(blocks.filter(b => b.stationId === id).map(b => b.id));
  const plans: StationRoutePlan[] = [];
  const seen = new Set<string>();

  for (const direction of (route.allowReverse ? ["forward", "reverse"] : ["forward"]) as Array<"forward" | "reverse">) {
    const opposite = direction === "reverse";
    const sourceIds = stationIds(opposite ? route.toStationId : route.fromStationId);
    const targetIds = stationIds(opposite ? route.fromStationId : route.toStationId);
    const vias = opposite ? [...route.via].reverse() : route.via;
    for (const candidate of topology.routeTable) {
      if (candidate.locoDirection === "unknown" ||
          !sourceIds.has(candidate.fromBlockId) || !targetIds.has(candidate.toBlockId)) continue;
      const ids = candidate.blockPath.map(b => b.id);
      if (ids.length < 2 || ids[0] !== candidate.fromBlockId || ids[ids.length - 1] !== candidate.toBlockId) continue;
      let cursor = 1;
      let valid = true;
      for (const via of vias) {
        const matches = via.type === "block" ? new Set([Number(via.targetId)]) : stationIds(via.targetId);
        const index = ids.findIndex((id, i) => i >= cursor && i < ids.length - 1 && matches.has(id));
        if (index === -1) { valid = false; break; }
        cursor = index + 1;
      }
      if (!valid) continue;
      const key = direction + ":" + ids.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      plans.push({direction, blockIds: ids, blockNames: candidate.blockPath.map(b => b.name)});
      if (plans.length >= limit) return plans;
    }
  }
  return plans;
}
