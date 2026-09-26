export const MOVEMENT_DOCUMENT_VERSION = 1 as const;

export type MovementSensorCondition = {
  id: string;
  sensor: number;
  state: boolean;
};

export type MovementBlockRule = {
  blockId: number;
  departWhen: MovementSensorCondition[];
  leaveWhen: MovementSensorCondition[];
  arrivedWhen: MovementSensorCondition[];
};

export type MovementWhen =
  | "start"
  | "complete"
  | "beforeDepart"
  | "depart"
  | "arrived"
  | "enter"
  | "leave"
  | "afterLeave"
  | "approach";

export type MovementActionKind =
  | "speed"
  | "function"
  | "horn"
  | "delay"
  | "randomDelay"
  | "playAudio"
  | "log";

export type MovementAction = {
  id: string;
  resourceKey: string;
  when: MovementWhen;
  kind: MovementActionKind;

  speed: number;

  functionNumber: number;
  functionActive: boolean;
  pulseMs: number;

  delayMs: number;
  minDelayMs: number;
  maxDelayMs: number;

  audioName: string;
  audioWaitForEnd: boolean;

  message: string;
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
  actions: MovementAction[];
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

export function createMovementAction(
  resourceKey: string,
  when: MovementWhen = "arrived",
  kind: MovementActionKind = "speed"
): MovementAction {
  return {
    id:
      createMovementId(
        "movement-action"
      ),
    resourceKey,
    when,
    kind,
    speed: 20,
    functionNumber: 2,
    functionActive: true,
    pulseMs: 700,
    delayMs: 500,
    minDelayMs: 500,
    maxDelayMs: 1500,
    audioName: "",
    audioWaitForEnd: false,
    message: "",
  };
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
    actions: [],
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

function finiteNumber(
  value: unknown,
  fallback: number
): number {
  const numeric =
    Number(value);

  return Number.isFinite(
    numeric
  )
    ? numeric
    : fallback;
}

function integerRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  return Math.max(
    min,
    Math.min(
      max,
      Math.round(
        finiteNumber(
          value,
          fallback
        )
      )
    )
  );
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
        departWhen:
          normalizeConditions(
            candidate.departWhen
          ),
        leaveWhen:
          normalizeConditions(
            candidate.leaveWhen
          ),
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

const MOVEMENT_WHEN =
  new Set<MovementWhen>([
    "start",
    "complete",
    "beforeDepart",
    "depart",
    "arrived",
    "enter",
    "leave",
    "afterLeave",
    "approach",
  ]);

const MOVEMENT_ACTION_KINDS =
  new Set<MovementActionKind>([
    "speed",
    "function",
    "horn",
    "delay",
    "randomDelay",
    "playAudio",
    "log",
  ]);

function normalizeActions(
  value: unknown
): MovementAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result:
    MovementAction[] = [];

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

    const resourceKey =
      String(
        candidate.resourceKey ??
        ""
      ).trim();

    const requestedWhen =
      String(
        candidate.when ??
        ""
      ) as MovementWhen;

    const requestedKind =
      String(
        candidate.kind ??
        ""
      ) as MovementActionKind;

    if (
      !resourceKey ||
      !MOVEMENT_WHEN.has(
        requestedWhen
      ) ||
      !MOVEMENT_ACTION_KINDS.has(
        requestedKind
      )
    ) {
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
          "movement-action"
        );
    }

    usedIds.add(id);

    const minDelayMs =
      integerRange(
        candidate.minDelayMs,
        500,
        0,
        600000
      );

    const maxDelayMs =
      Math.max(
        minDelayMs,
        integerRange(
          candidate.maxDelayMs,
          1500,
          0,
          600000
        )
      );

    result.push({
      id,
      resourceKey,
      when:
        requestedWhen,
      kind:
        requestedKind,
      speed:
        integerRange(
          candidate.speed,
          20,
          0,
          126
        ),
      functionNumber:
        integerRange(
          candidate.functionNumber,
          2,
          0,
          68
        ),
      functionActive:
        candidate.functionActive !==
        false,
      pulseMs:
        integerRange(
          candidate.pulseMs,
          700,
          1,
          600000
        ),
      delayMs:
        integerRange(
          candidate.delayMs,
          500,
          0,
          600000
        ),
      minDelayMs,
      maxDelayMs,
      audioName:
        String(
          candidate.audioName ??
          ""
        ).trim(),
      audioWaitForEnd:
        candidate.audioWaitForEnd ===
        true,
      message:
        String(
          candidate.message ??
          ""
        ),
    });
  }

  return result;
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
      integerRange(
        candidate.speed,
        20,
        0,
        126
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
    actions:
      normalizeActions(
        candidate.actions
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
