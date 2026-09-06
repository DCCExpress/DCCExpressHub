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

export type DccExpressHubBackup = {
  format: "dcc-express-lite-backup";
  version: 3;
  exportedAt: string;
  layout?: unknown;
  locos?: Loco[];
  images?: LocoImageBackup[];
  signalLogic?: SignalLogicDocumentDto;
  devices?: DeviceConfigurationDocument;
  automations?: AutomationStoragePayload;
};

export type BackupOperationResult = {
  completed: string[];
  warnings: string[];
};

function errorMessage(
  error: unknown
): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

async function fetchJson(
  path: string
): Promise<unknown> {
  const response =
    await fetch(
      path,
      {
        cache: "no-store",
      }
    );

  if (!response.ok) {
    throw new Error(
      `${path}: HTTP ${response.status}`
    );
  }

  return response.json() as Promise<unknown>;
}

function downloadBackup(
  backup: DccExpressHubBackup
): void {
  const url =
    URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            backup,
            null,
            2
          ),
        ],
        {
          type:
            "application/json;charset=utf-8",
        }
      )
    );

  const link =
    document.createElement(
      "a"
    );

  link.href = url;
  link.download =
    `dccexpresshub-backup-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;

  document.body.appendChild(
    link
  );

  link.click();
  link.remove();

  window.setTimeout(
    () =>
      URL.revokeObjectURL(
        url
      ),
    0
  );
}

export async function exportFullBackup(): Promise<BackupOperationResult> {
  const backup:
    DccExpressHubBackup = {
      format:
        "dcc-express-lite-backup",
      version: 3,
      exportedAt:
        new Date().toISOString(),
    };

  const completed:
    string[] = [];

  const warnings:
    string[] = [];

  await Promise.all([
    (async () => {
      try {
        backup.layout =
          await fetchJson(
            "/api/layout"
          );

        completed.push(
          "layout"
        );
      } catch (error) {
        warnings.push(
          `layout: ${errorMessage(error)}`
        );
      }
    })(),

    (async () => {
      try {
        const value =
          await fetchJson(
            "/api/locos"
          );

        if (
          !Array.isArray(
            value
          )
        ) {
          throw new Error(
            "invalid response"
          );
        }

        backup.locos =
          value as Loco[];

        completed.push(
          `${value.length} locomotives`
        );
      } catch (error) {
        warnings.push(
          `locomotives: ${errorMessage(error)}`
        );
      }
    })(),

    (async () => {
      try {
        const images =
          await exportLocoImages();

        backup.images =
          images;

        completed.push(
          `${images.length} images`
        );
      } catch (error) {
        warnings.push(
          `images: ${errorMessage(error)}`
        );
      }
    })(),

    (async () => {
      try {
        const signalLogic =
          await loadSignalLogicRulesWs();

        backup.signalLogic =
          signalLogic.document;

        completed.push(
          "signal logic"
        );
      } catch (error) {
        warnings.push(
          `signal logic: ${errorMessage(error)}`
        );
      }
    })(),

    (async () => {
      try {
        const value =
          await fetchJson(
            "/api/device-config"
          );

        if (
          !isDeviceConfigurationDocument(
            value
          )
        ) {
          throw new Error(
            "invalid response"
          );
        }

        backup.devices =
          value;

        completed.push(
          `${value.devices.length} HAL devices`
        );
      } catch (error) {
        warnings.push(
          `HAL devices: ${errorMessage(error)}`
        );
      }
    })(),

    (async () => {
      try {
        const scripts =
          await loadAutomationScripts();

        backup.automations =
          createAutomationPayload(
            scripts
          );

        completed.push(
          `${scripts.length} automations`
        );
      } catch (error) {
        warnings.push(
          `automations: ${errorMessage(error)}`
        );
      }
    })(),
  ]);

  if (
    completed.length === 0
  ) {
    const message =
      `No backup data could be read. ${warnings.join("; ")}`;

    showNotification({
      color: "red",
      title: "Export failed",
      message,
    });

    throw new Error(
      message
    );
  }

  downloadBackup(
    backup
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
      `${completed.join(", ")} saved.` +
      (
        warnings.length > 0
          ? ` Skipped: ${warnings.join("; ")}`
          : ""
      ),
  });

  return {
    completed,
    warnings,
  };
}

async function postJson(
  path: string,
  body: unknown
): Promise<void> {
  const response =
    await fetch(
      path,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body:
          JSON.stringify(
            body
          ),
      }
    );

  if (!response.ok) {
    let message =
      `${path}: HTTP ${response.status}`;

    try {
      const value =
        await response.json() as {
          message?: unknown;
        };

      if (
        typeof value.message ===
        "string"
      ) {
        message =
          value.message;
      }
    } catch {
      // Keep status fallback.
    }

    throw new Error(
      message
    );
  }
}

export async function importFullBackup(
  file: File
): Promise<BackupOperationResult> {
  const parsed =
    JSON.parse(
      await file.text()
    ) as unknown;

  if (
    !isRecord(parsed)
  ) {
    throw new Error(
      "This is not a valid DCCExpressHub backup file."
    );
  }

  if (
    parsed.format !== undefined &&
    parsed.format !==
      "dcc-express-lite-backup"
  ) {
    throw new Error(
      "This is not a DCCExpressHub backup file."
    );
  }

  const hasLayout =
    Object.prototype.hasOwnProperty.call(
      parsed,
      "layout"
    ) &&
    parsed.layout !== null;

  const locos =
    Array.isArray(
      parsed.locos
    )
      ? parsed.locos as Loco[]
      : null;

  const images =
    Array.isArray(
      parsed.images
    )
      ? parsed.images as LocoImageBackup[]
      : null;

  const signalLogic =
    isRecord(
      parsed.signalLogic
    ) &&
    Array.isArray(
      parsed.signalLogic.groups
    )
      ? parsed.signalLogic as SignalLogicDocumentDto
      : null;

  const devices =
    isDeviceConfigurationDocument(
      parsed.devices
    )
      ? parsed.devices
      : null;

  const automations =
    isRecord(
      parsed.automations
    ) &&
    Array.isArray(
      parsed.automations.scripts
    )
      ? normalizeAutomationScripts(
          parsed.automations.scripts
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
      "The file contains no layout, locomotive, image, signal logic, HAL device or automation data that this release understands."
    );
  }

  const completed:
    string[] = [];

  const warnings:
    string[] = [];

  if (hasLayout) {
    try {
      await postJson(
        "/api/layout",
        parsed.layout
      );

      completed.push(
        "layout"
      );
    } catch (error) {
      warnings.push(
        `layout: ${errorMessage(error)}`
      );
    }
  }

  if (
    locos !== null
  ) {
    try {
      await postJson(
        "/api/locos",
        locos
      );

      completed.push(
        `${locos.length} locomotives`
      );
    } catch (error) {
      warnings.push(
        `locomotives: ${errorMessage(error)}`
      );
    }
  }

  if (
    images !== null
  ) {
    try {
      await importLocoImages(
        images
      );

      completed.push(
        `${images.length} images`
      );
    } catch (error) {
      warnings.push(
        `images: ${errorMessage(error)}`
      );
    }
  }

  if (
    signalLogic !== null
  ) {
    try {
      await saveSignalLogicRulesWs(
        signalLogic
      );

      completed.push(
        "signal logic"
      );
    } catch (error) {
      warnings.push(
        `signal logic: ${errorMessage(error)}`
      );
    }
  }

  if (
    automations !== null
  ) {
    try {
      await saveAutomationScripts(
        automations
      );

      completed.push(
        `${automations.length} automations`
      );
    } catch (error) {
      warnings.push(
        `automations: ${errorMessage(error)}`
      );
    }
  }

  // Device configuration stays last because future firmware may
  // restart immediately after applying it.
  if (
    devices !== null
  ) {
    try {
      await postJson(
        "/api/device-config",
        devices
      );

      completed.push(
        `${devices.devices.length} HAL devices`
      );
    } catch (error) {
      warnings.push(
        `HAL devices: ${errorMessage(error)}`
      );
    }
  }

  if (
    completed.length === 0
  ) {
    throw new Error(
      `No data could be restored. ${warnings.join("; ")}`
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
      `${completed.join(", ")} restored.` +
      (
        warnings.length > 0
          ? ` Skipped: ${warnings.join("; ")}`
          : ""
      ),
  });

  if (
    hasLayout ||
    locos !== null ||
    automations !== null
  ) {
    window.setTimeout(
      () =>
        window.location.reload(),
      250
    );
  }

  return {
    completed,
    warnings,
  };
}
