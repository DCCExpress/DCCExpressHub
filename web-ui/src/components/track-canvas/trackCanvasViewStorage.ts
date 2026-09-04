
import type {
  ViewState,
} from "./TrackCanvas.types";

const DEFAULT_VIEW_STORAGE_KEY =
  "dcc-express.editor.trackCanvas.view";

const SAVE_DEBOUNCE_MS = 250;

const pendingViewStates = new Map<string, ViewState>();
const saveTimers = new Map<string, number>();
let pageHideFlushRegistered = false;

function clamp(
  value: number,
  min: number,
  max: number
): number {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function writeViewState(
  view: ViewState,
  storageKey: string
): void {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify(view)
    );
  } catch {
    // Ignore storage errors. The canvas can still work with in-memory view state.
  }
}

function ensurePageHideFlushRegistered(): void {
  if (pageHideFlushRegistered || typeof window === "undefined") {
    return;
  }

  window.addEventListener("pagehide", () => {
    flushSavedViewState();
  });

  pageHideFlushRegistered = true;
}

export function loadSavedViewState(
  storageKey = DEFAULT_VIEW_STORAGE_KEY
): ViewState {
  try {
    const raw =
      localStorage.getItem(storageKey);

    if (!raw) {
      return {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
      };
    }

    const parsed =
      JSON.parse(raw) as Partial<ViewState>;

    return {
      scale:
        typeof parsed.scale === "number" &&
        Number.isFinite(parsed.scale)
          ? clamp(parsed.scale, 0.2, 4)
          : 1,
      offsetX:
        typeof parsed.offsetX === "number" &&
        Number.isFinite(parsed.offsetX)
          ? parsed.offsetX
          : 0,
      offsetY:
        typeof parsed.offsetY === "number" &&
        Number.isFinite(parsed.offsetY)
          ? parsed.offsetY
          : 0,
    };
  } catch {
    return {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    };
  }
}

export function saveViewState(
  view: ViewState,
  storageKey = DEFAULT_VIEW_STORAGE_KEY
): void {
  ensurePageHideFlushRegistered();

  pendingViewStates.set(storageKey, {
    ...view,
  });

  const previousTimer = saveTimers.get(storageKey);
  if (previousTimer !== undefined) {
    window.clearTimeout(previousTimer);
  }

  const timer = window.setTimeout(() => {
    const pending = pendingViewStates.get(storageKey);
    if (pending) {
      writeViewState(pending, storageKey);
      pendingViewStates.delete(storageKey);
    }

    saveTimers.delete(storageKey);
  }, SAVE_DEBOUNCE_MS);

  saveTimers.set(storageKey, timer);
}

export function flushSavedViewState(): void {
  for (const timer of saveTimers.values()) {
    window.clearTimeout(timer);
  }
  saveTimers.clear();

  for (const [storageKey, view] of pendingViewStates) {
    writeViewState(view, storageKey);
  }
  pendingViewStates.clear();
}
