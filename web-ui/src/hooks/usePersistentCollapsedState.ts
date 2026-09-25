import {
  useState,
} from "react";

export function usePersistentCollapsedState(
  storageKey: string,
  defaultCollapsed = false
) {
  const [
    collapsed,
    setCollapsed,
  ] =
    useState<boolean>(() => {
      try {
        const stored =
          window.localStorage.getItem(
            storageKey
          );

        if (stored === null) {
          return defaultCollapsed;
        }

        return stored === "true";
      } catch {
        return defaultCollapsed;
      }
    });

  const toggleCollapsed =
    () => {
      setCollapsed(
        current => {
          const next =
            !current;

          try {
            window.localStorage.setItem(
              storageKey,
              String(next)
            );
          } catch {
            // Storage can be unavailable in privacy/restricted modes.
          }

          return next;
        }
      );
    };

  return {
    collapsed,
    toggleCollapsed,
  };
}
