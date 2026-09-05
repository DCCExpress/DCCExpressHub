import {
  showNotification,
} from "@mantine/notifications";

type LayoutBackup = {
  format: "dcc-express-lite-backup";
  version: number;
  exportedAt: string;
  layout: unknown;
};

let installed = false;
let exporting = false;

function findLayoutExportButton(
  target: EventTarget | null,
): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest<HTMLElement>(
    '[aria-label="Export layout"],' +
      '[aria-label="Export saved layout backup"]',
  );
}

async function exportSavedLayout(): Promise<void> {
  if (exporting) return;

  exporting = true;

  try {
    const response = await fetch(
      "/api/layout",
      {
        cache: "no-store",
      },
    );

    if (!response.ok) {
      throw new Error(
        `Could not read the saved layout (HTTP ${response.status}).`,
      );
    }

    const layout = await response.json() as unknown;

    const backup: LayoutBackup = {
      format: "dcc-express-lite-backup",
      version: 2,
      exportedAt: new Date().toISOString(),
      layout,
    };

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      {
        type: "application/json",
      },
    );

    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      `dcc-express-lite-layout-backup-${new Date().toISOString().slice(0, 10)}.json`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(
      () => URL.revokeObjectURL(url),
      0,
    );

    showNotification({
      color: "teal",
      title: "Layout backup exported",
      message:
        "The saved Hub layout was exported in the same backup container accepted by Export / Import.",
    });
  } catch (error) {
    showNotification({
      color: "red",
      title: "Layout export failed",
      message:
        error instanceof Error
          ? error.message
          : String(error),
    });
  } finally {
    exporting = false;
  }
}

function handleDocumentClick(
  event: MouseEvent,
): void {
  const button = findLayoutExportButton(
    event.target,
  );

  if (!button) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  void exportSavedLayout();
}

export function installLayoutExportOverride(): void {
  if (installed) return;

  installed = true;

  document.addEventListener(
    "click",
    handleDocumentClick,
    true,
  );
}
