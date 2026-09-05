import type {
  SignalLogicRuntimeStateDto,
} from "@domain/signalLogic";

let installed = false;
let lastRunning = false;

const SIGNAL_LOGIC_API =
  "/api/signal-logic";

function findSignalsButton():
  HTMLButtonElement | null {
  return (
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "button"
      )
    ).find(
      button =>
        button.textContent?.trim() ===
        "SIGNALS"
    ) ?? null
  );
}

function paintSignalsButton(
  running: boolean
): void {
  const button =
    findSignalsButton();

  if (!button) {
    return;
  }

  button.dataset
    .signalAutomationRunning =
    running ? "true" : "false";

  if (running) {
    button.style.backgroundColor =
      "var(--mantine-color-green-filled)";

    button.style.color =
      "var(--mantine-color-white)";

    button.style.borderColor =
      "var(--mantine-color-green-filled)";

    button.title =
      "Automatic signal aspects · RUNNING";

    return;
  }

  button.style.removeProperty(
    "background-color"
  );

  button.style.removeProperty(
    "color"
  );

  button.style.removeProperty(
    "border-color"
  );

  button.title =
    "Automatic signal aspects";
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
      lastRunning = false;
      paintSignalsButton(false);
      return;
    }

    if (!response.ok) {
      throw new Error(
        `Signal logic status HTTP ${response.status}`
      );
    }

    const content =
      await response.text();

    lastRunning =
      readEnabledFromNdjson(
        content
      );

    paintSignalsButton(
      lastRunning
    );
  } catch {
    // Do not force the button OFF just because a temporary HTTP read
    // failed. Preserve the last runtime state we actually know.
    paintSignalsButton(
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

      lastRunning =
        Boolean(
          state?.enabled &&
          state?.running
        );

      paintSignalsButton(
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
