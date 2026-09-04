import type {
  LayoutElementId,
  SerializedLayoutDto,
  SerializedLayoutElementDto,
} from "@domain/layout/layoutDto";
import { migrateSerializedLayoutIds } from "@domain/layout/layoutIdMigration";
import type {
  SignalOutputConfiguration,
  SignalOutputState,
} from "@domain/layout/signalOutput";
import type {
  SignalLogicConditionDto,
  SignalLogicDocumentDto,
  SignalLogicRuleGroupDto,
  SignalLogicRuntimeStateDto,
  SignalLogicValidationIssue,
} from "@domain/signalLogic";

export type SignalLogicLoadResult = {
  document: SignalLogicDocumentDto;
  issues: SignalLogicValidationIssue[];
  created: boolean;
  state: SignalLogicRuntimeStateDto;
  message?: string;
};

type CompiledConditionSource = "turnout" | "sensor";
type CompiledCondition = [
  source: CompiledConditionSource,
  id: LayoutElementId,
  channel: 0 | 1,
  value: 0 | 1,
];
type CompiledRule = { value: number; conditions: CompiledCondition[] };
type CompiledSignal = {
  kind: "signal";
  id: LayoutElementId;
  mode: "extended" | "basic";
  outputs?: number;
  default: number;
  rules: CompiledRule[];
};
type CompiledMeta = { kind: "meta"; version: 2; enabled: boolean };
type CompiledDocument = { enabled: boolean; signals: CompiledSignal[] };

type LegacyCompiledConditionSource = "turnout" | "sensor" | "vpin";
type LegacyCompiledCondition = [
  source: LegacyCompiledConditionSource,
  address: number,
  value: 0 | 1,
];
type LegacyCompiledRule = { value: number; conditions: LegacyCompiledCondition[] };
type LegacyCompiledSignal = {
  kind: "signal";
  address: number;
  mode: "extended" | "basic";
  outputs?: number;
  default: number;
  rules: LegacyCompiledRule[];
};
type ParsedCompiledDocument = {
  version: 1 | 2;
  enabled: boolean;
  signals: Array<CompiledSignal | LegacyCompiledSignal>;
};

const API_PATH = "/api/signal-logic";

function publishRuntimeState(state: SignalLogicRuntimeStateDto): void {
  window.dispatchEvent(
    new CustomEvent("dcc-lite-signal-runtime-state", { detail: state })
  );
}

function allElements(layout: SerializedLayoutDto): SerializedLayoutElementDto[] {
  return (layout.layers ?? []).flatMap(layer => layer.elements ?? []);
}

async function loadLayout(): Promise<SerializedLayoutDto> {
  const response = await fetch("/api/layout", {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      "The layout could not be loaded for signal rule compilation."
    );
  }
  const raw = await response.json();
  return migrateSerializedLayoutIds(raw as SerializedLayoutDto).layout;
}

function isTurnout(element: SerializedLayoutElementDto): boolean {
  return String(element.type ?? "").startsWith("trackturnout");
}
function isSignal(element: SerializedLayoutElementDto): boolean {
  const type = String(element.type ?? "");
  return (
    type === "tracksignal2" ||
    type === "tracksignal3" ||
    type === "tracksignal4"
  );
}
function isSensor(element: SerializedLayoutElementDto): boolean {
  return element.type === "tracksensor";
}

function requireLayoutId(
  element: SerializedLayoutElementDto | undefined,
  label: string
): LayoutElementId {
  const id = Number(element?.id ?? 0);
  if (!Number.isInteger(id) || id < 1 || id > 0xffff) {
    throw new Error(`${label} has no valid numeric layout ID.`);
  }
  return id;
}

function signalConfig(
  element: SerializedLayoutElementDto
): SignalOutputConfiguration {
  const config = element.signalOutput;
  if (!config || !Number.isInteger(config.address) || config.address < 1) {
    throw new Error(
      `Signal ${element.id ?? "?"} has no valid output configuration.`
    );
  }
  return config;
}

