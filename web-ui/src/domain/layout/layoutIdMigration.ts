import type {
  LayoutElementId,
  SerializedLayoutDto,
  SerializedLayoutElementDto,
} from "./layoutDto.js";
import {
  INVALID_LAYOUT_ELEMENT_ID,
  MAX_LAYOUT_ELEMENT_ID,
} from "./layoutDto.js";

export type LayoutIdMigrationResult = {
  layout: SerializedLayoutDto;
  migrated: boolean;
  migratedElementCount: number;
  migratedReferenceCount: number;
};

function isValidId(value: unknown): value is LayoutElementId {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_LAYOUT_ELEMENT_ID;
}

function legacyKey(value: unknown): string {
  if (typeof value === "string") return `s:${value}`;
  if (typeof value === "number" && Number.isFinite(value)) return `n:${value}`;
  return "";
}

function allElements(layout: SerializedLayoutDto): SerializedLayoutElementDto[] {
  return (layout.layers ?? []).flatMap(layer => layer.elements ?? []);
}

function nextFreeId(used: Set<number>, start: number): number {
  let candidate = Math.max(1, Math.trunc(start));
  for (let attempts = 0; attempts < MAX_LAYOUT_ELEMENT_ID; attempts += 1) {
    if (candidate > MAX_LAYOUT_ELEMENT_ID) candidate = 1;
    if (!used.has(candidate)) return candidate;
    candidate += 1;
  }
  throw new Error("The layout has no free uint16 element ID.");
}

/**
 * Converts legacy UUID/string layout IDs to stable uint16 IDs.
 *
 * The algorithm is intentionally deterministic on both the browser and the
 * firmware side:
 *  1. reserve all already valid, unique numeric IDs;
 *  2. walk elements in persisted layer order;
 *  3. assign the lowest available IDs to legacy/duplicate IDs;
 *  4. remap every persisted element reference using the old->new table.
 */
export function migrateSerializedLayoutIds(input: SerializedLayoutDto): LayoutIdMigrationResult {
  const layout = structuredClone(input);
  const elements = allElements(layout);
  const used = new Set<number>();
  const acceptedNumeric = new Set<number>();
  const mapping = new Map<string, LayoutElementId>();

  // First pass reserves unique valid numeric IDs regardless of where they are
  // in the file. This prevents an earlier UUID element from stealing a later
  // already-persisted numeric ID.
  for (const element of elements) {
    const raw = element.id;
    if (!isValidId(raw) || acceptedNumeric.has(raw)) continue;
    acceptedNumeric.add(raw);
    used.add(raw);
  }

  let next = 1;
  let migratedElementCount = 0;
  let migratedReferenceCount = 0;
  const seenNumeric = new Set<number>();

  for (const element of elements) {
    const raw = element.id;
    let id: LayoutElementId;

    if (isValidId(raw) && !seenNumeric.has(raw)) {
      id = raw;
      seenNumeric.add(raw);
    } else {
      id = nextFreeId(used, next);
      used.add(id);
      next = id + 1;
      migratedElementCount += 1;
    }

    const key = legacyKey(raw);
    if (key && !mapping.has(key)) mapping.set(key, id);

    if (element.id !== id) element.id = id;
  }

  const resolveReference = (value: unknown): LayoutElementId => {
    if (isValidId(value)) {
      const mapped = mapping.get(legacyKey(value));
      return mapped ?? value;
    }

    const mapped = mapping.get(legacyKey(value));
    return mapped ?? INVALID_LAYOUT_ELEMENT_ID;
  };

  for (const element of elements) {
    if (Array.isArray(element.routeTurnouts)) {
      element.routeTurnouts = element.routeTurnouts
        .map(item => {
          const turnoutId = resolveReference(item.turnoutId);
          if (item.turnoutId !== turnoutId) migratedReferenceCount += 1;
          return {
            turnoutId,
            closed: Boolean(item.closed),
          };
        })
        .filter(item => item.turnoutId !== INVALID_LAYOUT_ELEMENT_ID);
    }

    if (element.fromBlockId !== undefined) {
      const id = resolveReference(element.fromBlockId);
      if (element.fromBlockId !== id) migratedReferenceCount += 1;
      element.fromBlockId = id;
    }

    if (element.toBlockId !== undefined) {
      const id = resolveReference(element.toBlockId);
      if (element.toBlockId !== id) migratedReferenceCount += 1;
      element.toBlockId = id;
    }
  }

  return {
    layout,
    migrated: migratedElementCount > 0 || migratedReferenceCount > 0,
    migratedElementCount,
    migratedReferenceCount,
  };
}
