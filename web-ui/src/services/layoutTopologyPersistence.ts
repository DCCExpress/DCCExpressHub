import type {
  SerializedLayoutDto,
  SerializedLayoutElementDto,
} from "@domain/layout/layoutDto";

import type {
  LayoutView,
} from "@/models/editor/core/LayoutView";

function collectSerializedElements(
  layout: unknown
): Map<number, SerializedLayoutElementDto> {
  const serialized =
    (layout ?? {}) as SerializedLayoutDto;
  const result =
    new Map<number, SerializedLayoutElementDto>();

  for (const layer of serialized.layers ?? []) {
    for (const element of layer.elements ?? []) {
      const id =
        Number(element.id ?? 0);

      if (
        Number.isInteger(id) &&
        id > 0
      ) {
        result.set(
          id,
          element
        );
      }
    }
  }

  return result;
}

/**
 * Restores persisted topology metadata after ElementFactory created the real
 * editor objects.
 *
 * This is intentionally central instead of duplicating `section` /
 * `travelDirection` handling in every TrackElement.fromJSON() implementation.
 */
export function restorePersistedTopologyMetadata(
  layout: LayoutView,
  serialized: unknown
): void {
  const serializedById =
    collectSerializedElements(
      serialized
    );

  for (const element of layout.getTrackElements()) {
    const raw =
      serializedById.get(
        element.id
      );

    if (!raw) {
      continue;
    }

    const section =
      Math.trunc(
        Number(
          raw.section ?? 0
        )
      );

    element.section =
      Number.isInteger(section) &&
      section > 0
        ? section
        : 0;

    element.travelDirection =
      raw.travelDirection === "forward" ||
      raw.travelDirection === "reverse"
        ? raw.travelDirection
        : "unknown";
  }

  /*
   * Blocks are TrackElements too. Their direction arrow is derived from the
   * physical rail under the block, exactly as applyRouteGraphRuntime() does.
   * We deliberately do not fabricate a block travelDirection here; the saved
   * block section is restored, while its visual train-direction marker remains
   * tied to the underlying physical rail.
   */
}