function stateValue(
  config: SignalOutputConfiguration,
  state: SignalOutputState
): number {
  if (config.protocol === "dccext") {
    const aspect = Math.trunc(Number(state.aspect));
    if (!Number.isInteger(aspect) || aspect < 0 || aspect > 255) {
      throw new Error(`Signal aspect ${String(state.aspect)} is invalid.`);
    }
    return aspect;
  }

  const outputCount = Math.max(
    1,
    Math.min(16, Math.trunc(Number(config.outputCount)))
  );
  let bits = 0;
  for (let index = 0; index < outputCount; index += 1) {
    if (state.dccOutputs[index] === "G") {
      bits |= 1 << index;
    }
  }
  return bits;
}

function findState(
  config: SignalOutputConfiguration,
  stateId: string
): SignalOutputState {
  const state = config.states.find(item => item.id === stateId);
  if (!state) {
    throw new Error(`Signal state ${stateId} no longer exists.`);
  }
  return state;
}

function compileCondition(
  condition: SignalLogicConditionDto,
  elements: SerializedLayoutElementDto[]
): CompiledCondition {
  if (condition.type === "sensor") {
    const sensor = elements.find(
      element => element.id === condition.sensorId && isSensor(element)
    );
    return [
      "sensor",
      requireLayoutId(sensor, `Sensor ${condition.sensorId}`),
      0,
      condition.active ? 1 : 0,
    ];
  }

  const turnout = elements.find(
    element => element.id === condition.turnoutId && isTurnout(element)
  );
  const turnoutId = requireLayoutId(
    turnout,
    `Turnout ${condition.turnoutId}`
  );
  const channel: 0 | 1 = condition.turnoutChannel === 1 ? 1 : 0;

  if (channel === 1 && turnout?.turnout2Address === undefined) {
    throw new Error(`Turnout ${turnoutId} has no channel 1.`);
  }

  return [
    "turnout",
    turnoutId,
    channel,
    condition.closed ? 1 : 0,
  ];
}

function compileDocument(
  document: SignalLogicDocumentDto,
  layout: SerializedLayoutDto
): CompiledDocument {
  const elements = allElements(layout);

  const signals = document.groups.map(group => {
    const signal = elements.find(
      element => element.id === group.signalId && isSignal(element)
    );
    const signalId = requireLayoutId(signal, `Signal ${group.signalId}`);
    const config = signalConfig(signal!);
    const defaultState = findState(config, group.defaultStateId);

    const compiled: CompiledSignal = {
      kind: "signal",
      id: signalId,
      mode: config.protocol === "dccext" ? "extended" : "basic",
      default: stateValue(config, defaultState),
      rules: group.rules.map(rule => ({
        value: stateValue(config, findState(config, rule.stateId)),
        conditions: rule.conditions.map(condition =>
          compileCondition(condition, elements)
        ),
      })),
    };

    if (compiled.mode === "basic") {
      compiled.outputs = Math.max(
        1,
        Math.min(16, Math.trunc(Number(config.outputCount)))
      );
    }

    return compiled;
  });

  return {
    enabled: document.enabled,
    signals,
  };
}

function serializeCompiled(document: CompiledDocument): string {
  const meta: CompiledMeta = {
    kind: "meta",
    version: 2,
    enabled: document.enabled,
  };

  return [
    JSON.stringify(meta),
    ...document.signals.map(signal => JSON.stringify(signal)),
    "",
  ].join("\n");
}

function parseCondition(value: unknown): CompiledCondition {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error("Invalid compiled signal condition.");
  }

  const source = value[0];
  const id = Number(value[1]);
  const channel = Number(value[2]);
  const raw = Number(value[3]);

  if (
    (source !== "turnout" && source !== "sensor") ||
    !Number.isInteger(id) ||
    id < 1 ||
    id > 0xffff ||
    (channel !== 0 && channel !== 1) ||
    (raw !== 0 && raw !== 1)
  ) {
    throw new Error("Invalid compiled signal condition.");
  }

  return [source, id, channel, raw];
}

function parseLegacyCondition(value: unknown): LegacyCompiledCondition {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error("Invalid legacy compiled signal condition.");
  }

  const source = value[0];
  const address = Number(value[1]);
  const raw = Number(value[2]);

  if (
    (source !== "turnout" &&
      source !== "sensor" &&
      source !== "vpin") ||
    !Number.isInteger(address) ||
    address < 1 ||
    address > 32767 ||
    (raw !== 0 && raw !== 1)
  ) {
    throw new Error("Invalid legacy compiled signal condition.");
  }

  return [source, address, raw];
}

