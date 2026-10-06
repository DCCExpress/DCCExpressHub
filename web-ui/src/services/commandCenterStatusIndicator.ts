import {
  wsClient,
  type WsConnectionStatus,
} from "@/services/wsClient";

let installed = false;

let wsStatus:
  WsConnectionStatus =
  "disconnected";

let commandCenterTarget:
  string | null =
  null;

let commandCenterLabel =
  "Command center";

let commandCenterAlive = false;

const PAINT_INTERVAL_MS = 500;

function formatWsStatus(
  status: WsConnectionStatus
): string {
  switch (status) {
    case "connected":
      return "Online";

    case "connecting":
      return "Connecting";

    case "reconnecting":
      return "Reconnecting";

    case "error":
      return "Error";

    default:
      return "Offline";
  }
}

function badgeColors(
  online: boolean
): {
  background: string;
  foreground: string;
  border: string;
} {
  if (online) {
    return {
      background:
        "color-mix(in srgb, var(--mantine-color-teal-6) 18%, transparent)",
      foreground:
        "var(--mantine-color-teal-3)",
      border:
        "color-mix(in srgb, var(--mantine-color-teal-6) 40%, transparent)",
    };
  }

  return {
    background:
      "color-mix(in srgb, var(--mantine-color-red-6) 20%, transparent)",
    foreground:
      "var(--mantine-color-red-3)",
    border:
      "color-mix(in srgb, var(--mantine-color-red-6) 45%, transparent)",
  };
}

function styleBadge(
  badge: HTMLElement,
  online: boolean
): void {
  const colors =
    badgeColors(online);

  badge.style.display =
    "inline-flex";

  badge.style.alignItems =
    "center";

  badge.style.justifyContent =
    "center";

  badge.style.height =
    "26px";

  badge.style.padding =
    "0 10px";

  badge.style.borderRadius =
    "999px";

  badge.style.border =
    `1px solid ${colors.border}`;

  badge.style.background =
    colors.background;

  badge.style.color =
    colors.foreground;

  badge.style.fontSize =
    "11px";

  badge.style.fontWeight =
    "700";

  badge.style.lineHeight =
    "1";

  badge.style.whiteSpace =
    "nowrap";

  badge.style.boxSizing =
    "border-box";

  badge.style.textTransform =
    "none";

  badge.style.letterSpacing =
    "0";
}

function ensureBadge(
  parent: HTMLElement,
  role: string
): HTMLSpanElement {
  let badge =
    parent.querySelector<HTMLSpanElement>(
      `[data-command-center-status-role="${role}"]`
    );

  if (badge) {
    return badge;
  }

  badge =
    document.createElement(
      "span"
    );

  badge.dataset
    .commandCenterStatusRole =
    role;

  parent.appendChild(
    badge
  );

  return badge;
}

function isCommandCenterOnline():
  boolean {
  return (
    wsStatus === "connected" &&
    commandCenterAlive
  );
}

function formatCommandCenterLabel(
  data: {
    type?: string;
    name?: string;
  }
): string {
  const name =
    data.name?.trim();

  if (name) {
    return name;
  }

  const type =
    data.type
      ?.trim()
      .toLowerCase();

  if (type === "z21") {
    return "Z21";
  }

  if (
    type === "dcc-ex" ||
    type === "dccex"
  ) {
    return "DCC-EX";
  }

  return "Command center";
}

function formatCommandCenterTarget(
  data: {
    type?: string;
    ip?: string;
    port?: number;
    serialPort?: string;
    connectionString?: string;
  }
): string | null {
  const connectionString =
    data.connectionString?.trim();

  if (connectionString) {
    return connectionString;
  }

  const serialPort =
    data.serialPort?.trim();

  if (serialPort) {
    return serialPort;
  }

  const ip =
    data.ip?.trim();

  if (!ip) {
    return null;
  }

  const defaultPort =
    data.type
      ?.trim()
      .toLowerCase() === "z21"
      ? 21105
      : 2560;

  return `${ip}:${data.port ?? defaultPort}`;
}

function paintHome(): void {
  const actions =
    document.querySelector<HTMLElement>(
      ".app-header-actions"
    );

  if (!actions) {
    return;
  }

  const existingWsBadge =
    actions.querySelector<HTMLElement>(
      '[data-command-center-status-role="home-ws"]'
    );

  if (!existingWsBadge) {
    return;
  }

  const wsOnline =
    wsStatus === "connected";

  existingWsBadge.textContent =
    `WS: ${formatWsStatus(wsStatus)}`;

  styleBadge(
    existingWsBadge,
    wsOnline
  );

  const commandCenterBadge =
    ensureBadge(
      actions,
      "home-command-center"
    );

  const commandCenterOnline =
    isCommandCenterOnline();

  commandCenterBadge.textContent =
    `${commandCenterLabel}: ${commandCenterTarget ?? "?"}`;

  commandCenterBadge.title =
    commandCenterOnline
      ? "Command station connected"
      : "Command station disconnected";

  styleBadge(
    commandCenterBadge,
    commandCenterOnline
  );

  commandCenterBadge.classList.toggle(
    "lite-ws-alert",
    !commandCenterOnline
  );

  if (
    commandCenterBadge.previousElementSibling !==
      existingWsBadge
  ) {
    existingWsBadge.insertAdjacentElement(
      "afterend",
      commandCenterBadge
    );
  }
}

