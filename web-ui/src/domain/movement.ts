export const MOVEMENT_DOCUMENT_VERSION = 1 as const;

export type MovementSensorCondition = {
  id: string;
  sensor: number;
  state: boolean;
};

export type MovementBlockRule = {
  blockId: number;
  approachWhen: MovementSensorCondition[];
  arrivedWhen: MovementSensorCondition[];
  departWhen: MovementSensorCondition[];
  leaveWhen: MovementSensorCondition[];
};

export type MovementResourceEventName =
  | "enter"
  | "approach"
  | "leave";

export type MovementConditionMatch =
  | "all"
  | "any";

export type MovementResourceEventRule = {
  resourceKey: string;
  event:
    MovementResourceEventName;
  match:
    MovementConditionMatch;
  conditions:
    MovementSensorCondition[];
};

export type MovementSafetyRule = {
  fromBlockId: number;
  toBlockId: number;
  ignoredSensors: number[];
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

export type MovementSequenceMode =
  | "blocking"
  | "background";

export type MovementActionKind =
  | "speed"
  | "function"
  | "horn"
  | "delay"
  | "randomDelay"
  | "playAudio"
  | "randomPlay"
  | "setAccessory"
  | "setExtendedAccessory"
  | "log";

export type MovementAction = {
  id: string;
  resourceKey: string;
  when: MovementWhen;
  sequenceId: string;
  sequenceMode:
    MovementSequenceMode;
  kind: MovementActionKind;

  speed: number;

  functionNumber: number;
  functionBindingId: number | null;
  functionActive: boolean;
  pulseMs: number;

  delayMs: number;
  minDelayMs: number;
  maxDelayMs: number;

  audioName: string;
  audioWaitForEnd: boolean;
  randomPlayChancePercent: number;

  accessoryAddress: number;
  accessoryActive: boolean;
  accessoryAspect: number;

  message: string;
};

export type MovementPage = {
  id: string;
  name: string;
  enabled: boolean;
  speed: number;
  startedAt: number | null;
  stoppedAt: number | null;
  routeKey: string;
  fromBlockId: number | null;
  viaBlockIds: number[];
  toBlockId: number | null;
  blockRules: MovementBlockRule[];
  resourceEventRules:
    MovementResourceEventRule[];
  safetyRules:
    MovementSafetyRule[];
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
  kind: MovementActionKind = "log",
  sequenceId =
    createMovementId(
      "movement-sequence"
    ),
  sequenceMode:
    MovementSequenceMode =
      "blocking"
): MovementAction {
  return {
    id:
      createMovementId(
        "movement-action"
      ),
    resourceKey,
    when,
    sequenceId,
    sequenceMode,
    kind,
    speed: 20,
    functionNumber: 2,
    functionBindingId: null,
    functionActive: true,
    pulseMs: 700,
    delayMs: 500,
    minDelayMs: 500,
    maxDelayMs: 1500,
    audioName: "",
    audioWaitForEnd: false,
    randomPlayChancePercent: 30,
    accessoryAddress: 1,
    accessoryActive: true,
    accessoryAspect: 0,
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
    startedAt: null,
    stoppedAt: null,
    routeKey: "",
    fromBlockId: null,
    viaBlockIds: [],
    toBlockId: null,
    blockRules: [],
    resourceEventRules: [],
    safetyRules: [],
    actions: [],
  };
}

export function createEmptyMovementDocument(): MovementDocument {
  return {
    version:
      MOVEMENT_DOCUMENT_VERSION,
    pages: [],
    activePageId: "",
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

function timestampOrNull(
  value: unknown
): number | null {
  const numeric =
    Number(value);

  return (
    Number.isFinite(
      numeric
    ) &&
    numeric > 0
  )
    ? Math.round(
        numeric
      )
    : null;
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
        approachWhen:
          normalizeConditions(
            candidate.approachWhen
          ),
        arrivedWhen:
          normalizeConditions(
            candidate.arrivedWhen
          ),
        departWhen:
          normalizeConditions(
            candidate.departWhen
          ),
        leaveWhen:
          normalizeConditions(
            candidate.leaveWhen
          ),
      }
    );
  }

  return [
    ...byBlock.values(),
  ];
}