function parseCompiled(content: string): ParsedCompiledDocument {
  let enabled = false;
  let version: 1 | 2 | 0 = 0;
  const signals: Array<CompiledSignal | LegacyCompiledSignal> = [];

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const row = JSON.parse(line) as Record<string, unknown>;

    if (row.kind === "meta") {
      const parsedVersion = Number(row.version);
      if (parsedVersion !== 1 && parsedVersion !== 2) {
        throw new Error(
          `Unsupported signal rule version: ${String(row.version)}.`
        );
      }

      version = parsedVersion;
      enabled = row.enabled === true;
      continue;
    }

    if (row.kind !== "signal" || version === 0) {
      throw new Error(
        "The signal rule file contains an unsupported row or a signal before its meta row."
      );
    }

    const mode = row.mode;
    if (mode !== "extended" && mode !== "basic") {
      throw new Error(
        "The signal rule file contains an invalid signal mode."
      );
    }

    const rawRules = Array.isArray(row.rules) ? row.rules : [];

    if (version === 1) {
      const address = Number(row.address);
      if (
        !Number.isInteger(address) ||
        address < 1 ||
        address > 32767
      ) {
        throw new Error(
          "The legacy signal rule file contains an invalid signal address."
        );
      }

      signals.push({
        kind: "signal",
        address,
        mode,
        ...(mode === "basic"
          ? {
              outputs: Math.max(
                1,
                Math.min(
                  16,
                  Math.trunc(Number(row.outputs ?? 1))
                )
              ),
            }
          : {}),
        default: Math.trunc(Number(row.default ?? 0)),
        rules: rawRules.map(rawRule => {
          const rule = rawRule as Record<string, unknown>;
          return {
            value: Math.trunc(Number(rule.value ?? 0)),
            conditions: (
              Array.isArray(rule.conditions)
                ? rule.conditions
                : []
            ).map(parseLegacyCondition),
          };
        }),
      });

      continue;
    }

    const id = Number(row.id);
    if (
      !Number.isInteger(id) ||
      id < 1 ||
      id > 0xffff
    ) {
      throw new Error(
        "The signal rule file contains an invalid signal row."
      );
    }

    signals.push({
      kind: "signal",
      id,
      mode,
      ...(mode === "basic"
        ? {
            outputs: Math.max(
              1,
              Math.min(
                16,
                Math.trunc(Number(row.outputs ?? 1))
              )
            ),
          }
        : {}),
      default: Math.trunc(Number(row.default ?? 0)),
      rules: rawRules.map(rawRule => {
        const rule = rawRule as Record<string, unknown>;
        return {
          value: Math.trunc(Number(rule.value ?? 0)),
          conditions: (
            Array.isArray(rule.conditions)
              ? rule.conditions
              : []
          ).map(parseCondition),
        };
      }),
    });
  }

  if (version === 0) {
    throw new Error(
      "The signal rule file has no meta row."
    );
  }

  return {
    version,
    enabled,
    signals,
  };
}

function turnoutAddressForChannel(
  element: SerializedLayoutElementDto,
  channel: 0 | 1
): number {
  const value =
    channel === 1
      ? element.turnout2Address
      : element.turnoutAddress ??
        element.turnout1Address;

  return Math.trunc(Number(value ?? 0));
}

function turnoutClosedValueForChannel(
  element: SerializedLayoutElementDto,
  channel: 0 | 1
): boolean {
  return channel === 1
    ? Boolean(element.turnout2ClosedValue ?? false)
    : Boolean(
        element.turnoutClosedValue ??
          element.turnout1ClosedValue ??
          false
      );
}

