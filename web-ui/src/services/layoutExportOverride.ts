import {
  showNotification,
} from "@mantine/notifications";

import type {
  Loco,
  SignalLogicDocumentDto,
} from "@domain/types";

import {
  exportLocoImages,
  type LocoImageBackup,
} from "@/api/imageApi";

import {
  loadSignalLogicRulesWs,
} from "@/api/signalLogicWsApi";

import {
  isDeviceConfigurationDocument,
  type DeviceConfigurationDocument,
} from "@/DeviceConfigurationPage";

type LiteBackup = {
  format: "dcc-express-lite-backup";

  // This is the backup container format, not the application/release version.
  // Importers must treat it as informational and restore every section they know.
  version: number;

  exportedAt: string;

  layout?: unknown;
  locos?: Loco[];
  images?: LocoImageBackup[];
  signalLogic?: SignalLogicDocumentDto;
  devices?: DeviceConfigurationDocument;
};

let installed = false;
let exporting = false;

function errorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : String(error);
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

/**
 * Export the exact same complete backup payload used by the Export / Import page.
 *
 * IMPORTANT:
 * - Reads persisted data from the Hub APIs.
 * - Does NOT serialize the Layout editor's in-memory LayoutView.
 * - Includes layout, locomotives, locomotive images, signal logic and HAL devices.
 * - Uses the same backup container format/version and filename convention.
 */
export async function exportFullBackup(): Promise<void> {
  if (exporting) {
    return;
  }

  exporting = true;

  try {
    const backup: LiteBackup = {
      format: "dcc-express-lite-backup",
      version: 2,
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

    URL.revokeObjectURL(
      blobUrl,
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

function handleDocumentClick(
  event: MouseEvent,
): void {
  const button =
    findLayoutExportButton(
      event.target,
    );

  if (!button) {
    return;
  }

  // main.tsx already installs this service in the current repository.
  // Stop the old LayoutView-only handler and run the same complete backup
  // export used by the Export / Import page instead.
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  void exportFullBackup();
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
