export type DccExpressAppMode =
  | "auto"
  | "demo"
  | "live";

function normalizeMode(
  value: unknown
): DccExpressAppMode {
  if (value === "demo" || value === "live") {
    return value;
  }

  return "auto";
}

const configuredMode =
  normalizeMode(
    import.meta.env.VITE_APP_MODE
  );

const githubPagesHost =
  typeof window !== "undefined" &&
  window.location.hostname
    .toLowerCase()
    .endsWith(".github.io");

export const appMode:
  Exclude<DccExpressAppMode, "auto"> =
    configuredMode === "demo"
      ? "demo"
      : configuredMode === "live"
        ? "live"
        : githubPagesHost
          ? "demo"
          : "live";

export const isDemoMode =
  appMode === "demo";
