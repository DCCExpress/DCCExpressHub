/** Station-to-station route templates: metadata only, not executable Movement routes. */
export type StationRouteVia = {
  type: "station" | "block";
  targetId: string;
  behavior: "pass" | "stop";
};

export type StationRouteDefinition = {
  id: string;
  name: string;
  enabled: boolean;
  allowReverse: boolean;
  fromStationId: string;
  toStationId: string;
  via: StationRouteVia[];
};

export function normalizeStationRoutes(value: unknown): StationRouteDefinition[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  return value.flatMap((raw): StationRouteDefinition[] => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id.trim() || used.has(r.id) ||
      typeof r.name !== "string" || typeof r.fromStationId !== "string" ||
      typeof r.toStationId !== "string") return [];
    used.add(r.id);
    const via: StationRouteVia[] = Array.isArray(r.via) ? r.via.flatMap((candidate): StationRouteVia[] => {
      if (!candidate || typeof candidate !== "object") return [];
      const item = candidate as Record<string, unknown>;
      if ((item.type !== "station" && item.type !== "block") || typeof item.targetId !== "string") return [];
      return [{ type: item.type, targetId: item.targetId, behavior: item.behavior === "stop" ? "stop" : "pass" }];
    }) : [];
    return [{ id: r.id, name: r.name, enabled: r.enabled !== false, allowReverse: r.allowReverse === true,
      fromStationId: r.fromStationId, toStationId: r.toStationId, via }];
  });
}
