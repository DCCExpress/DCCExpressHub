const STORAGE_PREFIX = "dcc-express.loco-image-mirrored.";
const CHANGE_EVENT = "dcc-express:loco-image-mirror-changed";

function storageKey(locoId: string): string {
  return `${STORAGE_PREFIX}${locoId}`;
}

export function isLocoImageMirrored(locoId: string): boolean {
  if (!locoId || typeof window === "undefined") return false;
  return window.localStorage.getItem(storageKey(locoId)) === "true";
}

export function setLocoImageMirrored(locoId: string, mirrored: boolean): void {
  if (!locoId || typeof window === "undefined") return;

  if (mirrored) window.localStorage.setItem(storageKey(locoId), "true");
  else window.localStorage.removeItem(storageKey(locoId));

  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { locoId } }));
}

export function subscribeLocoImageMirror(locoId: string, listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onChange = (event: Event) => {
    const changedId = (event as CustomEvent<{ locoId?: string }>).detail?.locoId;
    if (!changedId || changedId === locoId) listener();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey(locoId)) listener();
  };

  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
