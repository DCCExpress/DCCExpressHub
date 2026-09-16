import type {
  Dispatch,
  SetStateAction,
} from "react";

import type {
  TFunction,
} from "i18next";

import {
  ELEMENT_TYPES,
} from "@domain/layout/elementTypes";

import {
  showErrorMessage,
} from "../../helpers";

import type {
  BaseElement,
} from "../../models/editor/core/BaseElement";

import {
  isTurnoutElement,
  type LayoutView,
} from "../../models/editor/core/LayoutView";

import {
  AudioButtonElement,
} from "../../models/editor/elements/AudioButtonElement";

import {
  BlockElement,
} from "../../models/editor/elements/BlockElement";

import {
  RouteButtonElement,
} from "../../models/editor/elements/RouteButtonElement";

import {
  TrackSignalElement,
} from "../../models/editor/elements/TrackSignalElement";

import TrackTurnoutDoubleElement from "../../models/editor/elements/TrackTurnoutDoubleElement";
import {
  TrackTurnoutThreeWayElement,
} from "../../models/editor/elements/TrackTurnoutThreeWayElement";

import type {
  EditorTool,
} from "../../models/editor/types/EditorTypes";

import type {
  DoubleTurnoutPopoverState,
  DragState,
  PanState,
  SelectionState,
  SignalAspectPopoverState,
  ViewState,
} from "./TrackCanvas.types";

import {
  getCenteredElementGridAnchor,
  screenToGrid,
} from "./trackCanvasGeometry";

import {
  getAllLayoutElements,
} from "./trackCanvasSelection";

import type {
  MultiMotorTurnout,
} from "./trackCanvasDoubleTurnoutPopoverState";

type MouseDownRef<T> = {
  current: T;
};

export type TrackCanvasMouseDownContext = {
  canvas: HTMLCanvasElement;
  layoutRef: MouseDownRef<LayoutView>;
  toolRef: MouseDownRef<EditorTool>;
  viewRef: MouseDownRef<ViewState>;
  editModeRef: MouseDownRef<boolean>;
  turnoutSelectionModeRef: MouseDownRef<boolean>;
  selectedElementRef: MouseDownRef<BaseElement | null>;
  currentCursorRef: MouseDownRef<BaseElement | null>;
  signalAspectPopoverRef: MouseDownRef<SignalAspectPopoverState>;
  doubleTurnoutPopoverRef: MouseDownRef<DoubleTurnoutPopoverState>;
  panRef: MouseDownRef<PanState>;
  dragRef: MouseDownRef<DragState>;
  selectionRef: MouseDownRef<SelectionState>;
  setSelectedBlock: Dispatch<SetStateAction<BlockElement | null>>;
  setLocoPickerOpen: Dispatch<SetStateAction<boolean>>;
  setRouteTurnoutsMarked: (routeButton: RouteButtonElement) => void;
  onInvalidate: () => void;
  onBeforeLayoutChange?: (() => void) | undefined;
  onLayoutChange: Dispatch<SetStateAction<LayoutView>>;
  onSelectedElementChange: (element: BaseElement | null) => void;
  openSignalAspectPopover: (
    signal: TrackSignalElement,
    clientX: number,
    clientY: number
  ) => void;
  reopenSignalAspectPopover: (
    signal: TrackSignalElement,
    clientX: number,
    clientY: number
  ) => void;
  closeSignalAspectPopover: () => void;
  openDoubleTurnoutPopover: (
    turnout: MultiMotorTurnout,
    clientX: number,
    clientY: number
  ) => void;
  reopenDoubleTurnoutPopover: (
    turnout: MultiMotorTurnout,
    clientX: number,
    clientY: number
  ) => void;
  closeDoubleTurnoutPopover: () => void;
  handleClickableDown: (
    hitElement: BaseElement | null,
    event: MouseEvent | PointerEvent
  ) => boolean;
  invalidate: () => void;
  t: TFunction;
};

