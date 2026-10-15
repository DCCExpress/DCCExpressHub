import { useMantineColorScheme } from "@mantine/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { BaseElement } from "../models/editor/core/BaseElement";
import { isTurnoutElement } from "../models/editor/core/LayoutView";
import TrackTurnoutDoubleElement from "../models/editor/elements/TrackTurnoutDoubleElement";
import {
  TrackTurnoutThreeWayElement,
} from "../models/editor/elements/TrackTurnoutThreeWayElement";
import { AudioButtonElement } from "../models/editor/elements/AudioButtonElement";
import type { Loco } from "@domain/types";
import { BlockElement } from "../models/editor/elements/BlockElement";
import { getTrainTrackingState } from "../services/trainTrackingRuntime";
import { loadAutomationMovement } from "../services/automationApi";
import { loadMovementRouteCandidates, applyMovementRouteCandidate, type MovementRouteCandidate } from "../services/movementRouteCatalog";
import { createMovementPage } from "../domain/movement";
import { startTransientMovement } from "../services/movementEngine";
import { showNotification } from "@mantine/notifications";
import { getTrackCanvasHitElement } from "./track-canvas/trackCanvasRuntimeHitTest";
import { RouteButtonElement } from "../models/editor/elements/RouteButtonElement";
import { TrackSignalElement } from "../models/editor/elements/TrackSignalElement";
import { TrackLevelCrossingElement } from "../models/editor/elements/TrackLevelCrossingElement";
import { EditorTool } from "../models/editor/types/EditorTypes";
import { subscribeCanvasImageCache } from "../models/editor/rendering/ImageCache";
import { useCommandCenter } from "../context/CommandCenterContext";
import { useEditorSettings } from "../context/EditorSettingsContext";
import { fastClockStore } from "../services/fastClockStore";
import {
  hasMovingMovementBlockRuntime,
  subscribeMovementBlockRuntime,
} from "../services/movementBlockRuntime";
import {
  getBlockTargetLocoAddress,
} from "../services/blockTargetLocoRuntime";

import {
  hasTrainTrackingPredictions,
  subscribeTrainTrackingPredictions,
} from "../services/trainTrackingPredictionRuntime";
import { wsClient } from "../services/wsClient";
import "../styles/TrackCanvas.css";

import {
  clamp,
  createCursorElement,
  closeTrackCanvasSignalAspectPopover,
  closeTrackCanvasDoubleTurnoutPopover,
  centerLayoutInView,
  drawScene,
  TrackCanvasBlockLocoPicker,
  TrackCanvasSignalAspectPopover,
  TrackCanvasDoubleTurnoutPopover,
  handleTrackCanvasClickableDown,
  handleTrackCanvasClickableUp,
  fitLayoutToView,
  getAllLayoutElements,
  getDistance,
  getMidpoint,
  handleTrackCanvasKeyDown,
  handleTrackCanvasMouseDown,
  handleTrackCanvasMouseMove,
  handleTrackCanvasWheel,
  getSelectionRect,
  loadSavedViewState,
  openTrackCanvasSignalAspectPopover,
  openTrackCanvasDoubleTurnoutPopover,
  registerTrackCanvasEventListeners,
  reopenTrackCanvasSignalAspectPopover,
  reopenTrackCanvasDoubleTurnoutPopover,
  saveViewState,
  screenToGrid,
  stopTrackCanvasInteraction,
  syncClockElementsWithFastClock,
  type CanvasSize,
  type DoubleTurnoutPopoverState,
  type DragState,
  type PanState,
  type PinchState,
  type PointerPanState,
  type SelectionState,
  type SignalAspectPopoverState,
  type TouchPoint,
  type TrackCanvasProps,
  type ViewState,
} from "./track-canvas";

