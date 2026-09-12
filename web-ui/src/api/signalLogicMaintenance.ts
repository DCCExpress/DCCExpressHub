const API_PATH = "/api/signal-logic";

type OrphanReferenceType =
  | "sensor"
  | "turnout";

async function loadRawSignalLogic(): Promise<string> {
  const response = await fetch(
    API_PATH,
    {
      method: "GET",
      cache: "no-store",
    }
  );

  if (response.status === 404) {
    return "";
  }

  if (!response.ok) {
    const message =
      (await response.text()).trim();

    throw new Error(
      message ||
        "The signal automation file could not be loaded."
    );
  }

  return response.text();
}

async function saveRawSignalLogic(
  content: string
): Promise<void> {
  const response = await fetch(
    API_PATH,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-ndjson",
      },
      body: content,
    }
  );

  if (!response.ok) {
    const message =
      (await response.text()).trim();

    throw new Error(
      message ||
        "The signal automation file could not be saved."
    );
  }
}

export async function deleteSignalAutomationById(
  signalId: number
): Promise<boolean> {
  if (
    !Number.isInteger(signalId) ||
    signalId < 1 ||
    signalId > 0xffff
  ) {
    throw new Error(
      `Invalid signal ID ${signalId}.`
    );
  }

  const content =
    await loadRawSignalLogic();

  if (!content) {
    return false;
  }

  const keptLines: string[] = [];
  let removed = false;

  for (
    const rawLine of content.split(
      /\r?\n/u
    )
  ) {
    const line =
      rawLine.trim();

    if (!line) {
      continue;
    }

    let row:
      | Record<string, unknown>
      | null = null;

    try {
      const parsed =
        JSON.parse(line) as unknown;

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        row =
          parsed as Record<
            string,
            unknown
          >;
      }
    } catch {
      row = null;
    }

    if (
      row?.kind === "signal" &&
      Number(row.id) === signalId
    ) {
      removed = true;
      continue;
    }

    // Preserve unrelated rows exactly as stored.
    keptLines.push(rawLine);
  }

  if (!removed) {
    return false;
  }

  await saveRawSignalLogic(
    keptLines.join("\n") +
      "\n"
  );

  return true;
}

function isMatchingCondition(
  value: unknown,
  referenceType: OrphanReferenceType,
  elementId: number
): boolean {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value[0] === referenceType &&
    Number(value[1]) === elementId
  );
}

export async function deleteAutomationReference(
  referenceType: OrphanReferenceType,
  elementId: number
): Promise<number> {
  if (
    !Number.isInteger(elementId) ||
    elementId < 1 ||
    elementId > 0xffff
  ) {
    throw new Error(
      `Invalid ${referenceType} ID ${elementId}.`
    );
  }

  const content =
    await loadRawSignalLogic();

  if (!content) {
    return 0;
  }

  const outputLines: string[] = [];
  let removedCount = 0;

  for (
    const rawLine of content.split(
      /\r?\n/u
    )
  ) {
    const line =
      rawLine.trim();

    if (!line) {
      continue;
    }

    let parsed:
      | Record<string, unknown>
      | null = null;

    try {
      const value =
        JSON.parse(line) as unknown;

      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        parsed =
          value as Record<
            string,
            unknown
          >;
      }
    } catch {
      parsed = null;
    }

    if (
      parsed?.kind !== "signal" ||
      !Array.isArray(parsed.rules)
    ) {
      // Keep non-signal, malformed and unrelated rows untouched.
      outputLines.push(rawLine);
      continue;
    }

    let rowChanged = false;

    const nextRules =
      parsed.rules.map(rawRule => {
        if (
          typeof rawRule !== "object" ||
          rawRule === null ||
          Array.isArray(rawRule)
        ) {
          return rawRule;
        }

        const rule = {
          ...(rawRule as Record<
            string,
            unknown
          >),
        };

        const conditions =
          rule.conditions;

        if (
          !Array.isArray(
            conditions
          )
        ) {
          return rule;
        }

        const before =
          conditions.length;

        const nextConditions =
          conditions.filter(
            condition =>
              !isMatchingCondition(
                condition,
                referenceType,
                elementId
              )
          );

        rule.conditions =
          nextConditions;

        const removed =
          before -
          nextConditions.length;

        if (removed > 0) {
          removedCount +=
            removed;

          rowChanged = true;
        }

        return rule;
      });

    if (!rowChanged) {
      // Preserve byte-for-byte when this row is unaffected.
      outputLines.push(rawLine);
      continue;
    }

    outputLines.push(
      JSON.stringify({
        ...parsed,
        rules: nextRules,
      })
    );
  }

  if (removedCount === 0) {
    return 0;
  }

  await saveRawSignalLogic(
    outputLines.join("\n") +
      "\n"
  );

  return removedCount;
}
