import {
  showNotification,
} from "@mantine/notifications";

import type {
  Loco,
  SignalLogicDocumentDto,
} from "@domain/types";

import {
  exportLocoImages,
  importLocoImages,
  type LocoImageBackup,
} from "@/api/imageApi";

import {
  loadSignalLogicRulesWs,
  saveSignalLogicRulesWs,
} from "@/api/signalLogicWsApi";

import {
  isDeviceConfigurationDocument,
  type DeviceConfigurationDocument,
} from "@/DeviceConfigurationPage";

import {
  createAutomationPayload,
  loadAutomationScripts,
  normalizeAutomationScripts,
  saveAutomationScripts,
  type AutomationStoragePayload,
} from "@/services/automationApi";

type LiteBackup = {
  format: "dcc-express-lite-backup";

  // This is the backup container format, not the application/release version.
  // Version 3 adds the dedicated automation store.
  version: number;

  exportedAt: string;

  layout?: unknown;
  locos?: Loco[];
  images?: LocoImageBackup[];
  signalLogic?: SignalLogicDocumentDto;
  devices?: DeviceConfigurationDocument;
  automations?: AutomationStoragePayload;
};

let installed = false;
let exporting = false;
let importing = false;
let importInput: HTMLInputElement | null = null;

function errorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

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

function findBackupAction(
  target: EventTarget | null,
): "export" | "import" | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const button =
    target.closest<HTMLButtonElement>(
      "button",
    );

  if (!button) {
    return null;
  }

  const label =
    (button.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  if (label === "export backup") {
    return "export";
  }

  if (label === "import backup") {
    return "import";
  }

  return null;
}

/**
 * Export the complete persisted Hub user-data backup.
 *
 * IMPORTANT:
 * - Reads persisted data from the Hub APIs.
 * - Does NOT serialize the Layout editor's in-memory LayoutView.
 * - Includes the dedicated /api/automations store.
 * - The automation section is written even when it contains zero scripts, so
 *   restoring this backup can intentionally restore an empty automation list.
 */
