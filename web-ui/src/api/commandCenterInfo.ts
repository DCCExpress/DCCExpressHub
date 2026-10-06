export type CommandCenterCapabilities = {
  trackPower: boolean;
  programmingTrackPower: boolean;
  serviceModeProgramming: boolean;
  pomProgramming: boolean;
  pomRead: boolean;
  accessoryPomProgramming: boolean;
  accessoryPomRead: boolean;
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
  embedded?: boolean;
  profile?: string;
  type: string;
  name: string;
  transport?: string;
  defaultPort: number;
  connected: boolean;
  host?: string;
  port?: number;
  feedbackLinkName?: string;
  feedbackHost?: string;
  feedbackPort?: number;
  feedbackConfigurable?: boolean;
  capabilities: CommandCenterCapabilities;
  message?: string;
};

let pending:
  Promise<CommandCenterInfo> | null =
    null;

export async function getCommandCenterInfo(
  force = false,
): Promise<CommandCenterInfo> {
  // This payload contains live connection state. Never return a cached
  // connected=false/true value after the command station state has changed.
  // Keep only in-flight request coalescing for callers mounting together.
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

      return info;
    })();

  try {
    return await pending;
  } finally {
    pending =
      null;
  }
}
