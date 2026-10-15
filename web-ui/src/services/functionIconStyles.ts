export type IconStyle = { mode: "original" | "tint"; color: string };
const FILE = "/images/function-icon-styles.json";
let cache: Record<string, IconStyle> = {};
let loaded = false;
const listeners = new Set<() => void>();
export function readIconStyle(icon: string): IconStyle | undefined { return cache[icon]; }
export function subscribeIconStyles(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
function notify() { for (const listener of listeners) listener(); }
export async function loadIconStyles(): Promise<void> {
  if (loaded) return;
  const response = await fetch(FILE, { cache: "no-store" });
  if (response.ok) {
    const data: unknown = await response.json();
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const [key, entry] of Object.entries(data)) {
        if (entry && typeof entry === "object" && "mode" in entry && "color" in entry) {
          const e = entry as IconStyle;
          if ((e.mode === "tint" || e.mode === "original") && /^#[0-9a-f]{6}$/i.test(e.color)) cache[key] = e;
        }
      }
    }
  } else if (response.status !== 404) throw Error(`Icon styles HTTP ${response.status}`);
  loaded = true; notify();
}
export async function saveIconStyle(icon: string, style: IconStyle): Promise<void> {
  if (!loaded) await loadIconStyles();
  const next = { ...cache, [icon]: style };
  const body = new FormData();
  body.append("file", new File([JSON.stringify(next)], "function-icon-styles.json", { type: "application/json" }));
  const response = await fetch(`/upload?path=${encodeURIComponent("/images")}`, { method: "POST", body });
  if (!response.ok) throw Error(`Icon style save HTTP ${response.status}`);
  cache = next; notify();
}
export async function forgetIconStyle(icon: string): Promise<void> {
  if (!loaded) await loadIconStyles();
  const next = { ...cache };
  delete next[icon];
  const body = new FormData();
  body.append("file", new File([JSON.stringify(next)], "function-icon-styles.json", { type: "application/json" }));
  const response = await fetch(`/upload?path=${encodeURIComponent("/images")}`, { method: "POST", body });
  if (!response.ok) throw Error(`Icon style save HTTP ${response.status}`);
  cache = next; notify();
}
