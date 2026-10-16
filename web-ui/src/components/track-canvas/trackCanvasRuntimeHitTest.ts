import type { BaseElement } from "../../models/editor/core/BaseElement";
import type { LayoutView } from "../../models/editor/core/LayoutView";
import { BlockElement } from "../../models/editor/elements/BlockElement";
import { LabelElement } from "../../models/editor/elements/LabelElement";

/** Labels are visual decorations in runtime mode, never interaction targets.
 * Block artwork must also win over overlapping track and other layers.
 * Editor mode deliberately keeps the regular layout hit-test unchanged.
 */
export function getTrackCanvasHitElement(
  layout: LayoutView,
  x: number,
  y: number,
  editMode: boolean,
): BaseElement | null {
  // Hidden layers must never participate in canvas hit-testing.
  const visibleLayers = layout.layers.filter(layer => layer.visible);
  const visibleElements = visibleLayers.flatMap(layer =>
    layer.elements.filter(element => element.visible)
  );

  if (editMode) {
    // Button artwork is commonly placed over track. Prefer its selectable layer
    // instead of letting the track layer intercept editor dragging.
    const button = layout.buttons.visible
      ? [...layout.buttons.elements].reverse().find(element =>
          element.visible && element.hitTest(x, y))
      : undefined;
    return button ?? visibleElements.find(element => element.hitTest(x, y)) ?? null;
  }

  const block = layout.blocks.visible && layout.blocks.elements.find(
    element => element instanceof BlockElement &&
      element.visible && element.hitTest(x, y),
  );
  if (block) return block;

  return visibleElements.find(
    element => !(element instanceof LabelElement) && element.hitTest(x, y),
  ) ?? null;
}
