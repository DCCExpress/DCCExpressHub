import type {
  SignalLogicRuntimeStateDto,
} from "@domain/signalLogic";

let installed = false;
let lastEnabled = false;
let lastRunning = false;

const SIGNAL_LOGIC_API =
  "/api/signal-logic";

function findSignalsButton():
  HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    '[data-signal-automation-button="true"]'
  );
}

function paintSignalsButton(
  enabled: boolean,
  running: boolean
): void {
  const button =
    findSignalsButton();

  if (!button) {
    return;
  }

  button.dataset
    .signalAutomationEnabled =
    enabled ? "true" : "false";

  button.dataset
    .signalAutomationRunning =
    running ? "true" : "false";

  const stateLabel =
    button.querySelector<HTMLElement>(
      '[data-signal-automation-state="true"]'
    );

  if (stateLabel) {
    stateLabel.textContent =
      enabled
        ? "ON"
        : "OFF";
  }

  if (enabled) {
    button.style.backgroundColor =
      "var(--mantine-color-green-filled)";

    button.style.color =
      "var(--mantine-color-white)";

    button.style.borderColor =
      "var(--mantine-color-green-filled)";

    button.title =
      running
        ? "Automatic signal aspects · ENABLED / RUNNING"
        : "Automatic signal aspects · ENABLED";

    return;
  }

  button.style.removeProperty(
    "background-color"
  );

  button.style.removeProperty(
    "color"
  );

  button.style.borderColor =
    "var(--mantine-color-gray-5)";

  button.title =
    "Automatic signal aspects · DISABLED";
}

function readEnabledFromNdjson(
  content: string
): boolean {
  const firstLine =
    content
      .split(/\r?\n/u)
      .map(line => line.trim())
      .find(line => line.length > 0);

  if (!firstLine) {
    return false;
  }

  const meta =
    JSON.parse(firstLine) as {
      kind?: unknown;
      version?: unknown;
      enabled?: unknown;
    };

  return (
    meta.kind === "meta" &&
    meta.enabled === true
  );
}

async function readConfiguredState():
  Promise<void> {
  try {
    const response =
      await fetch(
        SIGNAL_LOGIC_API,
        {
          method: "GET",
          cache: "no-store",
        }
      );

    if (response.status === 404) {
      lastEnabled = false;
      lastRunning = false;
      paintSignalsButton(
        false,
        false
      );
      return;
    }

    if (!response.ok) {
      throw new Error(
        `Signal logic status HTTP ${response.status}`
      );
    }

    const content =
      await response.text();

    lastEnabled =
      readEnabledFromNdjson(
        content
      );

    lastRunning =
      lastEnabled;

    paintSignalsButton(
      lastEnabled,
      lastRunning
    );
  } catch {
    // Do not force the button OFF just because a temporary HTTP read
    // failed. Preserve the last runtime state we actually know.
    paintSignalsButton(
      lastEnabled,
      lastRunning
    );
  }
}

export function
installSignalLogicStatusIndicator():
  void {
  if (installed) {
    return;
  }

  installed = true;

  const onRuntimeState =
    (event: Event) => {
      const state =
        (
          event as
            CustomEvent<
              SignalLogicRuntimeStateDto
            >
        ).detail;

      lastEnabled =
        Boolean(
          state?.enabled
        );

      lastRunning =
        Boolean(
          state?.enabled &&
          state?.running
        );

      paintSignalsButton(
        lastEnabled,
        lastRunning
      );
    };

  window.addEventListener(
    "dcc-lite-signal-runtime-state",
    onRuntimeState
  );

  // The SIGNALS button only exists on the Layout page.
  // This observer only watches node creation/removal; paintSignalsButton()
  // changes styles/attributes, not child nodes, so it does not recursively
  // trigger itself.
  const observer =
    new MutationObserver(() => {
      paintSignalsButton(
        lastEnabled,
        lastRunning
      );
    });

  observer.observe(
    document.documentElement,
    {
      childList: true,
      subtree: true,
    }
  );

  // On F5/reload there may be no runtime-state browser event yet.
  // Recover the persisted firmware configuration from the real API.
  void readConfiguredState();
}