function migrateLegacyCompiledCondition(
  condition: LegacyCompiledCondition,
  elements: SerializedLayoutElementDto[]
): CompiledCondition {
  const [source, address, rawValue] = condition;

  if (source === "sensor") {
    const matches = elements.filter(
      element =>
        isSensor(element) &&
        Number(element.address) === address
    );

    if (matches.length !== 1) {
      throw new Error(
        `Legacy sensor address ${address} is ${
          matches.length === 0
            ? "missing"
            : "ambiguous"
        } in the current layout.`
      );
    }

    return [
      "sensor",
      requireLayoutId(
        matches[0],
        `Sensor #${address}`
      ),
      0,
      rawValue,
    ];
  }

  const wantedVpin = source === "vpin";

  const matches: Array<{
    element: SerializedLayoutElementDto;
    channel: 0 | 1;
  }> = [];

  for (const element of elements) {
    if (!isTurnout(element)) {
      continue;
    }

    const isVpin =
      String(element.outputMode ?? "accessory") ===
      "vpin";

    if (isVpin !== wantedVpin) {
      continue;
    }

    if (
      turnoutAddressForChannel(element, 0) ===
      address
    ) {
      matches.push({
        element,
        channel: 0,
      });
    }

    if (
      turnoutAddressForChannel(element, 1) ===
      address
    ) {
      matches.push({
        element,
        channel: 1,
      });
    }
  }

  if (matches.length !== 1) {
    throw new Error(
      `Legacy ${source} turnout address ${address} is ${
        matches.length === 0
          ? "missing"
          : "ambiguous"
      } in the current layout.`
    );
  }

  const match = matches[0]!;
  const physicalValue = rawValue !== 0;
  const logicalClosed =
    physicalValue ===
    turnoutClosedValueForChannel(
      match.element,
      match.channel
    );

  return [
    "turnout",
    requireLayoutId(
      match.element,
      `Turnout #${address}`
    ),
    match.channel,
    logicalClosed ? 1 : 0,
  ];
}

function migrateLegacyCompiled(
  parsed: ParsedCompiledDocument,
  layout: SerializedLayoutDto
): CompiledDocument {
  if (parsed.version === 2) {
    return {
      enabled: parsed.enabled,
      signals: parsed.signals as CompiledSignal[],
    };
  }

  const elements = allElements(layout);

  const migratedSignals = (
    parsed.signals as LegacyCompiledSignal[]
  ).map(legacy => {
    const matches = elements.filter(element => {
      if (!isSignal(element)) {
        return false;
      }

      const config = element.signalOutput;

      if (
        !config ||
        Number(config.address) !== legacy.address
      ) {
        return false;
      }

      const mode =
        config.protocol === "dccext"
          ? "extended"
          : "basic";

      return mode === legacy.mode;
    });

    if (matches.length !== 1) {
      throw new Error(
        `Legacy signal address ${
          legacy.address
        } is ${
          matches.length === 0
            ? "missing"
            : "ambiguous"
        } in the current layout.`
      );
    }

    const signal = matches[0]!;

    return {
      kind: "signal" as const,
      id: requireLayoutId(
        signal,
        `Signal #${legacy.address}`
      ),
      mode: legacy.mode,
      ...(legacy.mode === "basic"
        ? {
            outputs: legacy.outputs ?? 1,
          }
        : {}),
      default: legacy.default,
      rules: legacy.rules.map(rule => ({
        value: rule.value,
        conditions: rule.conditions.map(
          condition =>
            migrateLegacyCompiledCondition(
              condition,
              elements
            )
        ),
      })),
    };
  });

  return {
    enabled: parsed.enabled,
    signals: migratedSignals,
  };
}

function findStateByValue(
  config: SignalOutputConfiguration,
  value: number
): SignalOutputState {
  const state = config.states.find(
    candidate =>
      stateValue(config, candidate) === value
  );

  if (!state) {
    throw new Error(
      `No signal state maps to output value ${value} at address ${config.address}.`
    );
  }

  return state;
}

function decompileCondition(
  condition: CompiledCondition,
  elements: SerializedLayoutElementDto[],
  id: string
): SignalLogicConditionDto {
  const [source, elementId, channel, rawValue] =
    condition;

  if (source === "sensor") {
    const sensor = elements.find(
      element =>
        element.id === elementId &&
        isSensor(element)
    );

    if (!sensor) {
      throw new Error(
        `Sensor ID ${elementId} does not exist in the current layout.`
      );
    }

    return {
      id,
      type: "sensor",
      sensorId: elementId,
      ...(typeof sensor.address === "number"
        ? { sensorAddress: sensor.address }
        : {}),
      active: rawValue !== 0,
    };
  }

  const turnout = elements.find(
    element =>
      element.id === elementId &&
      isTurnout(element)
  );

  if (!turnout) {
    throw new Error(
      `Turnout ID ${elementId} does not exist in the current layout.`
    );
  }

  const address =
    channel === 1
      ? turnout.turnout2Address
      : turnout.turnoutAddress ??
        turnout.turnout1Address;

  return {
    id,
    type: "turnout",
    turnoutId: elementId,
    turnoutChannel: channel,
    ...(typeof address === "number"
      ? { turnoutAddress: address }
      : {}),
    closed: rawValue !== 0,
  };
}

