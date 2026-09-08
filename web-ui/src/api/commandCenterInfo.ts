export type CommandCenterCapabilities = {
  trackPower: boolean;
  programmingTrackPower: boolean;
  rawCommand: boolean;
  vPin: boolean;
  extendedAccessory: boolean;
  currentTelemetry: boolean;
  trackConfiguration: boolean;
  locomotiveControl: boolean;
  locomotiveFunctions: boolean;
  turnoutControl: boolean;
  basicAccessory: boolean;
  signalAspect: boolean;
};

export type CommandCenterInfo = {
  ok: boolean;
  type: string;
  name: string;
  defaultPort: number;
  connected: boolean;
  capabilities: CommandCenterCapabilities;
  message?: string;
};

let cachedInfo:
  CommandCenterInfo | null =
    null;

let pending:
  Promise<CommandCenterInfo> | null =
    null;

export async function getCommandCenterInfo(
  force = false,
): Promise<CommandCenterInfo> {
  if (
    !force &&
    cachedInfo
  ) {
    return cachedInfo;
  }

  if (
    !force &&
    pending
  ) {
    return pending;
  }

  pending =
    (async () => {
      const response =
        await fetch(
          "/api/command-center-info",
          {
            cache:
              "no-store",
          },
        );

      if (!response.ok) {
        throw new Error(
          `Could not load command-center capabilities (HTTP ${response.status}).`,
        );
      }

      const info =
        await response.json() as
          CommandCenterInfo;

      if (
        !info ||
        info.ok !== true ||
        !info.capabilities
      ) {
        throw new Error(
          info?.message ??
            "Invalid command-center capability response.",
        );
      }

      cachedInfo =
        info;

      return info;
    })();

  try {
    return await pending;
  } finally {
    pending =
      null;
  }
}
