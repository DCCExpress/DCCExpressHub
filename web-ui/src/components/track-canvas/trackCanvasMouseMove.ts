
import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import { getBridgePlacement } from "./bridgePlacement";
import { getTrackCanvasHitElement } from "./trackCanvasRuntimeHitTest";
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
  DragState,
  PanState,
  SelectionState,
  ViewState,
} from "./TrackCanvas.types";

import {
  getTrackCanvasCursor,
} from "./trackCanvasCursor";

import {
  getCenteredElementGridAnchor,
  screenToGrid,
} from "./trackCanvasGeometry";

import {
  getAllLayoutElements,
} from "./trackCanvasSelection";

type MouseMoveRef<T> = {
  current: T;
};

export type TrackCanvasGridPoint = {
  x: number;
  y: number;
};

export type TrackCanvasMouseMoveContext = {
  canvas: HTMLCanvasElement;
  layoutRef: MouseMoveRef<LayoutView>;
  toolRef: MouseMoveRef<EditorTool>;
  viewRef: MouseMoveRef<ViewState>;
  currentCursorRef: MouseMoveRef<BaseElement | null>;
  panRef: MouseMoveRef<PanState>;
  selectionRef: MouseMoveRef<SelectionState>;
  dragRef: MouseMoveRef<DragState>;
  editModeRef: MouseMoveRef<boolean>;
  setMouseGrid: Dispatch<SetStateAction<TrackCanvasGridPoint>>;
  setHoverGrid: Dispatch<SetStateAction<TrackCanvasGridPoint | null>>;
  persistView: () => void;
  invalidate: () => void;
};

export function handleTrackCanvasMouseMove(
  event: MouseEvent,
  context: TrackCanvasMouseMoveContext
): void {
  const {
    canvas,
    layoutRef,
    toolRef,
    viewRef,
    currentCursorRef,
    panRef,
    selectionRef,
    dragRef,
    editModeRef,
    setMouseGrid,
    setHoverGrid,
    persistView,
    invalidate,
  } = context;

  const currentLayout =
    layoutRef.current;

  const currentTool =
    toolRef.current;

  const rect =
    canvas.getBoundingClientRect();

  const mouseX =
    event.clientX - rect.left;

  const mouseY =
    event.clientY - rect.top;

  const grid = screenToGrid(
    mouseX,
    mouseY,
    viewRef.current,
    currentLayout.gridSize
  );

  setMouseGrid(previous =>
    previous.x === grid.x && previous.y === grid.y
      ? previous
      : {
        x: grid.x,
        y: grid.y,
      }
  );

  const hoveredElement =
    getTrackCanvasHitElement(currentLayout, grid.x, grid.y, editModeRef.current);

  if (toolRef.current.mode === "draw" && currentCursorRef.current) {
    const cursorAnchor = getCenteredElementGridAnchor(
      currentCursorRef.current,
      grid
    );

    const cursor = currentCursorRef.current;
    const bridgePlacement = cursor.type === ELEMENT_TYPES.TRACK_BRIDGE
      ? getBridgePlacement(currentLayout, cursorAnchor.x, cursorAnchor.y, cursor.rotation)
      : null;
    const occupied = bridgePlacement
      ? (bridgePlacement.valid ? null : cursor)
      : currentLayout.getLayeredElement(cursor, cursorAnchor.x, cursorAnchor.y);

    if (occupied != null) {
      setHoverGrid(cursorAnchor);
    } else {
      setHoverGrid(null);
    }

    invalidate();
  }

  if (panRef.current.isPanning) {
    event.preventDefault();

    const dx =
      event.clientX - panRef.current.lastX;

    const dy =
      event.clientY - panRef.current.lastY;

    panRef.current.lastX = event.clientX;
    panRef.current.lastY = event.clientY;

    viewRef.current.offsetX += dx;
    viewRef.current.offsetY += dy;

    persistView();
    invalidate();
    return;
  }

  if (selectionRef.current.isSelecting) {
    event.preventDefault();

    selectionRef.current.endGridX = grid.x;
    selectionRef.current.endGridY = grid.y;

    canvas.style.cursor = "crosshair";
    invalidate();
    return;
  }

  if (dragRef.current.isDraggingElement && dragRef.current.elementId) {
    event.preventDefault();

    const dx =
      grid.x - dragRef.current.startMouseGridX;

    const dy =
      grid.y - dragRef.current.startMouseGridY;

    const all =
      getAllLayoutElements(currentLayout);

    const selectedIds = new Set(
      dragRef.current.draggedElements.map(item => item.id)
    );

    for (const item of dragRef.current.draggedElements) {
      const element =
        all.find(candidate => candidate.id === item.id);

      if (!element) {
        continue;
      }

      const nextX = item.startX + dx;
      const nextY = item.startY + dy;

      if (element.type === ELEMENT_TYPES.TRACK_BRIDGE) {
        const placement = getBridgePlacement(currentLayout, nextX, nextY, element.rotation, element.id);
        if (!placement.valid) {
          setHoverGrid({ x: grid.x, y: grid.y });
          canvas.style.cursor = "not-allowed";
          return;
        }
      }
      const occupied = element.type === ELEMENT_TYPES.TRACK_BRIDGE
        ? null
        : currentLayout.getLayeredElement(element, nextX, nextY);

      if (occupied && !selectedIds.has(occupied.id)) {
        setHoverGrid({
          x: grid.x,
          y: grid.y,
        });

        canvas.style.cursor = "not-allowed";
        return;
      }
    }

    setHoverGrid(null);

    for (const item of dragRef.current.draggedElements) {
      const element =
        all.find(candidate => candidate.id === item.id);

      if (!element) {
        continue;
      }

      element.x = item.startX + dx;
      element.y = item.startY + dy;
    }

    canvas.style.cursor = "move";
    invalidate();
    return;
  }

  canvas.style.cursor = getTrackCanvasCursor(
    editModeRef.current,
    currentTool,
    hoveredElement
  );
}
