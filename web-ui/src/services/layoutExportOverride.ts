import {
  exportFullBackup,
  importFullBackup,
} from "@/services/backupService";

let installed = false;
let importInput:
  HTMLInputElement | null = null;

function normalizeLabel(
  value: string | null
): string {
  return (
    value ?? ""
  )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .toLowerCase();
}

function buttonAction(
  target: EventTarget | null
):
  | "export"
  | "import"
  | null {
  if (
    !(target instanceof Element)
  ) {
    return null;
  }

  const button =
    target.closest<HTMLElement>(
      "button,[role=\"button\"]"
    );

  if (!button) {
    return null;
  }

  const aria =
    normalizeLabel(
      button.getAttribute(
        "aria-label"
      )
    );

  // Layout toolbar.
  if (
    aria ===
    "export layout"
  ) {
    return "export";
  }

  if (
    aria ===
    "import project"
  ) {
    return "import";
  }

  const text =
    normalizeLabel(
      button.textContent
    );

  // Dedicated Export / Import page.
  if (
    text ===
    "export backup"
  ) {
    return "export";
  }

  if (
    text ===
    "import backup"
  ) {
    return "import";
  }

  return null;
}

function ensureImportInput():
  HTMLInputElement {
  if (
    importInput
  ) {
    return importInput;
  }

  importInput =
    document.createElement(
      "input"
    );

  importInput.type =
    "file";

  importInput.accept =
    "application/json,.json";

  importInput.hidden =
    true;

  importInput.addEventListener(
    "change",
    () => {
      const file =
        importInput
          ?.files?.[0];

      if (file) {
        void importFullBackup(
          file
        ).catch(
          error => {
            console.error(
              "Backup import failed:",
              error
            );
          }
        );
      }

      if (
        importInput
      ) {
        importInput.value =
          "";
      }
    }
  );

  document.body.appendChild(
    importInput
  );

  return importInput;
}

function handleDocumentClick(
  event: MouseEvent
): void {
  const action =
    buttonAction(
      event.target
    );

  if (!action) {
    return;
  }

  // Capture phase intentionally owns both legacy UI entry points.
  // Their old local handlers never execute, therefore both locations
  // use exactly the same backup implementation.
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (
    action === "export"
  ) {
    void exportFullBackup()
      .catch(
        error => {
          console.error(
            "Backup export failed:",
            error
          );
        }
      );

    return;
  }

  ensureImportInput()
    .click();
}

export function installLayoutExportOverride(): void {
  if (
    installed
  ) {
    return;
  }

  installed = true;

  document.addEventListener(
    "click",
    handleDocumentClick,
    true
  );
}