function normalizeSafetyRules(
  value: unknown
): MovementSafetyRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byLeg =
    new Map<
      string,
      MovementSafetyRule
    >();

  for (const raw of value) {
    if (
      !raw ||
      typeof raw !==
        "object"
    ) {
      continue;
    }

    const candidate =
      raw as
        Record<string, unknown>;

    const fromBlockId =
      positiveInteger(
        candidate.fromBlockId
      );

    const toBlockId =
      positiveInteger(
        candidate.toBlockId
      );

    if (
      fromBlockId === null ||
      toBlockId === null ||
      fromBlockId ===
        toBlockId
    ) {
      continue;
    }

    const ignoredSensors =
      [
        ...new Set(
          (
            Array.isArray(
              candidate.ignoredSensors
            )
              ? candidate.ignoredSensors
              : []
          )
            .map(
              sensor =>
                positiveInteger(
                  sensor
                )
            )
            .filter(
              (
                sensor
              ): sensor is number =>
                sensor !==
                null
            )
        ),
      ].sort(
        (
          left,
          right
        ) =>
          left -
          right
      );

    byLeg.set(
      `${fromBlockId}->${toBlockId}`,
      {
        fromBlockId,
        toBlockId,
        ignoredSensors,
      }
    );
  }

  return [
    ...byLeg.values(),
  ];
}

function normalizeResourceEventRules(
  value: unknown
): MovementResourceEventRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result:
    MovementResourceEventRule[] =
    [];

  const used =
    new Set<string>();

  for (const raw of value) {
    if (
      !raw ||
      typeof raw !==
        "object"
    ) {
      continue;
    }

    const candidate =
      raw as
        Record<string, unknown>;

    const resourceKey =
      String(
        candidate.resourceKey ??
        ""
      ).trim();

    const event =
      String(
        candidate.event ??
        ""
      ) as
        MovementResourceEventName;

    if (
      !resourceKey ||
      ![
        "enter",
        "approach",
        "leave",
      ].includes(
        event
      )
    ) {
      continue;
    }

    const key =
      `${resourceKey}::${event}`;

    if (used.has(key)) {
      continue;
    }

    used.add(key);

    result.push({
      resourceKey,
      event,
      match:
        candidate.match ===
          "any"
          ? "any"
          : "all",
      conditions:
        normalizeConditions(
          candidate.conditions
        ),
    });
  }

  return result;
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
    "randomPlay",
    "setAccessory",
    "setExtendedAccessory",
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

  const legacySequenceIds =
    new Map<
      string,
      string
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

    const requestedSequenceId =
      String(
        candidate.sequenceId ??
        ""
      ).trim();

    const legacySequenceKey =
      resourceKey +
      "::" +
      requestedWhen;

    let sequenceId =
      requestedSequenceId;

    if (!sequenceId) {
      sequenceId =
        legacySequenceIds.get(
          legacySequenceKey
        ) ??
        createMovementId(
          "movement-sequence"
        );

      legacySequenceIds.set(
        legacySequenceKey,
        sequenceId
      );
    }

    const sequenceMode:
      MovementSequenceMode =
      candidate.sequenceMode ===
        "background"
        ? "background"
        : "blocking";

    result.push({
      id,
      resourceKey,
      when:
        requestedWhen,
      sequenceId,
      sequenceMode,
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
      functionBindingId:
        positiveInteger(
          candidate.functionBindingId,
          65535
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
      randomPlayChancePercent:
        Math.max(
          10,
          Math.min(
            90,
            Math.round(
              integerRange(
                candidate.randomPlayChancePercent,
                30,
                10,
                90
              ) /
              10
            ) *
            10
          )
        ),
      accessoryAddress:
        integerRange(
          candidate.accessoryAddress,
          1,
          1,
          2048
        ),
      accessoryActive:
        candidate.accessoryActive !==
        false,
      accessoryAspect:
        integerRange(
          candidate.accessoryAspect,
          0,
          0,
          255
        ),
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
    startedAt:
      timestampOrNull(
        candidate.startedAt
      ),
    stoppedAt:
      timestampOrNull(
        candidate.stoppedAt
      ),
    routeKey:
      typeof candidate.routeKey ===
        "string"
        ? candidate.routeKey
        : "",
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
    resourceEventRules:
      normalizeResourceEventRules(
        candidate.resourceEventRules
      ),
    safetyRules:
      normalizeSafetyRules(
        candidate.safetyRules
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
      : pages[0]?.id ??
        "";

  return {
    version:
      MOVEMENT_DOCUMENT_VERSION,
    pages,
    activePageId,
  };
}