export async function exportFullBackup(): Promise<void> {
  if (exporting) {
    return;
  }

  exporting = true;

  try {
    const backup: LiteBackup = {
      format: "dcc-express-lite-backup",
      version: 3,
      exportedAt: new Date().toISOString(),
    };

    const exported: string[] = [];
    const warnings: string[] = [];

    await Promise.all([
      (async () => {
        try {
          const response = await fetch(
            "/api/layout",
            {
              cache: "no-store",
            },
          );

          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status}`,
            );
          }

          backup.layout =
            await response.json();

          exported.push(
            "layout",
          );
        } catch (error) {
          warnings.push(
            `layout: ${errorMessage(error)}`,
          );
        }
      })(),

      (async () => {
        try {
          const response = await fetch(
            "/api/locos",
            {
              cache: "no-store",
            },
          );

          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status}`,
            );
          }

          const locos =
            await response.json() as unknown;

          if (!Array.isArray(locos)) {
            throw new Error(
              "invalid response",
            );
          }

          backup.locos =
            locos as Loco[];

          exported.push(
            `${locos.length} locomotives`,
          );
        } catch (error) {
          warnings.push(
            `locomotives: ${errorMessage(error)}`,
          );
        }
      })(),

      (async () => {
        try {
          const images =
            await exportLocoImages();

          backup.images =
            images;

          exported.push(
            `${images.length} images`,
          );
        } catch (error) {
          warnings.push(
            `images: ${errorMessage(error)}`,
          );
        }
      })(),

      (async () => {
        try {
          const signalLogic =
            await loadSignalLogicRulesWs();

          backup.signalLogic =
            signalLogic.document;

          exported.push(
            "signal logic",
          );
        } catch (error) {
          warnings.push(
            `signal logic: ${errorMessage(error)}`,
          );
        }
      })(),

      (async () => {
        try {
          const response = await fetch(
            "/api/device-config",
            {
              cache: "no-store",
            },
          );

          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status}`,
            );
          }

          const devices =
            await response.json() as unknown;

          if (!isDeviceConfigurationDocument(
              devices,
            )) {
            throw new Error(
              "invalid response",
            );
          }

          backup.devices =
            devices;

          exported.push(
            `${devices.devices.length} HAL devices`,
          );
        } catch (error) {
          warnings.push(
            `HAL devices: ${errorMessage(error)}`,
          );
        }
      })(),

      (async () => {
        try {
          const scripts =
            await loadAutomationScripts();

          backup.automations =
            createAutomationPayload(
              scripts,
            );

          exported.push(
            `${scripts.length} automations`,
          );
        } catch (error) {
          warnings.push(
            `automations: ${errorMessage(error)}`,
          );
        }
      })(),
    ]);

    if (exported.length === 0) {
      throw new Error(
        `No backup data could be read. ${warnings.join("; ")}`,
      );
    }

    const blobUrl =
      URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              backup,
              null,
              2,
            ),
          ],
          {
            type: "application/json",
          },
        ),
      );

    const anchor =
      document.createElement("a");

    anchor.href =
      blobUrl;

    anchor.download =
      `dcc-express-lite-backup-${new Date().toISOString().slice(0, 10)}.json`;

    anchor.click();

    window.setTimeout(
      () =>
        URL.revokeObjectURL(
          blobUrl,
        ),
      0,
    );

    showNotification({
      color:
        warnings.length > 0
          ? "yellow"
          : "teal",

      title:
        warnings.length > 0
          ? "Backup exported with warnings"
          : "Backup exported",

      message:
        `${exported.join(", ")} saved.` +
        (
          warnings.length > 0
            ? ` Skipped: ${warnings.join("; ")}`
            : ""
        ),
    });
  } catch (exportError) {
    showNotification({
      color: "red",
      title: "Export failed",
      message:
        errorMessage(
          exportError,
        ),
    });
  } finally {
    exporting = false;
  }
}

/**
 * Restore every backup section this release understands.
 *
 * Old v1/v2 backups remain compatible:
 * if the automations section is absent, the current automation store is left
 * untouched. A v3 backup with automations.scripts: [] intentionally clears it.
 */
export async function importFullBackup(
  file: File,
): Promise<void> {
  if (importing) {
    return;
  }

  importing = true;

  try {
    const parsed =
      JSON.parse(
        await file.text(),
      ) as unknown;

    if (!isRecord(parsed)) {
      throw new Error(
        "This is not a valid DCCExpressHub backup file.",
      );
    }

    if (
      parsed.format !== undefined &&
      parsed.format !== "dcc-express-lite-backup"
    ) {
      throw new Error(
        "This is not a DCCExpressHub backup file.",
      );
    }

    const hasLayout =
      Object.prototype.hasOwnProperty.call(
        parsed,
        "layout",
      ) &&
      parsed.layout !== null;

    const locos =
      Array.isArray(parsed.locos)
        ? parsed.locos as Loco[]
        : null;

    const images =
      Array.isArray(parsed.images)
        ? parsed.images as LocoImageBackup[]
        : null;

    const signalLogic =
      isRecord(parsed.signalLogic) &&
      Array.isArray(parsed.signalLogic.groups)
        ? parsed.signalLogic as SignalLogicDocumentDto
        : null;

    const devices =
      isDeviceConfigurationDocument(
        parsed.devices,
      )
        ? parsed.devices
        : null;

    const automations =
      isRecord(parsed.automations) &&
      Array.isArray(parsed.automations.scripts)
        ? normalizeAutomationScripts(
            parsed.automations.scripts,
          )
        : null;

    if (
      !hasLayout &&
      locos === null &&
      images === null &&
      signalLogic === null &&
      devices === null &&
      automations === null
    ) {
      throw new Error(
        "The file contains no layout, locomotive, image, signal logic, HAL device or automation data that this release understands.",
      );
    }

    const imported: string[] = [];
    const warnings: string[] = [];

    if (hasLayout) {
      try {
        const response = await fetch(
          "/api/layout",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              parsed.layout,
            ),
          },
        );

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}`,
          );
        }

        imported.push(
          "layout",
        );
      } catch (error) {
        warnings.push(
          `layout: ${errorMessage(error)}`,
        );
      }
    }

    if (locos !== null) {
      try {
        const response = await fetch(
          "/api/locos",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              locos,
            ),
          },
        );

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}`,
          );
        }

        imported.push(
          `${locos.length} locomotives`,
        );
      } catch (error) {
        warnings.push(
          `locomotives: ${errorMessage(error)}`,
        );
      }
    }

    if (images !== null) {
      try {
        await importLocoImages(
          images,
        );

        imported.push(
          `${images.length} images`,
        );
      } catch (error) {
        warnings.push(
          `images: ${errorMessage(error)}`,
        );
      }
    }

    if (signalLogic !== null) {
      try {
        await saveSignalLogicRulesWs(
          signalLogic,
        );

        imported.push(
          "signal logic",
        );
      } catch (error) {
        warnings.push(
          `signal logic: ${errorMessage(error)}`,
        );
      }
    }

    if (automations !== null) {
      try {
        await saveAutomationScripts(
          automations,
        );

        imported.push(
          `${automations.length} automations`,
        );
      } catch (error) {
        warnings.push(
          `automations: ${errorMessage(error)}`,
        );
      }
    }

    // Device configuration is deliberately restored last because the firmware
    // restarts shortly after accepting it.
    if (devices !== null) {
      try {
        const response = await fetch(
          "/api/device-config",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              devices,
            ),
          },
        );

        if (!response.ok) {
          const result =
            await response
              .json()
              .catch(() => null) as {
                message?: string;
              } | null;

          throw new Error(
            result?.message ??
              `HTTP ${response.status}`,
          );
        }

        imported.push(
          `${devices.devices.length} HAL devices (restart scheduled)`,
        );
      } catch (error) {
        warnings.push(
          `HAL devices: ${errorMessage(error)}`,
        );
      }
    }

    if (imported.length === 0) {
      throw new Error(
        `No data could be restored. ${warnings.join("; ")}`,
      );
    }

    showNotification({
      color:
        warnings.length > 0
          ? "yellow"
          : "teal",

      title:
        warnings.length > 0
          ? "Backup imported with warnings"
          : "Backup imported",

      message:
        `${imported.join(", ")} restored.` +
        (
          warnings.length > 0
            ? ` Skipped: ${warnings.join("; ")}`
            : ""
        ),
    });

    if (
      locos !== null ||
      hasLayout ||
      automations !== null
    ) {
      window.setTimeout(
        () =>
          window.location.reload(),
        devices !== null
          ? 1800
          : 250,
      );
    }
  } catch (importError) {
    showNotification({
      color: "red",
      title: "Import failed",
      message:
        errorMessage(
          importError,
        ),
    });
  } finally {
    importing = false;
  }
}

function ensureImportInput(): HTMLInputElement {
  if (importInput) {
    return importInput;
  }

  importInput =
    document.createElement(
      "input",
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
        importInput?.files?.[0];

      if (file) {
        void importFullBackup(
          file,
        );
      }

      if (importInput) {
        importInput.value =
          "";
      }
    },
  );

  document.body.appendChild(
    importInput,
  );

  return importInput;
}

function handleDocumentClick(
  event: MouseEvent,
): void {
  const layoutExportButton =
    findLayoutExportButton(
      event.target,
    );

  if (layoutExportButton) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    void exportFullBackup();

    return;
  }

  const backupAction =
    findBackupAction(
      event.target,
    );

  if (!backupAction) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (
    backupAction === "export"
  ) {
    void exportFullBackup();
    return;
  }

  ensureImportInput()
    .click();
}

export function installLayoutExportOverride(): void {
  if (installed) {
    return;
  }

  installed = true;

  document.addEventListener(
    "click",
    handleDocumentClick,
    true,
  );
}