export default function TrackCanvas({
  editMode = false,
  onBlockSelectionChange,
  tool,
  onToolChange,
  layout,
  onLayoutChange,
  onBeforeLayoutChange,
  selectedElement,
  onSelectedElementChange,
  invalidateCounter,
  onInvalidate,
  fitCounter,
  centerCounter = 0,
  viewStorageKey,
  turnoutSelectionMode,
  setBusy,
  locos,
}: TrackCanvasProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { colorScheme } = useMantineColorScheme();
  const commandCenter = useCommandCenter();
  const { settings } = useEditorSettings();

  const [mouseGrid, setMouseGrid] = useState({ x: 0, y: 0 });
  const [hoverGrid, setHoverGrid] = useState<{ x: number; y: number } | null>(null);
  const [currentCursor, setCurrentCursor] = useState<BaseElement | null>(null);
  const [drawVersion, setDrawVersion] = useState(0);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [locoPickerOpen, setLocoPickerOpen] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<BlockElement | null>(null);
  const [blockSelection, setBlockSelection] = useState<{ loco: Loco; sourceId: number; routes: MovementRouteCandidate[] } | null>(null);
  const blockSelectionRef = useRef<{ loco: Loco; sourceId: number; routes: MovementRouteCandidate[] } | null>(null);
  const blockSelectionBusyRef = useRef(false);
  const onBlockSelectionChangeRef = useRef(onBlockSelectionChange);
  onBlockSelectionChangeRef.current = onBlockSelectionChange;

  const exitBlockSelection = () => {
    blockSelectionRef.current = null;
    setBlockSelection(null);
    onBlockSelectionChangeRef.current?.(false);
    canvasRef.current && (canvasRef.current.style.cursor = "default");
  };

  const startBlockSelection = async (loco: Loco) => {
    if (editModeRef.current || blockSelectionRef.current) return;
    const tracking = getTrainTrackingState();
    const current = tracking.locos.find(item => item.locoAddress === loco.address);
    const sourceId = current?.currentBlockId;
    if (!tracking.enabled || !tracking.active || !tracking.ready ||
        current?.confidence !== "certain" || sourceId == null) {
      showNotification({ color: "orange", message: "Drive to Block requires a confirmed current locomotive block." });
      return;
    }
    // Lock the editor while the asynchronously loaded destinations are prepared.
    const state = { loco, sourceId, routes: [] as MovementRouteCandidate[] };
    blockSelectionRef.current = state;
    setBlockSelection(state);
    onBlockSelectionChangeRef.current?.(true);
    try {
      const routes = await loadMovementRouteCandidates(await loadAutomationMovement());
      if (blockSelectionRef.current !== state) return;
      const next = { ...state, routes: routes.filter(route =>
        route.fromBlockId === sourceId && route.toBlockId !== sourceId &&
        route.locoDirection !== "unknown" && route.blockPath.length >= 2) };
      if (!next.routes.length) {
        showNotification({ color: "orange", message: "No reachable destination in the route topology." });
        exitBlockSelection();
        return;
      }
      blockSelectionRef.current = next;
      setBlockSelection(next);
    } catch (error) {
      showNotification({ color: "red", message: error instanceof Error ? error.message : String(error) });
      exitBlockSelection();
    }
  };

  const selectDestination = (hit: BaseElement | null) => {
    const state = blockSelectionRef.current;
    if (!state) return false;
    if (blockSelectionBusyRef.current) return true;
    if (!(hit instanceof BlockElement) || !state.routes.some(route => route.toBlockId === hit.id)) {
      exitBlockSelection();
      return true;
    }
    const route = state.routes.find(route => route.toBlockId === hit.id)!;
    const live = getTrainTrackingState();
    const current = live.locos.find(item => item.locoAddress === state.loco.address);
    if (!live.enabled || !live.active || !live.ready || current?.confidence !== "certain" ||
        current.currentBlockId !== state.sourceId) {
      showNotification({ color: "orange", message: "Locomotive position changed. Select Drive to Block again." });
      exitBlockSelection();
      return true;
    }
    blockSelectionBusyRef.current = true;
    const page = applyMovementRouteCandidate(createMovementPage(), route);
    page.id = `quick-route-loco-${state.loco.address}`;
    page.name = `Quick route · #${state.loco.address} · ${route.blockPath.map(block => block.name).join(" → ")}`;
    page.expectedLocoAddress = state.loco.address;
    // Retain the speed last selected in the existing Drive-to-Block dialog.
    let preferredSpeed = 20;
    try {
      const saved = Number(localStorage.getItem("dccexpresshub.loco-target-block.speed"));
      if (Number.isFinite(saved) && saved >= 1) preferredSpeed = Math.round(saved);
    } catch { /* storage may be unavailable */ }
    page.speed = Math.max(1, Math.min(preferredSpeed,
      state.loco.maxSpeed > 0 ? state.loco.maxSpeed : 126));
    void startTransientMovement(page).then(() => {
      exitBlockSelection();
    }).catch(error => {
      showNotification({ color: "red", message: error instanceof Error ? error.message : String(error) });
      exitBlockSelection();
    }).finally(() => { blockSelectionBusyRef.current = false; });
    return true;
  };
  const selectDestinationRef = useRef(selectDestination);
  selectDestinationRef.current = selectDestination;

  const [signalAspectPopover, setSignalAspectPopover] =
    useState<SignalAspectPopoverState>({
      opened: false,
      x: 0,
      y: 0,
      signal: null,
      previews: null,
    });

  const [doubleTurnoutPopover, setDoubleTurnoutPopover] =
    useState<DoubleTurnoutPopoverState>({
      opened: false,
      x: 0,
      y: 0,
      turnout: null,
    });

  const drawRafRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const turnoutSelectionModeRef = useRef(false);
  const touchPointsRef = useRef<Map<number, TouchPoint>>(new Map());
  const viewRef = useRef<ViewState>(
    loadSavedViewState(viewStorageKey)
  );
  const panRef = useRef<PanState>({ isPanning: false, lastX: 0, lastY: 0 });
  const dragRef = useRef<DragState>({
    isDraggingElement: false,
    elementId: null,
    startMouseGridX: 0,
    startMouseGridY: 0,
    startElementX: 0,
    startElementY: 0,
    draggedElements: [],
  });
  const selectionRef = useRef<SelectionState>({
    isSelecting: false,
    additive: false,
    startGridX: 0,
    startGridY: 0,
    endGridX: 0,
    endGridY: 0,
  });
  const pointerPanRef = useRef<PointerPanState>({
    activePointerId: null,
    isTouchPanning: false,
  });
  const pinchRef = useRef<PinchState>({
    isPinching: false,
    pointer1Id: null,
    pointer2Id: null,
    startDistance: 0,
    startScale: 1,
    worldCenterX: 0,
    worldCenterY: 0,
  });

  const layoutRef = useRef(layout);
  const toolRef = useRef(tool);
  const editModeRef = useRef(editMode);
  const selectedElementRef = useRef<BaseElement | null>(selectedElement);
  const currentCursorRef = useRef<BaseElement | null>(currentCursor);
  const pendingCopiedCursorRef = useRef<BaseElement | null>(null);
  const signalAspectPopoverRef = useRef(signalAspectPopover);
  const doubleTurnoutPopoverRef = useRef(doubleTurnoutPopover);
  const commandCenterRef = useRef(commandCenter);
  const pressedClickableRef = useRef<BaseElement | null>(null);

  // Runtime popup taps are tracked from pointerdown to pointerup.
  // This prevents a small finger movement from re-hit-testing another element
  // and prevents the same tap from falling through into a newly opened popup.
  const pendingRuntimePopupTapRef = useRef<{
    pointerId: number;
    element:
      | TrackSignalElement
      | TrackTurnoutDoubleElement
      | TrackTurnoutThreeWayElement;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  // Some mobile browsers still emit compatibility mouse events after touch.
  // Ignore those briefly so a touch cannot also execute the desktop mouse path.
  const suppressMouseUntilRef = useRef(0);

  const requestDraw = useCallback(() => {
    if (drawRafRef.current !== null) {
      return;
    }

    drawRafRef.current = window.requestAnimationFrame(() => {
      drawRafRef.current = null;

      if (!mountedRef.current) {
        return;
      }

      setDrawVersion(prev => prev + 1);
    });
  }, []);

  const invalidate = useCallback(() => {
    requestDraw();
  }, [requestDraw]);

  const persistView = () => {
    saveViewState(viewRef.current, viewStorageKey);
  };

  const openSignalAspectPopover = (
    signal: TrackSignalElement,
    clientX: number,
    clientY: number
  ) => {
    openTrackCanvasSignalAspectPopover(
      setSignalAspectPopover,
      signal,
      clientX,
      clientY
    );
  };

  const closeSignalAspectPopover = () => {
    closeTrackCanvasSignalAspectPopover(setSignalAspectPopover);
  };

  const reopenSignalAspectPopover = (
    signal: TrackSignalElement,
    clientX: number,
    clientY: number
  ) => {
    reopenTrackCanvasSignalAspectPopover(
      setSignalAspectPopover,
      signal,
      clientX,
      clientY
    );
  };

  const openDoubleTurnoutPopover = (
    turnout: TrackTurnoutDoubleElement | TrackTurnoutThreeWayElement,
    clientX: number,
    clientY: number
  ) => {
    openTrackCanvasDoubleTurnoutPopover(
      setDoubleTurnoutPopover,
      turnout,
      clientX,
      clientY
    );
  };

  const closeDoubleTurnoutPopover = () => {
    closeTrackCanvasDoubleTurnoutPopover(setDoubleTurnoutPopover);
  };

  const reopenDoubleTurnoutPopover = (
    turnout: TrackTurnoutDoubleElement | TrackTurnoutThreeWayElement,
    clientX: number,
    clientY: number
  ) => {
    reopenTrackCanvasDoubleTurnoutPopover(
      setDoubleTurnoutPopover,
      turnout,
      clientX,
      clientY
    );
  };

  const setRouteTurnoutsMarked = (rb: RouteButtonElement) => {
    const elems = layoutRef.current.getAllElements();
    for (const elem of elems) {
      const isRouteTurnout =
        isTurnoutElement(elem) ||
        elem instanceof TrackTurnoutDoubleElement ||
        elem instanceof TrackTurnoutThreeWayElement;

      if (isRouteTurnout) {
        const found = rb.routeTurnouts.find(e => e.turnoutId === elem.id);
        elem.marked = Boolean(found);
      }
    }

    invalidate();
  };

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (drawRafRef.current !== null) {
        window.cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    commandCenterRef.current = commandCenter;
  }, [commandCenter]);

  useEffect(() => {
    const applyTurnoutRuntime = (
      address: number,
      physicalValue: boolean
    ) => {
      for (const element of layout.getAllElements()) {
        if (
          isTurnoutElement(element) &&
          element.outputMode === "accessory" &&
          element.turnoutAddress === address
        ) {
          element.turnoutClosed = physicalValue;
          continue;
        }

        if (
          (
            element instanceof TrackTurnoutDoubleElement ||
            element instanceof TrackTurnoutThreeWayElement
          ) &&
          element.outputMode === "accessory"
        ) {
          if (element.turnout1Address === address) {
            element.turnout1Closed = physicalValue;
          }

          if (element.turnout2Address === address) {
            element.turnout2Closed = physicalValue;
          }
        }
      }

      // Every physical turnout/accessory event may change which legacy
      // RouteButton is active. Recalculate immediately and redraw.
      layout.checkRoutes();
      invalidate();
    };

    const unsubscribeTurnout =
      wsClient.on("turnoutChanged", data => {
        applyTurnoutRuntime(
          data.address,
          data.closed
        );
      });

    const unsubscribeAccessory =
      wsClient.on("accessoryChanged", data => {
        applyTurnoutRuntime(
          data.address,
          data.active
        );
      });

    return () => {
      unsubscribeTurnout();
      unsubscribeAccessory();
    };
  }, [layout, invalidate]);

  useEffect(() => {
    signalAspectPopoverRef.current = signalAspectPopover;
  }, [signalAspectPopover]);

  useEffect(() => {
    doubleTurnoutPopoverRef.current = doubleTurnoutPopover;
  }, [doubleTurnoutPopover]);

  useEffect(() => {
    return subscribeCanvasImageCache(() => {
      onInvalidate();
    });
  }, [onInvalidate]);

  useEffect(() => {
    void fastClockStore.ensureLoaded();

    return fastClockStore.subscribe(() => {
      invalidate();
    });
  }, [invalidate]);

  useEffect(() => {
    return subscribeMovementBlockRuntime(() => {
      invalidate();
    });
  }, [invalidate]);

  useEffect(() => {
    return subscribeTrainTrackingPredictions(
      () => {
        invalidate();
      }
    );
  }, [invalidate]);

  useEffect(() => {
    return wsClient.on("locoState", () => {
      /*
       * Block direction markers use the authoritative locomotive runtime
       * speed/direction cache. Redraw immediately when that live state changes
       * so manual throttle changes are reflected without waiting for an
       * unrelated layout/runtime event.
       */
      invalidate();
    });
  }, [invalidate]);

  // Level-crossing lamps use Date.now() to calculate their blink phase.
  // The canvas itself is otherwise event-driven, so without a periodic redraw
  // the mobile runtime view only appears to blink when some unrelated runtime
  // event (for example sensorSnapshot) happens.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const elements =
        layoutRef.current
          .getAllElements();

      const liveLocoMoving =
        elements.some(
          element => {
            if (
              !(element instanceof BlockElement)
            ) {
              return false;
            }

            const displayLocoAddress =
              element.locoAddress > 0
                ? element.locoAddress
                : getBlockTargetLocoAddress(
                    element.id
                  );

            return (
              displayLocoAddress > 0 &&
              (
                wsClient.getLatestLocoState(
                  displayLocoAddress
                )?.speed ??
                0
              ) > 0
            );
          }
        );

      const needsBlinkRedraw =
        hasMovingMovementBlockRuntime() ||
        hasTrainTrackingPredictions() ||
        liveLocoMoving ||
        elements.some(
          element =>
            element instanceof TrackLevelCrossingElement &&
            element.lightsEnabled &&
            element.blinkingEnabled
        );

      if (needsBlinkRedraw) {
        requestDraw();
      }
    }, 225);

    return () => {
      window.clearInterval(timer);
    };
  }, [requestDraw]);

  useEffect(() => {
    invalidate();
  }, [invalidateCounter, invalidate]);

  useEffect(() => {
    layoutRef.current = layout;
    onSelectedElementChange(null);
    layout.unselectAll();
  }, [layout, onSelectedElementChange]);

  useEffect(() => {
    toolRef.current = tool;
    layout.unselectAll();
    setHoverGrid(null);
  }, [tool, layout]);

  useEffect(() => {
    editModeRef.current = editMode;
    setHoverGrid(null);

    if (editMode) {
      if (signalAspectPopoverRef.current.opened) {
        closeSignalAspectPopover();
      }

      if (doubleTurnoutPopoverRef.current.opened) {
        closeDoubleTurnoutPopover();
      }
    }
  }, [editMode]);

  useEffect(() => {
    if (selectedElementRef.current instanceof RouteButtonElement) {
      const elems = layoutRef.current.getAllElements();
      elems.forEach(elem => {
        elem.marked = false;
      });
    }

    selectedElementRef.current = selectedElement;
    setHoverGrid(null);
  }, [selectedElement]);

  useEffect(() => {
    currentCursorRef.current = currentCursor;
  }, [currentCursor]);

  useEffect(() => {
    if (fitCounter === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    fitLayoutToView(layoutRef.current, viewRef.current, rect.width, rect.height);
    persistView();
    invalidate();
  }, [fitCounter]);

  useEffect(() => {
    if (centerCounter === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    centerLayoutInView(layoutRef.current, viewRef.current, rect.width, rect.height);
    persistView();
    invalidate();
  }, [centerCounter]);

  useEffect(() => {
    if (selectedElement) {
      layout.setSelected(selectedElement);
    } else {
      const hasAnySelected = getAllLayoutElements(layout).some(el => el.selected);
      if (!hasAnySelected) {
        layout.unselectAll();
      }
    }

    invalidate();
  }, [selectedElement, layout, invalidate]);

  useEffect(() => {
    onSelectedElementChange(null);
  }, [tool, onSelectedElementChange]);

  useEffect(() => {
    if (tool.mode !== "draw") {
      setCurrentCursor(null);
      layoutRef.current.unselectAll();
      return;
    }

    const pendingCopiedCursor =
      pendingCopiedCursorRef.current;

    if (
      pendingCopiedCursor &&
      pendingCopiedCursor.type ===
        tool.elementType
    ) {
      pendingCopiedCursorRef.current =
        null;

      pendingCopiedCursor.selected =
        true;

      canvasRef.current?.focus();

      setCurrentCursor(
        pendingCopiedCursor
      );

      return;
    }

    const cursor = createCursorElement(tool);
    cursor!.selected = true;
    canvasRef.current?.focus();
    setCurrentCursor(cursor);
  }, [tool]);

  useEffect(() => {
    invalidate();
  }, [layout, colorScheme, tool, mouseGrid, hoverGrid, editMode, currentCursor, invalidate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.focus();

    const parent = canvas.parentElement;
    if (!parent) return;

    const updateSize = () => {
      setCanvasSize({
        width: parent.clientWidth,
        height: parent.clientHeight,
      });
    };

    updateSize();

    const ro = new ResizeObserver(() => {
      if (signalAspectPopoverRef.current.opened) {
        closeSignalAspectPopover();
      }

      if (doubleTurnoutPopoverRef.current.opened) {
        closeDoubleTurnoutPopover();
      }

      updateSize();
    });

    ro.observe(parent);

    return () => {
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    turnoutSelectionModeRef.current = turnoutSelectionMode;

    const elems = layoutRef.current.getAllElements();

    if (turnoutSelectionMode) {
      for (const elem of elems) {
        elem.enabled =
          isTurnoutElement(elem) ||
          elem instanceof TrackTurnoutDoubleElement ||
          elem instanceof TrackTurnoutThreeWayElement;
      }

      if (selectedElementRef.current instanceof RouteButtonElement) {
        setRouteTurnoutsMarked(selectedElementRef.current);
      }
    } else {
      for (const elem of elems) {
        elem.enabled = true;
        elem.marked = false;
      }
    }
  }, [turnoutSelectionMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return;

    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.floor(canvasSize.width * dpr);
    canvas.height = Math.floor(canvasSize.height * dpr);
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    if (selectedElementRef.current instanceof RouteButtonElement) {
      setRouteTurnoutsMarked(selectedElementRef.current);
    }

    syncClockElementsWithFastClock(layout);

    drawScene(
      ctx,
      canvasSize.width,
      canvasSize.height,
      editMode,
      colorScheme,
      viewRef.current,
      mouseGrid,
      tool,
      hoverGrid,
      currentCursor,
      layout,
      settings,
      dragRef.current.elementId ?? 0,
      selectedElement ?? undefined,
      getSelectionRect(selectionRef.current),
      turnoutSelectionMode,
      locos || []
    );
    if (blockSelection?.routes.length) {
      ctx.save();
      ctx.setTransform(
        dpr * viewRef.current.scale, 0, 0, dpr * viewRef.current.scale,
        dpr * viewRef.current.offsetX, dpr * viewRef.current.offsetY
      );
      ctx.strokeStyle = "#ffd43b";
      ctx.lineWidth = 3 / viewRef.current.scale;
      for (const block of layout.blocks.elements) {
        if (!(block instanceof BlockElement) || !block.visible ||
            !blockSelection.routes.some(route => route.toBlockId === block.id)) continue;
        const bounds = block.getBounds();
        ctx.strokeRect(bounds.x * layout.gridSize, bounds.y * layout.gridSize,
          bounds.width * layout.gridSize, bounds.height * layout.gridSize);
      }
      ctx.restore();
    }
  }, [
    canvasSize,
    editMode,
    colorScheme,
    tool,
    currentCursor,
    layout,
    drawVersion,
    invalidateCounter,
    selectedElement,
    settings,
    turnoutSelectionMode,
    blockSelection,
    locos,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (ev: WheelEvent) => {
      handleTrackCanvasWheel(ev, {
        canvas,
        view: viewRef.current,
        isSignalAspectPopoverOpen: signalAspectPopoverRef.current.opened,
        closeSignalAspectPopover,
        persistView,
        invalidate,
      });
    };

    const handleClickableDown = (
      hitElement: BaseElement | null,
      ev: MouseEvent | PointerEvent
    ): boolean => {
      const handled = handleTrackCanvasClickableDown(
        hitElement,
        ev,
        {
          layout: layoutRef.current,
          t,
          commandCenterLocked: commandCenterRef.current.locked,
          setBusy,
          invalidate,
        }
      );
      if (handled) {
        pressedClickableRef.current = hitElement;
        invalidate();
      }
      return handled;
    };

    const handleClickableUp = (
      hitElement: BaseElement | null,
      ev: MouseEvent | PointerEvent
    ): boolean => {
      const pressedElement = pressedClickableRef.current ?? hitElement;
      pressedClickableRef.current = null;
      const handled = handleTrackCanvasClickableUp(pressedElement, ev);
      if (handled) {
        invalidate();
      }
      return handled;
    };

    const handleMouseDown = (ev: MouseEvent) => {
      if (Date.now() < suppressMouseUntilRef.current) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }

      if (blockSelectionRef.current && ev.button === 0) {
        const rect = canvas.getBoundingClientRect();
        const grid = screenToGrid(ev.clientX - rect.left, ev.clientY - rect.top,
          viewRef.current, layoutRef.current.gridSize);
        selectDestinationRef.current(getTrackCanvasHitElement(layoutRef.current, grid.x, grid.y, false));
        ev.preventDefault();
        return;
      }
      handleTrackCanvasMouseDown(ev, {
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
      });
    };

    const handleMouseMove = (ev: MouseEvent) => {
      handleTrackCanvasMouseMove(ev, {
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
      });
      if (blockSelectionRef.current) {
        const rect = canvas.getBoundingClientRect();
        const grid = screenToGrid(ev.clientX - rect.left, ev.clientY - rect.top,
          viewRef.current, layoutRef.current.gridSize);
        const hit = getTrackCanvasHitElement(layoutRef.current, grid.x, grid.y, false);
        canvas.style.cursor = hit instanceof BlockElement &&
          blockSelectionRef.current.routes.some(route => route.toBlockId === hit.id)
          ? "pointer" : "default";
      }
    };

    const stopInteraction = () => {
      stopTrackCanvasInteraction({
        canvas,
        layoutRef,
        dragRef,
        panRef,
        selectionRef,
        currentCursorRef,
        setHoverGrid,
        onSelectedElementChange,
        onLayoutChange,
        persistView,
        invalidate,
      });
    };

    const handleMouseUp = (ev: MouseEvent) => {
      if (Date.now() < suppressMouseUntilRef.current) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }

      if (!editModeRef.current && ev.button === 0) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = ev.clientX - rect.left;
        const mouseY = ev.clientY - rect.top;
        const grid = screenToGrid(
          mouseX,
          mouseY,
          viewRef.current,
          layoutRef.current.gridSize
        );
        const hitElement = getTrackCanvasHitElement(layoutRef.current, grid.x, grid.y, editModeRef.current);
        handleClickableUp(hitElement, ev);
        return;
      }

      stopInteraction();
    };

    const handleMouseLeave = () => {
      if (pressedClickableRef.current) {
        handleClickableUp(pressedClickableRef.current, new MouseEvent("mouseup"));
      }
      stopInteraction();
      setHoverGrid(null);
    };

    const handleContextMenu = (ev: MouseEvent) => {
      ev.preventDefault();
    };

    const handlePointerDown = (ev: PointerEvent) => {
      if (ev.pointerType !== "touch") return;

      ev.preventDefault();
      ev.stopPropagation();
      suppressMouseUntilRef.current = Date.now() + 1000;

      if (
        pendingRuntimePopupTapRef.current &&
        pendingRuntimePopupTapRef.current.pointerId !== ev.pointerId
      ) {
        pendingRuntimePopupTapRef.current = null;
      }

      const currentLayout = layoutRef.current;
      const currentTool = toolRef.current;
      const rect = canvas.getBoundingClientRect();
      const mouseX = ev.clientX - rect.left;
      const mouseY = ev.clientY - rect.top;

      touchPointsRef.current.set(ev.pointerId, { x: mouseX, y: mouseY });

      const grid = screenToGrid(
        mouseX,
        mouseY,
        viewRef.current,
        currentLayout.gridSize
      );

      const hitElement = getTrackCanvasHitElement(currentLayout, grid.x, grid.y, editModeRef.current);

      if (!editModeRef.current) {
        if (blockSelectionRef.current) {
          selectDestinationRef.current(hitElement);
          return;
        }
        if (hitElement instanceof AudioButtonElement) {
          hitElement.press(() => {
            invalidate();
          });

          try {
            canvas.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }

          return;
        }

        if (hitElement instanceof BlockElement) {
          ev.stopPropagation();
          setSelectedBlock(hitElement);

          window.setTimeout(() => {
            setLocoPickerOpen(true);
          }, 100);

          try {
            canvas.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }

          return;
        }

        if (hitElement instanceof TrackSignalElement) {
          if (doubleTurnoutPopoverRef.current.opened) {
            closeDoubleTurnoutPopover();
          }

          pendingRuntimePopupTapRef.current = {
            pointerId: ev.pointerId,
            element: hitElement,
            startX: mouseX,
            startY: mouseY,
            moved: false,
          };

          try {
            canvas.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
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

          pendingRuntimePopupTapRef.current = {
            pointerId: ev.pointerId,
            element: hitElement,
            startX: mouseX,
            startY: mouseY,
            moved: false,
          };

          try {
            canvas.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }

          return;
        }

        if (signalAspectPopoverRef.current.opened) {
          closeSignalAspectPopover();
          return;
        }

        if (doubleTurnoutPopoverRef.current.opened) {
          closeDoubleTurnoutPopover();
          return;
        }

        if (currentTool.mode === "cursor") {
          if (handleClickableDown(hitElement, ev)) {
            try {
              canvas.setPointerCapture(ev.pointerId);
            } catch {
              // ignore
            }

            return;
          }
        }
      }

      const points = Array.from(touchPointsRef.current.entries());

      if (points.length === 1) {
        pointerPanRef.current.activePointerId = ev.pointerId;
        pointerPanRef.current.isTouchPanning = true;
        panRef.current.isPanning = true;
        panRef.current.lastX = ev.clientX;
        panRef.current.lastY = ev.clientY;
        pinchRef.current.isPinching = false;
        pinchRef.current.pointer1Id = null;
        pinchRef.current.pointer2Id = null;
        canvas.style.cursor = "grabbing";
      } else if (points.length === 2) {
        const [p1, p2] = points;
        if (!p1 || !p2) return;

        const pt1 = p1[1];
        const pt2 = p2[1];
        const midpoint = getMidpoint(pt1, pt2);
        const startDistance = getDistance(pt1, pt2);

        if (startDistance > 0) {
          pinchRef.current.isPinching = true;
          pinchRef.current.pointer1Id = p1[0];
          pinchRef.current.pointer2Id = p2[0];
          pinchRef.current.startDistance = startDistance;
          pinchRef.current.startScale = viewRef.current.scale;
          pinchRef.current.worldCenterX =
            (midpoint.x - viewRef.current.offsetX) / viewRef.current.scale;
          pinchRef.current.worldCenterY =
            (midpoint.y - viewRef.current.offsetY) / viewRef.current.scale;
          pointerPanRef.current.isTouchPanning = false;
          pointerPanRef.current.activePointerId = null;
          panRef.current.isPanning = false;
        }
      }

      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch {
        // ignore
      }
    };

    const handlePointerMove = (ev: PointerEvent) => {
      if (ev.pointerType !== "touch") return;

      suppressMouseUntilRef.current = Date.now() + 1000;

      const rect = canvas.getBoundingClientRect();
      const mouseX = ev.clientX - rect.left;
      const mouseY = ev.clientY - rect.top;

      touchPointsRef.current.set(ev.pointerId, { x: mouseX, y: mouseY });

      const pendingPopupTap = pendingRuntimePopupTapRef.current;
      if (
        pendingPopupTap &&
        pendingPopupTap.pointerId === ev.pointerId
      ) {
        const dx = mouseX - pendingPopupTap.startX;
        const dy = mouseY - pendingPopupTap.startY;

        if (Math.hypot(dx, dy) > 12) {
          pendingPopupTap.moved = true;
        }

        ev.preventDefault();
        ev.stopPropagation();
        return;
      }

      const currentLayout = layoutRef.current;
      const grid = screenToGrid(
        mouseX,
        mouseY,
        viewRef.current,
        currentLayout.gridSize
      );

      setMouseGrid(prev =>
        prev.x === grid.x && prev.y === grid.y
          ? prev
          : { x: grid.x, y: grid.y }
      );

      if (pinchRef.current.isPinching) {
        const id1 = pinchRef.current.pointer1Id;
        const id2 = pinchRef.current.pointer2Id;
        if (id1 == null || id2 == null) return;

        const pt1 = touchPointsRef.current.get(id1);
        const pt2 = touchPointsRef.current.get(id2);
        if (!pt1 || !pt2) return;

        ev.preventDefault();

        const midpoint = getMidpoint(pt1, pt2);
        const distance = getDistance(pt1, pt2);

        if (pinchRef.current.startDistance > 0 && distance > 0) {
          const zoomFactor = distance / pinchRef.current.startDistance;
          const newScale = clamp(pinchRef.current.startScale * zoomFactor, 0.2, 4);

          viewRef.current.scale = newScale;
          viewRef.current.offsetX =
            midpoint.x - pinchRef.current.worldCenterX * newScale;
          viewRef.current.offsetY =
            midpoint.y - pinchRef.current.worldCenterY * newScale;

          persistView();
          invalidate();
        }

        return;
      }

      if (!pointerPanRef.current.isTouchPanning) return;
      if (pointerPanRef.current.activePointerId !== ev.pointerId) return;

      ev.preventDefault();

      const dx = ev.clientX - panRef.current.lastX;
      const dy = ev.clientY - panRef.current.lastY;

      panRef.current.lastX = ev.clientX;
      panRef.current.lastY = ev.clientY;
      viewRef.current.offsetX += dx;
      viewRef.current.offsetY += dy;

      persistView();
      invalidate();
    };

    const handlePointerUp = (ev: PointerEvent) => {
      if (ev.pointerType !== "touch") return;

      ev.preventDefault();
      ev.stopPropagation();
      suppressMouseUntilRef.current = Date.now() + 1000;

      const pendingPopupTap = pendingRuntimePopupTapRef.current;

      if (
        pendingPopupTap &&
        pendingPopupTap.pointerId === ev.pointerId
      ) {
        pendingRuntimePopupTapRef.current = null;
        touchPointsRef.current.delete(ev.pointerId);

        pointerPanRef.current.activePointerId = null;
        pointerPanRef.current.isTouchPanning = false;
        panRef.current.isPanning = false;

        try {
          canvas.releasePointerCapture(ev.pointerId);
        } catch {
          // ignore
        }

        if (!pendingPopupTap.moved) {
          const popupElement = pendingPopupTap.element;
          const popupClientX = ev.clientX;
          const popupClientY = ev.clientY;

          // Wait until the browser has finished the complete tap/click
          // compatibility sequence. The popup must not exist while that
          // originating gesture is still being dispatched.
          window.setTimeout(() => {
            if (!mountedRef.current) {
              return;
            }

            if (popupElement instanceof TrackSignalElement) {
              if (doubleTurnoutPopoverRef.current.opened) {
                closeDoubleTurnoutPopover();
              }

              if (signalAspectPopoverRef.current.opened) {
                reopenSignalAspectPopover(
                  popupElement,
                  popupClientX,
                  popupClientY
                );
              } else {
                openSignalAspectPopover(
                  popupElement,
                  popupClientX,
                  popupClientY
                );
              }

              return;
            }

            if (signalAspectPopoverRef.current.opened) {
              closeSignalAspectPopover();
            }

            const currentRect = canvas.getBoundingClientRect();
            const turnoutBounds = popupElement.getBounds();

            const turnoutCenterWorldX =
              (
                turnoutBounds.x +
                turnoutBounds.width / 2
              ) *
              layoutRef.current.gridSize;

            const turnoutCenterClientX =
              currentRect.left +
              viewRef.current.offsetX +
              turnoutCenterWorldX *
                viewRef.current.scale;

            if (doubleTurnoutPopoverRef.current.opened) {
              reopenDoubleTurnoutPopover(
                popupElement,
                turnoutCenterClientX,
                popupClientY
              );
            } else {
              openDoubleTurnoutPopover(
                popupElement,
                turnoutCenterClientX,
                popupClientY
              );
            }
          }, 50);
        }

        return;
      }

      const rect = canvas.getBoundingClientRect();

      if (!editModeRef.current) {
        const mouseX = ev.clientX - rect.left;
        const mouseY = ev.clientY - rect.top;
        const grid = screenToGrid(
          mouseX,
          mouseY,
          viewRef.current,
          layoutRef.current.gridSize
        );
        const hitElement = getTrackCanvasHitElement(layoutRef.current, grid.x, grid.y, editModeRef.current);
        handleClickableUp(hitElement, ev);
      }

      touchPointsRef.current.delete(ev.pointerId);
      const remaining = Array.from(touchPointsRef.current.entries());

      if (pinchRef.current.isPinching) {
        pinchRef.current.isPinching = false;
        pinchRef.current.pointer1Id = null;
        pinchRef.current.pointer2Id = null;

        if (remaining.length === 1) {
          const [id, pt] = remaining[0]!;
          pointerPanRef.current.activePointerId = id;
          pointerPanRef.current.isTouchPanning = true;
          panRef.current.isPanning = true;
          panRef.current.lastX = pt.x + rect.left;
          panRef.current.lastY = pt.y + rect.top;
        }
      } else if (pointerPanRef.current.activePointerId === ev.pointerId) {
        pointerPanRef.current.activePointerId = null;
        pointerPanRef.current.isTouchPanning = false;
        panRef.current.isPanning = false;
      }

      if (touchPointsRef.current.size === 0) {
        pointerPanRef.current.activePointerId = null;
        pointerPanRef.current.isTouchPanning = false;
        pinchRef.current.isPinching = false;
        pinchRef.current.pointer1Id = null;
        pinchRef.current.pointer2Id = null;
        stopInteraction();
      } else {
        persistView();
        invalidate();
      }

      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch {
        // ignore
      }
    };

    const handlePointerCancel = (ev: PointerEvent) => {
      if (ev.pointerType !== "touch") return;

      suppressMouseUntilRef.current = Date.now() + 1000;

      if (
        pendingRuntimePopupTapRef.current?.pointerId === ev.pointerId
      ) {
        pendingRuntimePopupTapRef.current = null;
      }

      if (pressedClickableRef.current) {
        handleClickableUp(pressedClickableRef.current, ev);
      }

      touchPointsRef.current.delete(ev.pointerId);
      pointerPanRef.current.activePointerId = null;
      pointerPanRef.current.isTouchPanning = false;
      pinchRef.current.isPinching = false;
      pinchRef.current.pointer1Id = null;
      pinchRef.current.pointer2Id = null;
      stopInteraction();

      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch {
        // ignore
      }
    };

    return registerTrackCanvasEventListeners(
      canvas,
      {
        handleWheel,
        handleMouseDown,
        handleMouseLeave,
        handleContextMenu,
        handleMouseMove,
        handleMouseUp,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        handlePointerCancel,
      }
    );
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (blockSelectionRef.current && event.key === "Escape") {
        exitBlockSelection();
        event.preventDefault();
        return;
      }
      handleTrackCanvasKeyDown(event, {
        canvasRef,
        layoutRef,
        toolRef,
        editModeRef,
        currentCursorRef,
        selectedElementRef,
        pendingCopiedCursorRef,
        viewRef,
        setCurrentCursor,
        onToolChange,
        onBeforeLayoutChange,
        onLayoutChange,
        onSelectedElementChange,
        closeSignalAspectPopover,
        persistView,
        invalidate,
      });
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <>
      <canvas tabIndex={0} ref={canvasRef} className="track-canvas" />

      <TrackCanvasSignalAspectPopover
        state={signalAspectPopover}
        onClose={closeSignalAspectPopover}
      />

      <TrackCanvasDoubleTurnoutPopover
        state={doubleTurnoutPopover}
        onClose={closeDoubleTurnoutPopover}
      />

      <TrackCanvasBlockLocoPicker
        opened={locoPickerOpen}
        locos={locos}
        selectedBlock={selectedBlock}
        onClose={() => setLocoPickerOpen(false)}
        onBeginBlockSelection={startBlockSelection}
        blockSelectionActive={blockSelection !== null}
      />
    </>
  );
}
