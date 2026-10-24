import { ELEMENT_TYPES } from "../domain/layout/elementTypes";
import type { BaseElement } from "../models/editor/core/BaseElement";
type LayoutView={track:{elements:BaseElement[]}};

export function getBridgePlacement(
  layout: LayoutView,
  x: number,
  y: number,
  preferredRotation: number,
  ignoredId = 0,
): { valid: boolean; rotation: number } {
  const onCell = layout.track.elements.filter(element =>
    element.id !== ignoredId && element.x === x && element.y === y
  );
  if (onCell.length > 1) return { valid: false, rotation: preferredRotation };
  if (onCell.length === 1) {
    const ground = onCell[0]!;
    if (ground.type !== ELEMENT_TYPES.TRACK_STRAIGHT) {
      return { valid: false, rotation: preferredRotation };
    }
    return { valid: true, rotation: (ground.rotation + 90) % 360 };
  }

  // An empty cell may extend an existing bridge without requiring ground rail.
  const neighbors = layout.track.elements.filter(element =>
    element.type === ELEMENT_TYPES.TRACK_BRIDGE &&
    element.id !== ignoredId &&
    Math.abs(element.x - x) <= 1 &&
    Math.abs(element.y - y) <= 1 &&
    !(element.x === x && element.y === y)
  );
  for (const bridge of neighbors) {
    const endpoints = bridge.getNeighborPointPairs().flat();
    if (endpoints.some(point => point.x === x && point.y === y)) {
      return { valid: true, rotation: bridge.rotation };
    }
  }
  return { valid: true, rotation: preferredRotation };
}
