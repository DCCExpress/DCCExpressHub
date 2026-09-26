export const MOVEMENT_DOCUMENT_VERSION = 1 as const;

export type MovementSensorCondition = {
  id: string;
  sensor: number;
  state: boolean;
};

export type MovementBlockRule = {
  blockId: number;
  arrivedWhen: MovementSensorCondition[];
};

export type MovementPage = {
  id: string;
  name: string;
  enabled: boolean;
  speed: number;
  fromBlockId: number | null;
  viaBlockIds: number[];
  toBlockId: number | null;
  blockRules: MovementBlockRule[];
};

export type MovementDocument = {
  version: typeof MOVEMENT_DOCUMENT_VERSION;
  pages: MovementPage[];
  activePageId: string;
};

export function createMovementId(
  prefix: string
): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return (
    `${prefix}-${Date.now()}-` +
    Math.random()
      .toString(36)
      .slice(2, 10)
  );
}

export function createMovementPage(
  name = "Movement 1"
): MovementPage {
  return {
    id:
      createMovementId(
        "movement"
      ),
    name,
    enabled: true,
    speed: 20,
    fromBlockId: null,
    viaBlockIds: [],
    toBlockId: null,
    blockRules: [],
  };
}

export function createEmptyMovementDocument(): MovementDocument {
  const page =
    createMovementPage();

  return {
    version:
      MOVEMENT_DOCUMENT_VERSION,
    pages: [
      page,
    ],
    activePageId:
      page.id,
  };
}

function positiveInteger(
  value: unknown,
  max = 65535
): number | null {
  const numeric =
    Number(value);

  return (
    Number.isInteger(numeric) &&
    numeric >= 1 &&
    numeric <= max
  )
    ? numeric
    : null;
}

function normalizeConditions(
  value: unknown
): MovementSensorCondition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result:
    MovementSensorCondition[] = [];

  const usedIds =
    new Set<string>();

  for (const raw of value) {
    if (
      !raw ||
      typeof raw !== "object"
    ) {
      continue;
    }

    const candidate =
      raw as Record<string, unknown>;

    const sensor =
      positiveInteger(
        candidate.sensor
      );

    if (sensor === null) {
      continue;
    }

    let id =
      String(
        candidate.id ??
        ""
      ).trim();

    if (
      !id ||
      usedIds.has(id)
    ) {
      id =
        createMovementId(
          "condition"
        );
    }

    usedIds.add(id);

    result.push({
      id,
      sensor,
      state:
        candidate.state !==
        false,
    });
  }

  return result;
}

function normalizeBlockRules(
  value: unknown
): MovementBlockRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byBlock =
    new Map<
      number,
      MovementBlockRule
    >();

  for (const raw of value) {
    if (
      !raw ||
      typeof raw !== "object"
    ) {
      continue;
    }

    const candidate =
      raw as Record<string, unknown>;

    const blockId =
      positiveInteger(
        candidate.blockId
      );

    if (blockId === null) {
      continue;
    }

    byBlock.set(
      blockId,
      {
        blockId,
        arrivedWhen:
          normalizeConditions(
            candidate.arrivedWhen
          ),
      }
    );
  }

  return [
    ...byBlock.values(),
  ];
}

function normalizeMovementPage(
  raw: unknown,
  fallbackName: string
): MovementPage {
  const candidate =
    raw &&
    typeof raw === "object"
      ? raw as Record<string, unknown>
      : {};

  const fromBlockId =
    positiveInteger(
      candidate.fromBlockId
    );

  const toBlockId =
    positiveInteger(
      candidate.toBlockId
    );

  const viaBlockIds:
    number[] = [];

  for (
    const rawBlockId of
    Array.isArray(
      candidate.viaBlockIds
    )
      ? candidate.viaBlockIds
      : []
  ) {
    const blockId =
      positiveInteger(
        rawBlockId
      );

    if (
      blockId === null ||
      blockId === fromBlockId ||
      blockId === toBlockId ||
      viaBlockIds.includes(
        blockId
      )
    ) {
      continue;
    }

    viaBlockIds.push(
      blockId
    );
  }

  return {
    id:
      typeof candidate.id ===
        "string" &&
      candidate.id.trim()
        ? candidate.id.trim()
        : createMovementId(
            "movement"
          ),
    name:
      typeof candidate.name ===
        "string" &&
      candidate.name.trim()
        ? candidate.name.trim()
        : fallbackName,
    enabled:
      candidate.enabled !==
      false,
    speed:
      Math.max(
        0,
        Math.min(
          126,
          Math.round(
            Number(
              candidate.speed ??
              20
            ) ||
            0
          )
        )
      ),
    fromBlockId,
    viaBlockIds,
    toBlockId:
      toBlockId ===
      fromBlockId
        ? null
        : toBlockId,
    blockRules:
      normalizeBlockRules(
        candidate.blockRules
      ),
  };
}

export function normalizeMovementDocument(
  raw: unknown
): MovementDocument {
  const candidate =
    raw &&
    typeof raw === "object"
      ? raw as Record<string, unknown>
      : {};

  const sourcePages =
    Array.isArray(
      candidate.pages
    )
      ? candidate.pages
      : [];

  const pages:
    MovementPage[] = [];

  const usedIds =
    new Set<string>();

  for (
    let index = 0;
    index < sourcePages.length;
    index += 1
  ) {
    const page =
      normalizeMovementPage(
        sourcePages[index],
        `Movement ${index + 1}`
      );

    while (
      usedIds.has(
        page.id
      )
    ) {
      page.id =
        createMovementId(
          "movement"
        );
    }

    usedIds.add(
      page.id
    );

    pages.push(
      page
    );
  }

  if (
    pages.length ===
    0
  ) {
    pages.push(
      createMovementPage()
    );
  }

  const requestedActive =
    typeof candidate.activePageId ===
      "string"
      ? candidate.activePageId
      : "";

  const activePageId =
    pages.some(
      page =>
        page.id ===
        requestedActive
    )
      ? requestedActive
      : pages[0]!.id;

  return {
    version:
      MOVEMENT_DOCUMENT_VERSION,
    pages,
    activePageId,
  };
}
