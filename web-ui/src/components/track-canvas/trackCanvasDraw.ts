import type { Loco } from "@domain/types";
import type { BaseElementView } from "../../models/editor/core/BaseElementView";
import type { LayoutView } from "../../models/editor/core/LayoutView";
import type { EditorSettings } from "../../context/EditorSettingsContext";
import type { DrawOptions, EditorTool } from "../../models/editor/types/EditorTypes";
import type { SelectionRect, ViewState } from "./TrackCanvas.types";
import { getCenteredElementGridAnchor } from "./trackCanvasGeometry";
import { normalizeSelectionRect } from "./trackCanvasSelection";

export type TrackCanvasColorScheme = "light" | "dark" | "auto";

type DebugPoint = { x: number; y: number };
type DebugTurnoutRoute = {
  from: string;
  to: string;
  turnoutStates: readonly { closed: boolean }[];
};
type DebugRouteAwareElement = BaseElementView & {
  getAllowedRoutes?: () => DebugTurnoutRoute[];
  getConnections?: () => Record<string, DebugPoint>;
  turnout1Closed?: boolean;
  turnout2Closed?: boolean;
};

function drawDebugPoint(
  ctx: CanvasRenderingContext2D,
  point: DebugPoint,
  gridSize: number,
  scale: number,
  color: string,
  label: string,
  radius = 5
): void {
  const safeScale = Math.max(scale, 0.01);
  const x = point.x * gridSize + gridSize / 2;
  const y = point.y * gridSize + gridSize / 2;

  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1 / safeScale;
  ctx.arc(x, y, radius / safeScale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.font = `${11 / safeScale}px monospace`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = color;
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 3 / safeScale;

  const text = `${label} (${point.x},${point.y})`;
  const tx = x + 7 / safeScale;
  const ty = y - 5 / safeScale;
  ctx.strokeText(text, tx, ty);
  ctx.fillText(text, tx, ty);
}

function drawDebugConnectionLine(
  ctx: CanvasRenderingContext2D,
  first: DebugPoint,
  second: DebugPoint,
  gridSize: number,
  scale: number,
  color: string,
  dashed: boolean
): void {
  const safeScale = Math.max(scale, 0.01);
  const firstX = first.x * gridSize + gridSize / 2;
  const firstY = first.y * gridSize + gridSize / 2;
  const secondX = second.x * gridSize + gridSize / 2;
  const secondY = second.y * gridSize + gridSize / 2;

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 / safeScale;
  ctx.setLineDash(dashed ? [6 / safeScale, 4 / safeScale] : []);
  ctx.moveTo(firstX, firstY);
  ctx.lineTo(secondX, secondY);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawSelectedTrackDebugOverlay(
  ctx: CanvasRenderingContext2D,
  selected: BaseElementView | undefined,
  gridSize: number,
  scale: number
): void {
  if (!selected || selected.layerName !== "track") return;

  ctx.save();
  const safeScale = Math.max(scale, 0.01);
  const centerX = selected.x * gridSize + gridSize / 2;
  const centerY = selected.y * gridSize + gridSize / 2;

  for (const point of selected.getNeigbordsXy()) {
    drawDebugPoint(ctx, point, gridSize, safeScale, "#339af0", "NB", 4);
  }

  for (const pair of selected.getNeighborPointPairs()) {
    drawDebugConnectionLine(ctx, pair[0], pair[1], gridSize, safeScale, "#22b8cf", true);
  }

  const prev = selected.getPrevItemXy();
  const next = selected.getNextItemXy();
  drawDebugPoint(ctx, prev, gridSize, safeScale, "#ff922b", "PREV", 6);
  drawDebugPoint(ctx, next, gridSize, safeScale, "#51cf66", "NEXT", 6);

  const routeAware = selected as DebugRouteAwareElement;
  if (
    typeof routeAware.getAllowedRoutes === "function" &&
    typeof routeAware.getConnections === "function" &&
    typeof routeAware.turnout1Closed === "boolean" &&
    typeof routeAware.turnout2Closed === "boolean"
  ) {
    const activeRoute = routeAware.getAllowedRoutes().find(route =>
      route.turnoutStates.length >= 2 &&
      route.turnoutStates[0]!.closed === routeAware.turnout1Closed &&
      route.turnoutStates[1]!.closed === routeAware.turnout2Closed
    );

    if (activeRoute) {
      const connections = routeAware.getConnections();
      const from = connections[activeRoute.from];
      const to = connections[activeRoute.to];
      if (from && to) {
        drawDebugConnectionLine(ctx, from, to, gridSize, safeScale, "#e64980", false);
        drawDebugPoint(ctx, from, gridSize, safeScale, "#e64980", `ACTIVE ${activeRoute.from}`, 7);
        drawDebugPoint(ctx, to, gridSize, safeScale, "#e64980", `ACTIVE ${activeRoute.to}`, 7);
      }
    }
  }

  ctx.font = `${12 / safeScale}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 4 / safeScale;

  let stateText = `${selected.type} #${selected.id} rot=${selected.rotation}°`;
  if (
    typeof routeAware.turnout1Closed === "boolean" &&
    typeof routeAware.turnout2Closed === "boolean"
  ) {
    stateText += ` bits=${Number(routeAware.turnout1Closed)}/${Number(routeAware.turnout2Closed)}`;
  }

  ctx.strokeText(stateText, centerX, centerY - gridSize * 0.6);
  ctx.fillText(stateText, centerX, centerY - gridSize * 0.6);
  ctx.restore();
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  editMode: boolean,
  colorScheme: TrackCanvasColorScheme,
  view: ViewState,
  mouseGrid: { x: number; y: number },
  tool: EditorTool,
  hoverGrid: { x: number; y: number } | null,
  currentCursor: BaseElementView | null,
  layout: LayoutView,
  settings: EditorSettings,
  dragId?: number,
  selected?: BaseElementView,
  selectionRect?: SelectionRect | null,
  turnoutSelectionMode?: boolean,
  locos?: Loco[]
): void {
  const isDark = colorScheme !== "light";
  ctx.clearRect(0, 0, width, height);
  drawBackground(ctx, width, height, isDark);

  ctx.save();
  ctx.translate(view.offsetX, view.offsetY);
  ctx.scale(view.scale, view.scale);

  if (settings.showGrid) {
    drawGrid(ctx, width, height, layout.gridSize, isDark, view);
  }

  if (hoverGrid) {
    const gridSize = layout.gridSize;
    ctx.strokeStyle = "#ef4444";
    ctx.fillStyle = "#ef444450";
    ctx.lineWidth = 2 / view.scale;
    ctx.fillRect(hoverGrid.x * gridSize, hoverGrid.y * gridSize, gridSize, gridSize);
    ctx.strokeRect(hoverGrid.x * gridSize, hoverGrid.y * gridSize, gridSize, gridSize);
  }

  const options: DrawOptions = {
    showOccupancySensorAddress: settings.showOccupacySensorAddress,
    showSensorAddress: settings.showSensorAddress,
    showTurnoutAddress: settings.showTurnoutAddress,
    showSignalAddress: settings.showSignalAddress,
    showSection: settings.showSegments,
    showBlockNames: settings.showBlockNames,
    darkMode: isDark,
    locos: locos || [],
  };

  layout.draw(ctx, options);

  if (editMode) {
    drawSelectedTrackDebugOverlay(ctx, selected, layout.gridSize, view.scale);
  }

  if (currentCursor) {
    const cursorAnchor = getCenteredElementGridAnchor(currentCursor, mouseGrid);
    currentCursor.x = cursorAnchor.x;
    currentCursor.y = cursorAnchor.y;
    currentCursor.draw(ctx, {
      showOccupancySensorAddress: false,
      showSensorAddress: false,
      showSignalAddress: false,
      showTurnoutAddress: false,
      locos: [] as Loco[],
    });
  }

  if (selectionRect) {
    drawSelectionRect(ctx, layout.gridSize, selectionRect, view.scale);
  }

  ctx.restore();

  if (editMode) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawInfo(ctx, width, editMode, isDark, view.scale, mouseGrid, tool, currentCursor);
  }
}

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  isDark: boolean
): void {
  ctx.fillStyle = isDark ? "#313131" : "#F8F9FA";
  ctx.fillRect(0, 0, width, height);
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  gridSize: number,
  isDark: boolean,
  view: ViewState
): void {
  ctx.strokeStyle = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  ctx.lineWidth = 1 / view.scale;

  const worldLeft = -view.offsetX / view.scale;
  const worldTop = -view.offsetY / view.scale;
  const worldRight = worldLeft + width / view.scale;
  const worldBottom = worldTop + height / view.scale;
  const startX = Math.floor(worldLeft / gridSize) * gridSize;
  const endX = Math.ceil(worldRight / gridSize) * gridSize;
  const startY = Math.floor(worldTop / gridSize) * gridSize;
  const endY = Math.ceil(worldBottom / gridSize) * gridSize;

  for (let x = startX; x <= endX; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, worldTop);
    ctx.lineTo(x, worldBottom);
    ctx.stroke();
  }

  for (let y = startY; y <= endY; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(worldLeft, y);
    ctx.lineTo(worldRight, y);
    ctx.stroke();
  }
}

