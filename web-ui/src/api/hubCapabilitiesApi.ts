export type HubCapabilities = {
  javascriptAutomation: boolean;
  fileManager: boolean;
  deviceConfiguration: boolean;
  gamepad: boolean;
  s88: boolean;
  programmingTrack: boolean;
};

export const EMPTY_HUB_CAPABILITIES: HubCapabilities = {
  javascriptAutomation: false,
  fileManager: false,
  deviceConfiguration: false,
  gamepad: false,
  s88: false,
  programmingTrack: false,
};

export async function getHubCapabilities(): Promise<HubCapabilities> {
  const response =
    await fetch(
      "/api/capabilities",
      {
        cache: "no-store",
      },
    );

  if (!response.ok) {
    throw new Error(
      `Could not load Hub capabilities: HTTP ${response.status}`,
    );
  }

  const data =
    await response.json() as
      Partial<HubCapabilities>;

  return {
    javascriptAutomation:
      data.javascriptAutomation === true,

    fileManager:
      data.fileManager === true,

    deviceConfiguration:
      data.deviceConfiguration === true,

    gamepad:
      data.gamepad === true,

    s88:
      data.s88 === true,

    programmingTrack:
      data.programmingTrack === true,
  };
}
