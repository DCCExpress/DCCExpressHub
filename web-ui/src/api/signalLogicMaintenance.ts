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

function parseObjectLine(
  rawLine: string
): Record<string, unknown> | null {
  const line = rawLine.trim();

  if (!line) {
    return null;
  }

  try {
    const parsed =
      JSON.parse(line) as unknown;

    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    )
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function rawContainsSignalId(
  content: string,
  signalId: number
): boolean {
  return content
    .split(/\r?\n/u)
    .some(rawLine => {
      const row =
        parseObjectLine(rawLine);

      return (
        row?.kind === "signal" &&
        Number(row.id) === signalId
      );
    });
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

function countAutomationReferences(
  content: string,
  referenceType: OrphanReferenceType,
  elementId: number
): number {
  let count = 0;

  for (
    const rawLine of content.split(/\r?\n/u)
  ) {
    const row =
      parseObjectLine(rawLine);

    if (
      row?.kind !== "signal" ||
      !Array.isArray(row.rules)
    ) {
      continue;
    }

    for (const rawRule of row.rules) {
      if (
        typeof rawRule !== "object" ||
        rawRule === null ||
        Array.isArray(rawRule)
      ) {
        continue;
      }

      const conditions =
        (rawRule as Record<string, unknown>)
          .conditions;

      if (!Array.isArray(conditions)) {
        continue;
      }

      for (const condition of conditions) {
        if (
          isMatchingCondition(
            condition,
            referenceType,
            elementId
          )
        ) {
          count += 1;
        }
      }
    }
  }

  return count;
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
    const rawLine of content.split(/\r?\n/u)
  ) {
    const row =
      parseObjectLine(rawLine);

    if (
      row?.kind === "signal" &&
      Number(row.id) === signalId
    ) {
      removed = true;
      continue;
    }

    if (rawLine.trim()) {
      // Preserve unrelated rows exactly as stored.
      keptLines.push(rawLine);
    }
  }

  if (!removed) {
    return false;
  }

  await saveRawSignalLogic(
    keptLines.length > 0
      ? keptLines.join("\n") + "\n"
      : ""
  );

  // Do not trust an optimistic POST response. Read the physical rule file
  // back through the dedicated endpoint and prove that the orphan is gone.
  const verified =
    await loadRawSignalLogic();

  if (
    rawContainsSignalId(
      verified,
      signalId
    )
  ) {
    throw new Error(
      `Signal automation ${signalId} is still present after cleanup.`
    );
  }

  return true;
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
    const rawLine of content.split(/\r?\n/u)
  ) {
    const parsed =
      parseObjectLine(rawLine);

    if (
      parsed?.kind !== "signal" ||
      !Array.isArray(parsed.rules)
    ) {
      if (rawLine.trim()) {
        // Keep non-signal, malformed and unrelated rows untouched.
        outputLines.push(rawLine);
      }
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
          ...(rawRule as Record<string, unknown>),
        };

        const conditions =
          rule.conditions;

        if (!Array.isArray(conditions)) {
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
          before - nextConditions.length;

        if (removed > 0) {
          removedCount += removed;
          rowChanged = true;
        }

        return rule;
      });

    if (!rowChanged) {
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
    outputLines.length > 0
      ? outputLines.join("\n") + "\n"
      : ""
  );

  const verified =
    await loadRawSignalLogic();

  if (
    countAutomationReferences(
      verified,
      referenceType,
      elementId
    ) > 0
  ) {
    throw new Error(
      `${referenceType} ID ${elementId} is still referenced after cleanup.`
    );
  }

  return removedCount;
}
