/**
 * Tracks auxiliary windows opened by this browser tab.
 * Browsers only permit scripts to close windows they created.
 */
const auxiliaryWindows = new Map<string, Window>();

export function openAuxiliaryWindow(
  url: string,
  name: "DCCExpressHubDebug" | "DCCExpressHubFlows",
): void {
  const child = window.open(url, name, "popup=yes,width=1440,height=900");
  if (child) {
    auxiliaryWindows.set(name, child);
    child.focus();
  }
}

export function closeAuxiliaryWindows(): void {
  for (const child of auxiliaryWindows.values()) {
    try {
      if (!child.closed) child.close();
    } catch {
      // Browser popup policies may prevent closing a window.
    }
  }
  auxiliaryWindows.clear();
}