function findLayoutStatusLeftGroup():
  HTMLElement | null {
  const statusBar =
    document.querySelector<HTMLElement>(
      ".lite-status-bar"
    );

  if (!statusBar) {
    return null;
  }

  const outerGroup =
    statusBar.querySelector<HTMLElement>(
      ":scope > .mantine-Group-root"
    );

  if (!outerGroup) {
    return null;
  }

  const leftGroup =
    Array.from(
      outerGroup.children
    ).find(
      (
        child
      ): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.classList.contains(
          "mantine-Group-root"
        )
    );

  return leftGroup ?? null;
}

function paintLayoutStatusBar():
  void {
  const leftGroup =
    findLayoutStatusLeftGroup();

  if (!leftGroup) {
    return;
  }

  const existingWsBadge =
    leftGroup.querySelector<HTMLElement>(
      '[data-command-center-status-role="layout-ws"]'
    );

  if (!existingWsBadge) {
    return;
  }

  const wsOnline =
    wsStatus === "connected";

  existingWsBadge.textContent =
    wsOnline
      ? "WS"
      : wsStatus === "reconnecting"
        ? "WS RETRY"
        : "WS LOST";

  existingWsBadge.title =
    wsOnline
      ? "WebSocket connected"
      : `WebSocket ${wsStatus}`;

  styleBadge(
    existingWsBadge,
    wsOnline
  );

  const commandCenterBadge =
    ensureBadge(
      leftGroup,
      "layout-command-center"
    );

  const commandCenterOnline =
    isCommandCenterOnline();

  commandCenterBadge.textContent =
    `${commandCenterLabel}: ${commandCenterTarget ?? "?"}`;

  commandCenterBadge.title =
    commandCenterOnline
      ? "Command station connected"
      : "Command station disconnected";

  styleBadge(
    commandCenterBadge,
    commandCenterOnline
  );

  commandCenterBadge.classList.toggle(
    "lite-ws-alert",
    !commandCenterOnline
  );

  // Layout status order:
  // WS -> command center -> ESTOP -> ...
  if (
    commandCenterBadge.previousElementSibling !==
      existingWsBadge
  ) {
    existingWsBadge.insertAdjacentElement(
      "afterend",
      commandCenterBadge
    );
  }
}

function paint(): void {
  paintHome();
  paintLayoutStatusBar();
}

export function
installCommandCenterStatusIndicator():
  void {
  if (installed) {
    return;
  }

  installed = true;

  wsClient.subscribeStatus(
    status => {
      wsStatus =
        status;

      if (
        status !==
        "connected"
      ) {
        commandCenterAlive = false;
      }

      paint();
    }
  );

  // The backend is the single source of truth for command-station connectivity.
  // Windows: CommandCenter.Connected
  // ESP32:   _commandCenter.connected()
  //
  // This event is sent on initial runtime sync and on every WebSocket heartbeat,
  // so the frontend does not inspect command-center-specific heartbeat frames itself.
  wsClient.on(
    "commandCenterInfo",
    data => {
      commandCenterAlive =
        data.alive;

      commandCenterLabel =
        formatCommandCenterLabel(
          data
        );

      commandCenterTarget =
        formatCommandCenterTarget(
          data
        );

      paint();
    }
  );

  // A valid Z21 SYSTEMSTATE frame is authoritative proof that the command
  // station is alive. Keep the imperative header/status-bar indicator aligned
  // with CommandCenterContext, which uses the same rule. This also prevents a
  // stale commandCenterInfo=false frame from leaving YaMoRC/Z21 shown offline
  // while live Z21 telemetry is already arriving.
  wsClient.on(
    "z21SystemState",
    () => {
      if (wsStatus !== "connected") {
        return;
      }

      commandCenterAlive =
        true;

      paint();
    }
  );

  // Kept only because the header/layout badges can be mounted after this
  // service is installed. The timer repaints existing state; it does not
  // calculate connection state or implement a heartbeat timeout.
  window.setInterval(
    paint,
    PAINT_INTERVAL_MS
  );

  paint();
}
