
import type {
  Dispatch,
  SetStateAction,
} from "react";

import type {
  BaseElement,
} from "../../models/editor/core/BaseElement";

import type {
  LayoutView,
} from "../../models/editor/core/LayoutView";

import type {
  EditorTool,
} from "../../models/editor/types/EditorTypes";

import type {
  ViewState,
} from "./TrackCanvas.types";

import {
  fitLayoutToView,
} from "./trackCanvasLayoutBounds";

import {
  getAllLayoutElements,
} from "./trackCanvasSelection";

import {
  cloneElementForPlacement,
} from "./trackCanvasClone";

export type TrackCanvasRef<T> = {
  current: T;
};

export type TrackCanvasKeyboardContext = {
  canvasRef: TrackCanvasRef<HTMLCanvasElement | null>;
  layoutRef: TrackCanvasRef<LayoutView>;
  toolRef: TrackCanvasRef<EditorTool>;
  editModeRef: TrackCanvasRef<boolean>;
  currentCursorRef: TrackCanvasRef<BaseElement | null>;
  selectedElementRef: TrackCanvasRef<BaseElement | null>;
  copiedElementRef: TrackCanvasRef<BaseElement | null>;
  pendingCopiedCursorRef: TrackCanvasRef<BaseElement | null>;
  viewRef: TrackCanvasRef<ViewState>;
  setCurrentCursor: Dispatch<SetStateAction<BaseElement | null>>;
  onToolChange?: Dispatch<SetStateAction<EditorTool>> | undefined;
  onBeforeLayoutChange?: (() => void) | undefined;
  onLayoutChange: Dispatch<SetStateAction<LayoutView>>;
  onSelectedElementChange: (element: BaseElement | null) => void;
  closeSignalAspectPopover: () => void;
  persistView: () => void;
  invalidate: () => void;
};

export function handleTrackCanvasKeyDown(
  event: KeyboardEvent,
  context: TrackCanvasKeyboardContext
): void {
  const active =
    document.activeElement as HTMLElement | null;

  if (active?.tagName !== "CANVAS") {
    return;
  }

  const currentLayout =
    context.layoutRef.current;

  const currentTool =
    context.toolRef.current;

  const currentEditMode =
    context.editModeRef.current;

  const selected =
    currentLayout.getSelected();

  const selectedElements =
    getAllLayoutElements(currentLayout)
      .filter(element => element.selected);

  if (event.key.toLowerCase() === "escape") {
    context.closeSignalAspectPopover();
  }

  if (event.key.toLowerCase() === "f") {
    event.preventDefault();

    const canvas =
      context.canvasRef.current;

    if (!canvas) {
      return;
    }

    const rect =
      canvas.getBoundingClientRect();

    fitLayoutToView(
      context.layoutRef.current,
      context.viewRef.current,
      rect.width,
      rect.height
    );

    context.persistView();
    context.invalidate();
    return;
  }

  if (!currentEditMode) {
    return;
  }

  const isCtrlOrMeta =
    event.ctrlKey || event.metaKey;

  if (
    isCtrlOrMeta &&
    event.key.toLowerCase() === "c"
  ) {
    if (selectedElements.length !== 1) {
      return;
    }

    event.preventDefault();

    const copied =
      cloneElementForPlacement(
        selectedElements[0]!
      );

    context.copiedElementRef.current =
      copied;

    return;
  }

  if (
    isCtrlOrMeta &&
    event.key.toLowerCase() === "v"
  ) {
    const copied =
      context.copiedElementRef.current;

    if (!copied) {
      return;
    }

    event.preventDefault();

    const pasted =
      cloneElementForPlacement(
        copied
      );

    const stepX =
      Math.max(
        1,
        Math.ceil(
          pasted.w
        )
      );

    const stepY =
      Math.max(
        1,
        Math.ceil(
          pasted.h
        )
      );

    let pasteX =
      copied.x + stepX;

    let pasteY =
      copied.y + stepY;

    let foundFreePosition =
      false;

    for (
      let offset = 1;
      offset <= 64;
      offset += 1
    ) {
      pasteX =
        copied.x +
        stepX * offset;

      pasteY =
        copied.y +
        stepY * offset;

      if (
        !currentLayout.getLayeredElement(
          pasted,
          pasteX,
          pasteY
        )
      ) {
        foundFreePosition =
          true;
        break;
      }
    }

    if (foundFreePosition) {
      context.onBeforeLayoutChange?.();

      pasted.x = pasteX;
      pasted.y = pasteY;

      currentLayout.addElement(
        pasted,
        pasted.layerName
      );

      context.onLayoutChange(
        previous => previous
      );
    }

    const cursor =
      cloneElementForPlacement(
        copied
      );

    cursor.selected = true;

    context.pendingCopiedCursorRef.current =
      cursor;

    context.setCurrentCursor(
      cursor
    );

    context.onToolChange?.({
      mode: "draw",
      elementType: cursor.type,
    });

    context.canvasRef.current?.focus();
    context.invalidate();
    return;
  }

  if (event.key === "r" || event.key === "R") {
    event.preventDefault();

    if (currentTool.mode === "draw") {
      const cursor =
        context.currentCursorRef.current;

      if (!cursor) {
        return;
      }

      cursor.rotation =
        (cursor.rotation + cursor.rotationStep) % 360;

      context.setCurrentCursor(
        cursor.clone()
      );

      context.invalidate();
      return;
    }

    if (currentTool.mode === "cursor") {
      if (!selected) {
        return;
      }

      context.onBeforeLayoutChange?.();

      selected.rotation =
        (selected.rotation + selected.rotationStep) % 360;

      context.onLayoutChange(previous => previous);
      context.invalidate();
      return;
    }
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    if (!selected) {
      return;
    }

    event.preventDefault();
    context.onBeforeLayoutChange?.();

    for (const element of selectedElements) {
      currentLayout.removeElement(element);
    }

    if (context.selectedElementRef.current?.id === selected.id) {
      context.onSelectedElementChange(null);
    }

    context.onLayoutChange(previous => previous);
    context.invalidate();
  }
}
