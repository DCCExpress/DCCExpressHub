import {
  INVALID_LAYOUT_ELEMENT_ID,
} from "@domain/layout/layoutDto";

import {
  ElementFactory,
} from "../../models/editor/core/ElementFactory";

import type {
  BaseElement,
} from "../../models/editor/core/BaseElement";

import type {
  EditorElementData,
} from "../../models/editor/types/EditorTypes";

/**
 * Creates a persistence-exact editor clone while deliberately dropping the ID.
 * Layout.addElement() assigns the next stable uint16 ID when the clone is placed.
 */
export function cloneElementForPlacement(
  source: BaseElement
): BaseElement {
  const serialized =
    JSON.parse(
      JSON.stringify(
        source.toJSON()
      )
    ) as EditorElementData;

  serialized.id =
    INVALID_LAYOUT_ELEMENT_ID;

  const copy =
    ElementFactory.create(
      serialized
    );

  copy.id =
    INVALID_LAYOUT_ELEMENT_ID;

  copy.selected = false;
  copy.marked = false;

  return copy;
}