export function handleTrackCanvasMouseDown(
  event: MouseEvent,
  context: TrackCanvasMouseDownContext
): void {
  const {
    canvas,
    layoutRef,
    toolRef,
    viewRef,
    editModeRef,
    turnoutSelectionModeRef,
    selectedElementRef,
    currentCursorRef,
    signalAspectPopoverRef,
    doubleTurnoutPopoverRef,
    panRef,
    dragRef,
    selectionRef,
    setSelectedBlock,
    setLocoPickerOpen,
    setRouteTurnoutsMarked,
    onInvalidate,
    onBeforeLayoutChange,
    onLayoutChange,
    onSelectedElementChange,
    openSignalAspectPopover,
    reopenSignalAspectPopover,
    closeSignalAspectPopover,
    openDoubleTurnoutPopover,
    reopenDoubleTurnoutPopover,
    closeDoubleTurnoutPopover,
    handleClickableDown,
    invalidate,
    t,
  } = context;

  const currentLayout = layoutRef.current;
  const currentTool = toolRef.current;
  const currentEditMode = editModeRef.current;
  const currentTurnoutSelection = turnoutSelectionModeRef.current;
  const currentElement = selectedElementRef.current;

  if (event.button === 2) {
    event.preventDefault();

    if (signalAspectPopoverRef.current.opened) {
      closeSignalAspectPopover();
    }

    if (doubleTurnoutPopoverRef.current.opened) {
      closeDoubleTurnoutPopover();
    }

    panRef.current.isPanning = true;
    panRef.current.lastX = event.clientX;
    panRef.current.lastY = event.clientY;
    canvas.style.cursor = "grabbing";
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  const grid = screenToGrid(
    mouseX,
    mouseY,
    viewRef.current,
    currentLayout.gridSize
  );

  const hitElement = currentLayout.getElement(grid.x, grid.y);

  if (!editModeRef.current && hitElement?.type === ELEMENT_TYPES.BUTTON_AUDIO) {
    const audioButton = hitElement as AudioButtonElement;
    audioButton.press(() => {
      invalidate();
    });
    return;
  }

  if (currentEditMode && currentTurnoutSelection) {
    if (hitElement) {
      if (currentElement instanceof RouteButtonElement) {
        if (
          hitElement instanceof TrackTurnoutDoubleElement ||
          hitElement instanceof TrackTurnoutThreeWayElement
        ) {
          currentElement.addOrUpdateTurnout(
            hitElement.id,
            hitElement.turnout1Closed,
            hitElement.turnout2Closed
          );

          setRouteTurnoutsMarked(currentElement);
          onInvalidate();
        } else if (isTurnoutElement(hitElement)) {
          currentElement.addOrUpdateTurnout(
            hitElement.id,
            hitElement.turnoutClosed
          );

          setRouteTurnoutsMarked(currentElement);
          onInvalidate();
        }
      } else {
        alert("Nincs aktív RouteButton");
      }

      return;
    }

    return;
  }

  if (!editModeRef.current) {
    if (hitElement instanceof BlockElement) {
      setSelectedBlock(hitElement);
      setLocoPickerOpen(true);
    }

    if (hitElement instanceof TrackSignalElement) {
      if (doubleTurnoutPopoverRef.current.opened) {
        closeDoubleTurnoutPopover();
      }

      if (signalAspectPopoverRef.current.opened) {
        reopenSignalAspectPopover(
          hitElement,
          event.clientX,
          event.clientY
        );
      } else {
        openSignalAspectPopover(
          hitElement,
          event.clientX,
          event.clientY
        );
      }

      return;
    }

    if (
      hitElement instanceof TrackTurnoutDoubleElement ||
      hitElement instanceof TrackTurnoutThreeWayElement
    ) {
      if (signalAspectPopoverRef.current.opened) {
        closeSignalAspectPopover();
      }

      /*
       * Anchor the popup to the actual screen center of the turnout,
       * instead of the exact mouse-down X coordinate.
       */
      const turnoutBounds =
        hitElement.getBounds();

      const turnoutCenterWorldX =
        (
          turnoutBounds.x +
          turnoutBounds.width / 2
        ) *
        currentLayout.gridSize;

      const turnoutCenterClientX =
        rect.left +
        viewRef.current.offsetX +
        turnoutCenterWorldX *
          viewRef.current.scale;

      if (doubleTurnoutPopoverRef.current.opened) {
        reopenDoubleTurnoutPopover(
          hitElement,
          turnoutCenterClientX,
          event.clientY
        );
      } else {
        openDoubleTurnoutPopover(
          hitElement,
          turnoutCenterClientX,
          event.clientY
        );
      }

      return;
    }
  }

  if (signalAspectPopoverRef.current.opened) {
    closeSignalAspectPopover();
  }

  if (doubleTurnoutPopoverRef.current.opened) {
    closeDoubleTurnoutPopover();
  }

  if (!editModeRef.current) {
    if (handleClickableDown(hitElement, event)) {
      return;
    }
  }

  if (!currentEditMode) {
    return;
  }

  if (currentTool.mode === "delete") {
    const element = currentLayout.getElement(grid.x, grid.y);

    if (element) {
      onBeforeLayoutChange?.();
      currentLayout.removeElement(element);
      onLayoutChange(previous => previous);
      invalidate();
    }

    return;
  }

  if (currentTool.mode === "draw") {
    const cursor = currentCursorRef.current;

    if (!cursor) {
      return;
    }

    const cursorAnchor = getCenteredElementGridAnchor(
      cursor,
      grid
    );

    const exists = currentLayout.getLayeredElement(
      cursor,
      cursorAnchor.x,
      cursorAnchor.y
    );

    if (exists) {
      showErrorMessage(
        t("common.error"),
        t("editor.messages.alreadyHasElement")
      );
      return;
    }

    onBeforeLayoutChange?.();

    const newElement = cursor.clone();
    newElement.x = cursorAnchor.x;
    newElement.y = cursorAnchor.y;
    newElement.selected = false;

    currentLayout.addElement(
      newElement,
      newElement.layerName
    );

    onLayoutChange(previous => previous);
    invalidate();
    return;
  }

  if (hitElement) {
    if (event.ctrlKey) {
      hitElement.selected = !hitElement.selected;

      const allSelected = getAllLayoutElements(currentLayout)
        .filter(element => element.selected);

      if (allSelected.length === 1) {
        onSelectedElementChange(allSelected[0]!);
      } else {
        onSelectedElementChange(null);
      }

      onLayoutChange(previous => previous);
      invalidate();
      return;
    }

    const wasSelected = hitElement.selected;

    if (!wasSelected) {
      currentLayout.unselectAll();
      hitElement.selected = true;
      onSelectedElementChange(hitElement);
    }

    const dragged = getAllLayoutElements(currentLayout)
      .filter(element => element.selected)
      .map(element => ({
        id: element.id,
        startX: element.x,
        startY: element.y,
      }));

    onBeforeLayoutChange?.();

    dragRef.current.isDraggingElement = true;
    dragRef.current.elementId = hitElement.id;
    dragRef.current.startMouseGridX = grid.x;
    dragRef.current.startMouseGridY = grid.y;
    dragRef.current.startElementX = hitElement.x;
    dragRef.current.startElementY = hitElement.y;
    dragRef.current.draggedElements = dragged;
    canvas.style.cursor = "move";
    invalidate();
    return;
  }

  if (currentTool.mode === "cursor") {
    if (!event.ctrlKey) {
      currentLayout.unselectAll();
      onSelectedElementChange(null);
    }

    selectionRef.current.isSelecting = true;
    selectionRef.current.additive = event.ctrlKey;
    selectionRef.current.startGridX = grid.x;
    selectionRef.current.startGridY = grid.y;
    selectionRef.current.endGridX = grid.x;
    selectionRef.current.endGridY = grid.y;
    canvas.style.cursor = "crosshair";
    invalidate();
    return;
  }

  if (!event.ctrlKey) {
    currentLayout.unselectAll();
    onSelectedElementChange(null);
    onLayoutChange(previous => previous);
    invalidate();
  }
}