function decompileDocument(
  compiled: CompiledDocument,
  layout: SerializedLayoutDto
): SignalLogicDocumentDto {
  const elements = allElements(layout);

  const groups: SignalLogicRuleGroupDto[] =
    compiled.signals.map(
      (compiledSignal, signalIndex) => {
        const signal = elements.find(
          element =>
            element.id === compiledSignal.id &&
            isSignal(element)
        );

        if (!signal) {
          throw new Error(
            `Signal ID ${compiledSignal.id} does not exist in the current layout.`
          );
        }

        const config = signalConfig(signal);

        const defaultState = findStateByValue(
          config,
          compiledSignal.default
        );

        return {
          id: `compiled-signal-${compiledSignal.id}-${signalIndex}`,
          signalId: compiledSignal.id,
          signalAddress: config.address,
          defaultStateId: defaultState.id,
          rules: compiledSignal.rules.map(
            (compiledRule, ruleIndex) => ({
              id: `compiled-rule-${compiledSignal.id}-${ruleIndex}`,
              stateId: findStateByValue(
                config,
                compiledRule.value
              ).id,
              conditions:
                compiledRule.conditions.map(
                  (condition, conditionIndex) =>
                    decompileCondition(
                      condition,
                      elements,
                      `compiled-condition-${compiledSignal.id}-${ruleIndex}-${conditionIndex}`
                    )
                ),
            })
          ),
        };
      }
    );

  return {
    version: 3,
    enabled: compiled.enabled,
    groups,
  };
}

async function readCompiledRaw(): Promise<
  ParsedCompiledDocument | null
> {
  const response = await fetch(API_PATH, {
    method: "GET",
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const message =
      (await response.text()).trim();

    throw new Error(
      message ||
        "The compiled signal logic rules could not be loaded."
    );
  }

  return parseCompiled(await response.text());
}

async function writeCompiled(
  document: CompiledDocument
): Promise<void> {
  const response = await fetch(API_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-ndjson",
    },
    body: serializeCompiled(document),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      message ||
        "The compiled signal logic rules could not be saved."
    );
  }
}

export async function loadSignalLogicRulesWs(): Promise<SignalLogicLoadResult> {
  const [parsed, layout] = await Promise.all([
    readCompiledRaw(),
    loadLayout(),
  ]);

  if (parsed === null) {
    const document: SignalLogicDocumentDto = {
      version: 3,
      enabled: false,
      groups: [],
    };

    const state: SignalLogicRuntimeStateDto = {
      enabled: false,
      running: false,
    };

    publishRuntimeState(state);

    return {
      document,
      issues: [],
      created: true,
      state,
      message:
        "No signal automation file exists yet. Configure a signal and save to create it.",
    };
  }

  const compiled =
    migrateLegacyCompiled(parsed, layout);

  if (parsed.version === 1) {
    await writeCompiled(compiled);
  }

  const document =
    decompileDocument(compiled, layout);

  const state: SignalLogicRuntimeStateDto = {
    enabled: document.enabled,
    running: document.enabled,
  };

  publishRuntimeState(state);

  return {
    document,
    issues: [],
    created: false,
    state,
    ...(parsed.version === 1
      ? {
          message:
            "Legacy address-based signal rules were migrated to numeric layout IDs.",
        }
      : {}),
  };
}

export async function saveSignalLogicRulesWs(
  document: SignalLogicDocumentDto
): Promise<SignalLogicLoadResult> {
  const layout = await loadLayout();

  await writeCompiled(
    compileDocument(document, layout)
  );

  const state: SignalLogicRuntimeStateDto = {
    enabled: document.enabled,
    running: document.enabled,
  };

  publishRuntimeState(state);

  return {
    document,
    issues: [],
    created: false,
    state,
  };
}
