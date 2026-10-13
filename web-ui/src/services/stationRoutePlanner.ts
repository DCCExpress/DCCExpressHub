import type { LayoutView } from "@/models/editor/core/LayoutView";
import { BlockElement } from "@/models/editor/elements/BlockElement";
import { ensureClientRouteGraph } from "@/services/clientRouteGraphCache";
import type { StationRouteDefinition } from "@/domain/layout/stationRoutes";

export type StationRoutePlan = {
  direction: "forward" | "reverse";
  blockIds: number[];
  blockNames: string[];
};

/**
 * Preview only. Enumerates physical block transitions in waypoint order.
 * Uses the existing graph to check each leg; never takes dispatcher authority.
 */
export function previewStationRoute(layout: LayoutView, route: StationRouteDefinition, limit = 24): StationRoutePlan[] {
  const graph = ensureClientRouteGraph(layout).result.graph;
  const blocks = layout.blocks.elements.filter((item): item is BlockElement => item instanceof BlockElement);
  const byStation = (id: string) => blocks.filter(block => block.stationId === id).map(block => block.id);
  const names = new Map(blocks.map(block => [block.id, block.name || `#${block.id}`]));
  const result: StationRoutePlan[] = [];
  const seen = new Set<string>();
  const directions: Array<"forward" | "reverse"> = route.allowReverse ? ["forward", "reverse"] : ["forward"];
  for (const direction of directions) {
    const reverse = direction === "reverse";
    const via = reverse ? [...route.via].reverse() : route.via;
    const groups: number[][] = [
      byStation(reverse ? route.toStationId : route.fromStationId),
      ...via.map(point => point.type === "station" ? byStation(point.targetId) : [Number(point.targetId)]),
      byStation(reverse ? route.fromStationId : route.toStationId),
    ];
    if (groups.some(group => group.length === 0)) continue;
    const visit = (index: number, path: number[]) => {
      if (result.length >= limit) return;
      if (index === groups.length) {
        const key = direction + ":" + path.join(",");
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ direction, blockIds: path, blockNames: path.map(id => names.get(id) ?? `#${id}`) });
        }
        return;
      }
      for (const blockId of groups[index]!) {
        if (!graph.findBlockById(blockId)) continue;
        const previous = path[path.length - 1];
        if (previous !== undefined && (previous === blockId || graph.findRouteBetweenBlocks(previous, blockId) === null)) continue;
        visit(index + 1, [...path, blockId]);
        if (result.length >= limit) break;
      }
    };
    visit(0, []);
  }
  return result;
}
