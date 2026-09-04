import {
  wsClient,
  type WsConnectionStatus,
} from "@/services/wsClient";

let installed = false;

let wsStatus:
  WsConnectionStatus =
  "disconnected";

let commandCenterIp:
  string | null =
  null;

let dccExAlive = false;
let lastDccExHeartbeatAt = 0;

const DCC_EX_TIMEOUT_MS = 3000;
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
      `[data-dccex-status-role="${role}"]`
    );

  if (badge) {
    return badge;
  }

  badge =
    document.createElement(
      "span"
    );

  badge.dataset
    .dccexStatusRole =
    role;

  parent.appendChild(
    badge
  );

  return badge;
}

function isDccExOnline():
  boolean {
  return (
    wsStatus === "connected" &&
    dccExAlive &&
    lastDccExHeartbeatAt > 0 &&
    Date.now() -
      lastDccExHeartbeatAt <
      DCC_EX_TIMEOUT_MS
  );
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
      ".mantine-Badge-root"
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

  const dccBadge =
    ensureBadge(
      actions,
      "home-dccex"
    );

  const dccOnline =
    isDccExOnline();

  dccBadge.textContent =
    `DCC-EX: ${commandCenterIp ?? "?"}`;

  dccBadge.title =
    dccOnline
      ? "DCC-EX heartbeat OK"
      : "No DCC-EX heartbeat response";

  styleBadge(
    dccBadge,
    dccOnline
  );

  dccBadge.classList.toggle(
    "lite-ws-alert",
    !dccOnline
  );

  if (
    dccBadge.previousElementSibling !==
      existingWsBadge
  ) {
    existingWsBadge.insertAdjacentElement(
      "afterend",
      dccBadge
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
      ".mantine-Badge-root"
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

  const dccBadge =
    ensureBadge(
      leftGroup,
      "layout-dccex"
    );

  const dccOnline =
    isDccExOnline();

  dccBadge.textContent =
    `DCC-EX: ${commandCenterIp ?? "?"}`;

  dccBadge.title =
    dccOnline
      ? "DCC-EX heartbeat OK"
      : "No DCC-EX heartbeat response";

  styleBadge(
    dccBadge,
    dccOnline
  );

  dccBadge.classList.toggle(
    "lite-ws-alert",
    !dccOnline
  );

  // Layout status order:
  // WS -> DCC-EX -> ESTOP -> ...
  if (
    dccBadge.previousElementSibling !==
      existingWsBadge
  ) {
    existingWsBadge.insertAdjacentElement(
      "afterend",
      dccBadge
    );
  }
}

function checkHeartbeatTimeout():
  void {
  if (
    wsStatus !== "connected" ||
    lastDccExHeartbeatAt === 0
  ) {
    dccExAlive = false;
    return;
  }

  if (
    Date.now() -
      lastDccExHeartbeatAt >=
    DCC_EX_TIMEOUT_MS
  ) {
    dccExAlive = false;
  }
}

function paint(): void {
  checkHeartbeatTimeout();
  paintHome();
  paintLayoutStatusBar();
}

function isDccExHeartbeatReply(
  raw: string
): boolean {
  return /^<#\s+\d+\s*>$/u
    .test(
      raw.trim()
    );
}

export function
installDccExHeartbeatStatusIndicator():
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
        dccExAlive = false;
        lastDccExHeartbeatAt = 0;
      }

      paint();
    }
  );

  wsClient.on(
    "commandCenterInfo",
    data => {
      commandCenterIp =
        data.ip ??
        null;

      if (!data.alive) {
        dccExAlive = false;
      }

      paint();
    }
  );

  wsClient.on(
    "rawInfo",
    data => {
      if (
        !isDccExHeartbeatReply(
          data.raw
        )
      ) {
        return;
      }

      lastDccExHeartbeatAt =
        Date.now();

      dccExAlive = true;

      paint();
    }
  );

  window.setInterval(
    paint,
    PAINT_INTERVAL_MS
  );

  paint();
}