export function drawInfo(
  ctx: CanvasRenderingContext2D,
  width: number,
  editMode: boolean,
  isDark: boolean,
  scale: number,
  mouseGrid: { x: number; y: number },
  tool: EditorTool,
  currentCursor: BaseElementView | null
): void {
  const px = 20;
  const toolText = tool.mode === "cursor" ? "Kurzor" : `Rajz: ${tool.elementType}`;
  const rotationText = tool.mode === "draw" && currentCursor ? ` | Rot: ${currentCursor.rotation}°` : "";
  const text = `${editMode ? "Szerkesztési mód" : "Nézet mód"} | Tool: ${toolText}${rotationText} | Zoom: ${Math.round(scale * 100)}% | X: ${mouseGrid.x} Y: ${mouseGrid.y}`;

  ctx.fillStyle = isDark ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.85)";
  ctx.fillRect(px, 16, 470, 32);
  ctx.fillStyle = isDark ? "#ffffff" : "#000000";
  ctx.font = "13px sans-serif";
  ctx.fillText(text, px + 20, 36);
}

export function drawSelectionRect(
  ctx: CanvasRenderingContext2D,
  gridSize: number,
  rect: SelectionRect,
  scale: number
): void {
  const normalized = normalizeSelectionRect(rect);
  const x = normalized.left * gridSize;
  const y = normalized.top * gridSize;
  const width = (normalized.right - normalized.left + 1) * gridSize;
  const height = (normalized.bottom - normalized.top + 1) * gridSize;

  ctx.save();
  ctx.strokeStyle = "#339af0";
  ctx.fillStyle = "rgba(51, 154, 240, 0.18)";
  ctx.lineWidth = 2 / scale;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
}
