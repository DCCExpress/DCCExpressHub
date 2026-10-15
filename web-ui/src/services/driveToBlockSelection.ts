import type { Loco } from "@domain/types";

// The throttle card and the layout canvas are separate React subtrees.
// A registered layout canvas handles all Drive-to-Block requests.
let handler: ((loco: Loco) => void) | null = null;
let selecting = false;
const listeners = new Set<() => void>();

const notify = () => { for (const listener of listeners) listener(); };

export function registerDriveToBlockCanvas(callback: (loco: Loco) => void): () => void {
  handler = callback;
  notify();
  return () => {
    if (handler === callback) {
      handler = null;
      selecting = false;
      notify();
    }
  };
}

export function requestDriveToBlockSelection(loco: Loco): boolean {
  if (!handler || selecting) return false;
  handler(loco);
  return true;
}

export function setDriveToBlockSelectionActive(active: boolean): void {
  if (selecting === active) return;
  selecting = active;
  notify();
}

export function getDriveToBlockSelectionState() {
  return { available: handler !== null, active: selecting };
}

export function subscribeDriveToBlockSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
