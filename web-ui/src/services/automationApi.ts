export const AUTOMATION_STORAGE_VERSION = 1;

export type AutomationScriptDefinition = {
  id: string;
  name: string;
  script: string;
};

export type AutomationStoragePayload = {
  version: typeof AUTOMATION_STORAGE_VERSION;
  scripts: AutomationScriptDefinition[];
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
    });
  }

  return result;
}

export function createAutomationPayload(
  scripts: AutomationScriptDefinition[]
): AutomationStoragePayload {
  return {
    version: AUTOMATION_STORAGE_VERSION,
    scripts: normalizeAutomationScripts(scripts),
  };
}

export async function loadAutomationScripts(): Promise<AutomationScriptDefinition[]> {
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

  return normalizeAutomationScripts(
    payload.scripts
  );
}

export async function saveAutomationScripts(
  scripts: AutomationScriptDefinition[]
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
          createAutomationPayload(
            scripts
          )
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
