import type {
  SignalLogicRuntimeStateDto,
} from "@domain/signalLogic";

let installed = false;
let lastRunning = false;

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
  } else {
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
}

async function readConfiguredState():
  Promise<void> {
  try {
    const response =
      await fetch(
        "/api/files/text?path=%2Fsignal-rules.jsonl",
        {
          cache: "no-store",
        }
      );

    if (!response.ok) {
      paintSignalsButton(false);
      return;
    }

    const firstLine =
      (
        await response.text()
      )
        .split(/\r?\n/u)
        .find(line =>
          line.trim().length > 0
        );

    if (!firstLine) {
      paintSignalsButton(false);
      return;
    }

    const meta =
      JSON.parse(firstLine) as {
        kind?: unknown;
        enabled?: unknown;
      };

    lastRunning =
      meta.kind === "meta" &&
      meta.enabled === true;

    paintSignalsButton(
      lastRunning
    );
  } catch {
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

  void readConfiguredState();
}
