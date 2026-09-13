import type { Dispatch, SetStateAction } from "react";

import type { LayoutView } from "../../models/editor/core/LayoutView";
import type { BaseElement } from "../../models/editor/core/BaseElement";
import type { IEditableProperty } from "../../models/editor/elements/PropertyDescriptor";

export type LayoutSetter = Dispatch<SetStateAction<LayoutView>>;

export type PropertyChangeHandler = (
  prop: IEditableProperty,
  rawValue: unknown
) => void;

export type SelectedElementUpdateHandler = (
  element: BaseElement | null
) => void;
