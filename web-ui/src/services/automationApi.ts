import {
  normalizeAutomationFlowDocument,
  type AutomationFlowDocument,
} from "../domain/automationFlow";

export const AUTOMATION_STORAGE_VERSION = 1;

export type AutomationScriptDefinition = {
  id: string;
  name: string;
  script: string;

  /**
   * When true, Start All may start this script.
   *
   * Resume All / Stop All / Abort All intentionally ignore this flag.
   * Missing values from older automation files normalize to true.
   */
  startWithAll?: boolean;
};

export type TimetableEntryDefinition = {
  id: string;
  enabled: boolean;
  scriptId: string;
  /** Two-field railway cron: MINUTE HOUR. Example: */
  cron: string;
};

export type AutomationStoragePayload = {
  version: typeof AUTOMATION_STORAGE_VERSION;
  scripts: AutomationScriptDefinition[];
  timetable?: TimetableEntryDefinition[];
  visualFlow?: AutomationFlowDocument;
};

export function createAutomationId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `automation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createTimetableEntryId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `timetable-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeAutomationScripts(
  raw: unknown
): AutomationScriptDefinition[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const result: AutomationScriptDefinition[] = [];
  const usedIds = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const candidate =
      item as Record<string, unknown>;

    const script =
      typeof candidate.script === "string"
        ? candidate.script
        : "";

    const name =
      typeof candidate.name === "string" && candidate.name.trim()
        ? candidate.name.trim()
        : "Automation";

    let id =
      typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id.trim()
        : createAutomationId();

    while (usedIds.has(id)) {
      id = createAutomationId();
    }

    usedIds.add(id);

    result.push({
      id,
      name,
      script,

      // Backward compatibility: scripts created before this field existed
      // participate in Start All by default.
      startWithAll:
        candidate.startWithAll !== false,
    });
  }

  return result;
}

export function normalizeTimetableEntries(
  raw: unknown
): TimetableEntryDefinition[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const result: TimetableEntryDefinition[] = [];
  const usedIds = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const candidate =
      item as Record<string, unknown>;

    let id =
      typeof candidate.id === "string" && candidate.id.trim()
        ? candidate.id.trim()
        : createTimetableEntryId();

    while (usedIds.has(id)) {
      id = createTimetableEntryId();
    }

    usedIds.add(id);

    result.push({
      id,
      enabled:
        candidate.enabled !== false,
      scriptId:
        typeof candidate.scriptId === "string"
          ? candidate.scriptId.trim()
          : "",
      cron:
        typeof candidate.cron === "string" && candidate.cron.trim()
          ? candidate.cron.trim()
          : "0 *",
    });
  }

  return result;
}

export function createAutomationPayload(
  scripts: AutomationScriptDefinition[],
  timetable?: TimetableEntryDefinition[],
  visualFlow?: AutomationFlowDocument
): AutomationStoragePayload {
  return {
    version: AUTOMATION_STORAGE_VERSION,
    scripts: normalizeAutomationScripts(scripts),
    ...(timetable === undefined
      ? {}
      : {
          timetable:
            normalizeTimetableEntries(timetable),
        }),
    ...(visualFlow === undefined
      ? {}
      : {
          visualFlow:
            normalizeAutomationFlowDocument(
              visualFlow
            ),
        }),
  };
}

type LoadedAutomationStorage = {
  scripts: AutomationScriptDefinition[];
  timetable: TimetableEntryDefinition[];
  visualFlow: AutomationFlowDocument;
};

async function loadAutomationStorage(): Promise<LoadedAutomationStorage> {
  const response =
    await fetch(
      "/api/automations",
      {
        cache: "no-store",
      }
    );

  if (!response.ok) {
    throw new Error(
      `Automation storage could not be loaded (${response.status}).`
    );
  }

  const raw =
    await response.json() as unknown;

  if (
    !raw ||
    typeof raw !== "object"
  ) {
    throw new Error(
      "Invalid automation storage response."
    );
  }

  const payload =
    raw as Record<string, unknown>;

  const version =
    Number(payload.version ?? 0);

  if (
    version !==
    AUTOMATION_STORAGE_VERSION
  ) {
    throw new Error(
      `Unsupported automation storage version: ${version}.`
    );
  }

  return {
    scripts:
      normalizeAutomationScripts(
        payload.scripts
      ),
    timetable:
      normalizeTimetableEntries(
        payload.timetable
      ),
    visualFlow:
      normalizeAutomationFlowDocument(
        payload.visualFlow
      ),
  };
}

async function saveAutomationStorage(
  payload: AutomationStoragePayload
): Promise<void> {
  const response =
    await fetch(
      "/api/automations",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify(
          payload
        ),
      }
    );

  if (!response.ok) {
    let message =
      `Automation storage could not be saved (${response.status}).`;

    try {
      const body =
        await response.json() as {
          message?: unknown;
        };

      if (
        typeof body.message ===
        "string"
      ) {
        message =
          body.message;
      }
    } catch {
      // Keep the HTTP status fallback.
    }

    throw new Error(
      message
    );
  }
}

export async function loadAutomationScripts(): Promise<AutomationScriptDefinition[]> {
  return (
    await loadAutomationStorage()
  ).scripts;
}

export async function saveAutomationScripts(
  scripts: AutomationScriptDefinition[]
): Promise<void> {
  // Preserve timetable rows while the script editor updates the shared
  // automations.json document.
  const current =
    await loadAutomationStorage();

  await saveAutomationStorage(
    createAutomationPayload(
      scripts,
      current.timetable,
      current.visualFlow
    )
  );
}

export async function loadAutomationTimetable(): Promise<TimetableEntryDefinition[]> {
  return (
    await loadAutomationStorage()
  ).timetable;
}

export async function saveAutomationTimetable(
  timetable: TimetableEntryDefinition[]
): Promise<void> {
  // Timetable and scripts intentionally share one persistent document. That
  // keeps the selected script IDs and their schedules atomic from the user's
  // point of view while remaining backward compatible with both native
  // backends, which already preserve additional root properties.
  const current =
    await loadAutomationStorage();

  await saveAutomationStorage(
    createAutomationPayload(
      current.scripts,
      timetable,
      current.visualFlow
    )
  );
}

export async function loadAutomationFlow(): Promise<AutomationFlowDocument> {
  return (
    await loadAutomationStorage()
  ).visualFlow;
}

export async function saveAutomationFlow(
  visualFlow: AutomationFlowDocument
): Promise<void> {
  const current =
    await loadAutomationStorage();

  await saveAutomationStorage(
    createAutomationPayload(
      current.scripts,
      current.timetable,
      visualFlow
    )
  );
}
