/**
 * Read RAIL occupancy addresses on the physically traversed turnout chain.
 * This deliberately ignores turnout accessory addresses (turnoutAddress).
 * Two adjacent turnout elements sharing the same detector are one virtual
 * occupancy region; non-adjacent repeats are preserved in route order.
 */
export type OccupancyTurnoutLayout = {
  layers?: readonly {
    elements?: readonly {
      id?: number;
      type?: string;
      address?: number;
    }[];
  }[];
};

export type OccupancyRouteEdge = {
  turnoutPath?: readonly { elementId?: number }[];
};

const TURNOUT_TYPES = new Set([
  "trackturnoutleft",
  "trackturnoutright",
  "trackturnouttwoway",
  "trackturnouttreeway",
  "trackturnoutdouble",
]);

function positiveAddress(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65535
    ? value
    : null;
}

export function collectTurnoutSensorPaths(
  layout: OccupancyTurnoutLayout,
  edges: readonly OccupancyRouteEdge[],
): number[][] {
  const sensorsByTurnoutId = new Map<number, number>();

  for (const layer of layout.layers ?? []) {
    for (const element of layer.elements ?? []) {
      if (!TURNOUT_TYPES.has(element.type ?? "")) continue;
      const id = positiveAddress(element.id);
      const sensor = positiveAddress(element.address);
      if (id !== null && sensor !== null)
        sensorsByTurnoutId.set(id, sensor);
    }
  }

  return edges.map(edge => {
    const addresses: number[] = [];
    for (const turnout of edge.turnoutPath ?? []) {
      const id = positiveAddress(turnout.elementId);
      const address = id === null ? undefined : sensorsByTurnoutId.get(id);
      if (address !== undefined && addresses[addresses.length - 1] !== address)
        addresses.push(address);
    }
    return addresses;
  });
}
