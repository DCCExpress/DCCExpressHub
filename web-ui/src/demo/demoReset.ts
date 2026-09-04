import {
  isDemoMode,
} from "./demoMode";

const STORAGE_PREFIX =
  "dccexpress-lite.demo.";

export function resetDemoStorageOnStartup():
  void {
  if (!isDemoMode) {
    return;
  }

  try {
    const keysToRemove: string[] = [];

    for (
      let index = 0;
      index < window.localStorage.length;
      index += 1
    ) {
      const key =
        window.localStorage.key(index);

      if (
        key?.startsWith(
          STORAGE_PREFIX
        )
      ) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      window.localStorage.removeItem(
        key
      );
    }
  } catch {
    // Demo mode must also work when localStorage is blocked.
  }
}
