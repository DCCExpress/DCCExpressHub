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

type CompiledRule = {
  value: number;
  conditions: CompiledCondition[];
};

type CompiledSignal = {
  kind: "signal";
  id: LayoutElementId;
  address?: number;
  mode: "extended" | "basic";
  outputs?: number;
  default: number;
  rules: CompiledRule[];
};

type CompiledDocument = {
  enabled: boolean;
  signals: CompiledSignal[];
};

type DecompiledRule = SignalLogicRuleGroupDto["rules"][number];

type LegacyCompiledConditionSource =
  | "turnout"
  | "sensor"
  | "vpin";

type LegacyCompiledCondition = [
  source: LegacyCompiledConditionSource,
  address: number,
  value: 0 | 1,
];

type LegacyCompiledRule = {
  value: number;
  conditions: LegacyCompiledCondition[];
};

type LegacyCompiledSignal = {
  kind: "signal";
  address: number;
  mode: "extended" | "basic";
  outputs?: number;
  default: number;
  rules: LegacyCompiledRule[];
};

type ParsedCompiledSignal =
  | CompiledSignal
  | LegacyCompiledSignal;

type ParsedCompiledDocument = {
  enabled: boolean;
  signals: ParsedCompiledSignal[];
  warnings: string[];
  containsLegacyRows: boolean;
};

const API_PATH = "/api/signal-logic";

function publishRuntimeState(
  state: SignalLogicRuntimeStateDto
): void {
  window.dispatchEvent(
    new CustomEvent(
      "dcc-lite-signal-runtime-state",
      { detail: state }
    )
  );
}

function warningIssues(
  warnings: string[]
): SignalLogicValidationIssue[] {
  return warnings.map(message => ({
    level: "warning",
    message,
  }));
}

function allElements(
  layout: SerializedLayoutDto
): SerializedLayoutElementDto[] {
  return (layout.layers ?? [])
    .flatMap(layer => layer.elements ?? []);
}

async function loadLayout(): Promise<SerializedLayoutDto> {
  const response = await fetch(
    "/api/layout",
    {
      method: "GET",
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(
      "The layout could not be loaded for signal rule compilation."
    );
  }

  const raw = await response.json();

  return migrateSerializedLayoutIds(
    raw as SerializedLayoutDto
  ).layout;
}

function isTurnout(
  element: SerializedLayoutElementDto
): boolean {
  return String(
    element.type ?? ""
  ).startsWith("trackturnout");
}

function isSignal(
  element: SerializedLayoutElementDto
): boolean {
  const type = String(
    element.type ?? ""
  );

  return (
    type === "tracksignal2" ||
    type === "tracksignal3" ||
    type === "tracksignal4"
  );
}

function isSensor(
  element: SerializedLayoutElementDto
): boolean {
  return element.type === "tracksensor";
}

function numericLayoutId(
  element: SerializedLayoutElementDto | undefined
): LayoutElementId | null {
  const id = Number(
    element?.id ?? 0
  );

  return (
    Number.isInteger(id) &&
    id >= 1 &&
    id <= 0xffff
  )
    ? id
    : null;
}

function requireLayoutId(
  element: SerializedLayoutElementDto | undefined,
  label: string
): LayoutElementId {
  const id =
    numericLayoutId(
      element
    );

  if (id === null) {
    throw new Error(
      `${label} has no valid numeric layout ID.`
    );
  }

  return id;
}

function signalConfig(
  element: SerializedLayoutElementDto
): SignalOutputConfiguration {
  const config =
    element.signalOutput;

  if (
    !config ||
    !Number.isInteger(config.address) ||
    config.address < 1
  ) {
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
  if (
    config.protocol === "dccext"
  ) {
    const aspect =
      Math.trunc(
        Number(state.aspect)
      );

    if (
      !Number.isInteger(aspect) ||
      aspect < 0 ||
      aspect > 255
    ) {
      throw new Error(
        `Signal aspect ${String(state.aspect)} is invalid.`
      );
    }

    return aspect;
  }

  const outputCount =
    Math.max(
      1,
      Math.min(
        16,
        Math.trunc(
          Number(config.outputCount)
        )
      )
    );

  let bits = 0;

  for (
    let index = 0;
    index < outputCount;
    index += 1
  ) {
    if (
      state.dccOutputs[index] ===
      "G"
    ) {
      bits |=
        1 << index;
    }
  }

  return bits;
}

function findState(
  config: SignalOutputConfiguration,
  stateId: string
): SignalOutputState {
  const state =
    config.states.find(
      item =>
        item.id === stateId
    );

  if (!state) {
    throw new Error(
      `Signal state ${stateId} no longer exists.`
    );
  }

  return state;
}

function turnoutAddressForChannel(
  element: SerializedLayoutElementDto,
  channel: 0 | 1
): number {
  const value =
    channel === 1
      ? element.turnout2Address
      : (
          element.turnoutAddress ??
          element.turnout1Address
        );

  return Math.trunc(
    Number(value ?? 0)
  );
}

function turnoutClosedValueForChannel(
  element: SerializedLayoutElementDto,
  channel: 0 | 1
): boolean {
  return channel === 1
    ? Boolean(
        element.turnout2ClosedValue ??
        false
      )
    : Boolean(
        element.turnoutClosedValue ??
        element.turnout1ClosedValue ??
        false
      );
}

function findSignalByAddress(
  elements: SerializedLayoutElementDto[],
  address: number,
  mode?: "extended" | "basic"
): SerializedLayoutElementDto | undefined {
  const matches =
    elements.filter(element => {
      if (!isSignal(element)) {
        return false;
      }

      const config =
        element.signalOutput;

      if (
        !config ||
        Number(config.address) !==
          address
      ) {
        return false;
      }

      if (!mode) {
        return true;
      }

      const elementMode =
        config.protocol === "dccext"
          ? "extended"
          : "basic";

      return elementMode === mode;
    });

  return matches.length === 1
    ? matches[0]
    : undefined;
}

function findTurnoutByAddress(
  elements: SerializedLayoutElementDto[],
  address: number
): {
  element: SerializedLayoutElementDto;
  channel: 0 | 1;
} | null {
  const matches: Array<{
    element: SerializedLayoutElementDto;
    channel: 0 | 1;
  }> = [];

  for (
    const element of elements
  ) {
    if (!isTurnout(element)) {
      continue;
    }

    if (
      turnoutAddressForChannel(
        element,
        0
      ) === address
    ) {
      matches.push({
        element,
        channel: 0,
      });
    }

    if (
      turnoutAddressForChannel(
        element,
        1
      ) === address
    ) {
      matches.push({
        element,
        channel: 1,
      });
    }
  }

  return matches.length === 1
    ? matches[0]!
    : null;
}

function normalizeDocumentReferences(
  document: SignalLogicDocumentDto,
  layout: SerializedLayoutDto
): {
  document: SignalLogicDocumentDto;
  warnings: string[];
} {
  const elements =
    allElements(layout);

  const result =
    structuredClone(document);

  const warnings: string[] = [];

  for (
    const group of result.groups
  ) {
    const currentSignal =
      elements.find(
        element =>
          element.id ===
            group.signalId &&
          isSignal(element)
      );

    if (
      !currentSignal &&
      Number(group.signalAddress ?? 0) >
        0
    ) {
      const replacement =
        findSignalByAddress(
          elements,
          Number(
            group.signalAddress
          )
        );

      const replacementId =
        numericLayoutId(
          replacement
        );

      if (
        replacementId !== null
      ) {
        warnings.push(
          `Signal reference ${group.signalId} was rebound by DCC address ${group.signalAddress} to layout ID ${replacementId}.`
        );

        group.signalId =
          replacementId;
      }
    }

    for (
      const rule of group.rules
    ) {
      for (
        const condition of rule.conditions
      ) {
        if (
          condition.type ===
          "sensor"
        ) {
          const currentSensor =
            elements.find(
              element =>
                element.id ===
                  condition.sensorId &&
                isSensor(element)
            );

          if (
            !currentSensor &&
            Number(
              condition.sensorAddress ??
              0
            ) > 0
          ) {
            const address =
              Number(
                condition.sensorAddress
              );

            const matches =
              elements.filter(
                element =>
                  isSensor(element) &&
                  Number(
                    element.address
                  ) === address
              );

            if (
              matches.length === 1
            ) {
              const replacementId =
                numericLayoutId(
                  matches[0]
                );

              if (
                replacementId !==
                null
              ) {
                warnings.push(
                  `Sensor reference ${condition.sensorId} was rebound by address ${address} to layout ID ${replacementId}.`
                );

                condition.sensorId =
                  replacementId;
              }
            }
          }

          continue;
        }

        const wantedChannel: 0 | 1 =
          condition.turnoutChannel ===
          1
            ? 1
            : 0;

        const currentTurnout =
          elements.find(
            element =>
              element.id ===
                condition.turnoutId &&
              isTurnout(element)
          );

        const currentAddress =
          currentTurnout
            ? turnoutAddressForChannel(
                currentTurnout,
                wantedChannel
              )
            : 0;

        const rememberedAddress =
          Number(
            condition.turnoutAddress ??
            0
          );

        if (
          (
            !currentTurnout ||
            (
              rememberedAddress > 0 &&
              currentAddress !==
                rememberedAddress
            )
          ) &&
          rememberedAddress > 0
        ) {
          const replacement =
            findTurnoutByAddress(
              elements,
              rememberedAddress
            );

          if (replacement) {
            const replacementId =
              numericLayoutId(
                replacement.element
              );

            if (
              replacementId !==
              null
            ) {
              warnings.push(
                `Turnout reference ${condition.turnoutId} was rebound by address ${rememberedAddress} to layout ID ${replacementId}, channel ${replacement.channel}.`
              );

              condition.turnoutId =
                replacementId;

              condition.turnoutChannel =
                replacement.channel;
            }
          }
        }
      }
    }
  }

  const bySignal =
    new Map<
      LayoutElementId,
      SignalLogicRuleGroupDto
    >();

  for (
    const group of result.groups
  ) {
    if (
      bySignal.has(
        group.signalId
      )
    ) {
      warnings.push(
        `Duplicate automation group for signal ID ${group.signalId}; the later group was kept.`
      );
    }

    bySignal.set(
      group.signalId,
      group
    );
  }

  result.groups =
    Array.from(
      bySignal.values()
    );

  return {
    document: result,
    warnings,
  };
}

function compileCondition(
  condition: SignalLogicConditionDto,
  elements: SerializedLayoutElementDto[]
): CompiledCondition {
  if (
    condition.type ===
    "sensor"
  ) {
    const sensor =
      elements.find(
        element =>
          element.id ===
            condition.sensorId &&
          isSensor(element)
      );

    return [
      "sensor",
      requireLayoutId(
        sensor,
        `Sensor ${condition.sensorId}`
      ),
      0,
      condition.active ? 1 : 0,
    ];
  }

  const turnout =
    elements.find(
      element =>
        element.id ===
          condition.turnoutId &&
        isTurnout(element)
    );

  const turnoutId =
    requireLayoutId(
      turnout,
      `Turnout ${condition.turnoutId}`
    );

  const channel: 0 | 1 =
    condition.turnoutChannel ===
    1
      ? 1
      : 0;

  if (
    channel === 1 &&
    turnout?.turnout2Address ===
      undefined
  ) {
    throw new Error(
      `Turnout ${turnoutId} has no channel 1.`
    );
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
  const elements =
    allElements(layout);

  const groupsBySignal =
    new Map<
      LayoutElementId,
      SignalLogicRuleGroupDto
    >();

  for (
    const group of document.groups
  ) {
    groupsBySignal.set(
      group.signalId,
      group
    );
  }

  const signals =
    Array.from(
      groupsBySignal.values()
    ).map(group => {
      const signal =
        elements.find(
          element =>
            element.id ===
              group.signalId &&
            isSignal(element)
        );

      const signalId =
        requireLayoutId(
          signal,
          `Signal ${group.signalId}`
        );

      const config =
        signalConfig(
          signal!
        );

      const defaultState =
        findState(
          config,
          group.defaultStateId
        );

      const compiled: CompiledSignal = {
        kind: "signal",
        id: signalId,
        address: config.address,
        mode:
          config.protocol ===
          "dccext"
            ? "extended"
            : "basic",
        default:
          stateValue(
            config,
            defaultState
          ),
        rules:
          group.rules.map(
            rule => ({
              value:
                stateValue(
                  config,
                  findState(
                    config,
                    rule.stateId
                  )
                ),
              conditions:
                rule.conditions.map(
                  condition =>
                    compileCondition(
                      condition,
                      elements
                    )
                ),
            })
          ),
      };

      if (
        compiled.mode ===
        "basic"
      ) {
        compiled.outputs =
          Math.max(
            1,
            Math.min(
              16,
              Math.trunc(
                Number(
                  config.outputCount
                )
              )
            )
          );
      }

      return compiled;
    });

  return {
    enabled:
      document.enabled,
    signals,
  };
}

function serializeCompiled(
  document: CompiledDocument
): string {
  const meta = {
    kind: "meta" as const,
    enabled: document.enabled,
  };

  return [
    JSON.stringify(meta),
    ...document.signals.map(
      signal =>
        JSON.stringify(signal)
    ),
    "",
  ].join("\n");
}

function parseNewCondition(
  value: unknown
): CompiledCondition | null {
  if (
    !Array.isArray(value) ||
    value.length !== 4
  ) {
    return null;
  }

  const source =
    value[0];

  const id =
    Number(value[1]);

  const channel =
    Number(value[2]);

  const raw =
    Number(value[3]);

  if (
    (
      source !== "turnout" &&
      source !== "sensor"
    ) ||
    !Number.isInteger(id) ||
    id < 1 ||
    id > 0xffff ||
    (
      channel !== 0 &&
      channel !== 1
    ) ||
    (
      raw !== 0 &&
      raw !== 1
    )
  ) {
    return null;
  }

  return [
    source,
    id,
    channel,
    raw,
  ];
}

function parseLegacyCondition(
  value: unknown
): LegacyCompiledCondition | null {
  if (
    !Array.isArray(value) ||
    value.length !== 3
  ) {
    return null;
  }

  const source =
    value[0];

  const address =
    Number(value[1]);

  const raw =
    Number(value[2]);

  if (
    (
      source !== "turnout" &&
      source !== "sensor" &&
      source !== "vpin"
    ) ||
    !Number.isInteger(address) ||
    address < 1 ||
    address > 0xffff ||
    (
      raw !== 0 &&
      raw !== 1
    )
  ) {
    return null;
  }

  return [
    source,
    address,
    raw,
  ];
}

function parseCompiled(
  content: string
): ParsedCompiledDocument {
  let enabled = false;

  const signals: ParsedCompiledSignal[] = [];

  const warnings: string[] = [];

  let containsLegacyRows =
    false;

  let lineNumber = 0;

  for (
    const rawLine of content.split(
      /\r?\n/u
    )
  ) {
    lineNumber += 1;

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
        typeof parsed ===
          "object" &&
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

    if (!row) {
      warnings.push(
        `Signal automation line ${lineNumber} is not a JSON object and was skipped.`
      );

      continue;
    }

    if (
      row.kind === "meta"
    ) {
      enabled =
        row.enabled === true;

      if (
        Object.prototype
          .hasOwnProperty.call(
            row,
            "version"
          )
      ) {
        warnings.push(
          "Legacy signal automation version metadata was ignored."
        );
      }

      continue;
    }

    if (
      row.kind !== "signal"
    ) {
      warnings.push(
        `Unknown signal automation row kind "${String(row.kind ?? "")}" on line ${lineNumber}; skipped.`
      );

      continue;
    }

    const mode =
      row.mode;

    if (
      mode !== "extended" &&
      mode !== "basic"
    ) {
      warnings.push(
        `Signal automation line ${lineNumber} has unsupported mode "${String(mode)}"; skipped.`
      );

      continue;
    }

    const rawRules =
      Array.isArray(
        row.rules
      )
        ? row.rules
        : [];

    if (
      !Array.isArray(
        row.rules
      )
    ) {
      warnings.push(
        `Signal automation line ${lineNumber} has no rules array; an empty rule list was used.`
      );
    }

    const id =
      Number(row.id);

    if (
      Number.isInteger(id) &&
      id >= 1 &&
      id <= 0xffff
    ) {
      const rules: CompiledRule[] =
        [];

      for (
        const rawRule of rawRules
      ) {
        if (
          typeof rawRule !==
            "object" ||
          rawRule === null ||
          Array.isArray(rawRule)
        ) {
          warnings.push(
            `Signal ID ${id} contains a non-object rule; skipped.`
          );

          continue;
        }

        const rule =
          rawRule as Record<
            string,
            unknown
          >;

        const value =
          Math.trunc(
            Number(
              rule.value ??
              0
            )
          );

        const conditions: CompiledCondition[] =
          [];

        const rawConditions =
          Array.isArray(
            rule.conditions
          )
            ? rule.conditions
            : [];

        for (
          const rawCondition of
          rawConditions
        ) {
          const parsedCondition =
            parseNewCondition(
              rawCondition
            );

          if (
            parsedCondition
          ) {
            conditions.push(
              parsedCondition
            );
          } else {
            warnings.push(
              `Signal ID ${id} contains an unsupported condition; skipped.`
            );
          }
        }

        rules.push({
          value,
          conditions,
        });
      }

      const parsedSignal: CompiledSignal = {
        kind: "signal",
        id,
        ...(Number.isInteger(
          Number(row.address)
        ) &&
        Number(row.address) > 0
          ? {
              address:
                Number(
                  row.address
                ),
            }
          : {}),
        mode,
        ...(mode === "basic"
          ? {
              outputs:
                Math.max(
                  1,
                  Math.min(
                    16,
                    Math.trunc(
                      Number(
                        row.outputs ??
                        1
                      )
                    )
                  )
                ),
            }
          : {}),
        default:
          Math.trunc(
            Number(
              row.default ??
              0
            )
          ),
        rules,
      };

      const duplicateIndex =
        signals.findIndex(
          signal =>
            "id" in signal &&
            signal.id === id
        );

      if (
        duplicateIndex >= 0
      ) {
        warnings.push(
          `Duplicate signal ID ${id}; the later definition was kept.`
        );

        signals[
          duplicateIndex
        ] =
          parsedSignal;
      } else {
        signals.push(
          parsedSignal
        );
      }

      continue;
    }

    const address =
      Number(row.address);

    if (
      !Number.isInteger(address) ||
      address < 1 ||
      address > 0xffff
    ) {
      warnings.push(
        `Signal automation line ${lineNumber} has neither a usable ID nor address; skipped.`
      );

      continue;
    }

    containsLegacyRows =
      true;

    const rules: LegacyCompiledRule[] =
      [];

    for (
      const rawRule of rawRules
    ) {
      if (
        typeof rawRule !==
          "object" ||
        rawRule === null ||
        Array.isArray(rawRule)
      ) {
        warnings.push(
          `Legacy signal address ${address} contains a non-object rule; skipped.`
        );

        continue;
      }

      const rule =
        rawRule as Record<
          string,
          unknown
        >;

      const conditions: LegacyCompiledCondition[] =
        [];

      const rawConditions =
        Array.isArray(
          rule.conditions
        )
          ? rule.conditions
          : [];

      for (
        const rawCondition of
        rawConditions
      ) {
        const parsedCondition =
          parseLegacyCondition(
            rawCondition
          );

        if (
          parsedCondition
        ) {
          conditions.push(
            parsedCondition
          );
        } else {
          warnings.push(
            `Legacy signal address ${address} contains an unsupported condition; skipped.`
          );
        }
      }

      rules.push({
        value:
          Math.trunc(
            Number(
              rule.value ??
              0
            )
          ),
        conditions,
      });
    }

    signals.push({
      kind: "signal",
      address,
      mode,
      ...(mode === "basic"
        ? {
            outputs:
              Math.max(
                1,
                Math.min(
                  16,
                  Math.trunc(
                    Number(
                      row.outputs ??
                      1
                    )
                  )
                )
              ),
          }
        : {}),
      default:
        Math.trunc(
          Number(
            row.default ??
            0
          )
        ),
      rules,
    });
  }

  return {
    enabled,
    signals,
    warnings,
    containsLegacyRows,
  };
}

function migrateLegacyCompiledCondition(
  condition: LegacyCompiledCondition,
  elements: SerializedLayoutElementDto[]
): CompiledCondition {
  const [
    source,
    address,
    rawValue,
  ] =
    condition;

  if (
    source === "sensor"
  ) {
    const matches =
      elements.filter(
        element =>
          isSensor(element) &&
          Number(
            element.address
          ) === address
      );

    if (
      matches.length !== 1
    ) {
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

  if (
    source === "vpin"
  ) {
    throw new Error(
      `Legacy vpin condition ${address} is no longer supported.`
    );
  }

  const match =
    findTurnoutByAddress(
      elements,
      address
    );

  if (!match) {
    throw new Error(
      `Legacy turnout address ${address} is missing or ambiguous in the current layout.`
    );
  }

  const physicalValue =
    rawValue !== 0;

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
    logicalClosed
      ? 1
      : 0,
  ];
}

function migrateParsedCompiled(
  parsed: ParsedCompiledDocument,
  layout: SerializedLayoutDto
): {
  compiled: CompiledDocument;
  warnings: string[];
} {
  const elements =
    allElements(layout);

  const warnings =
    [...parsed.warnings];

  const bySignal =
    new Map<
      LayoutElementId,
      CompiledSignal
    >();

  for (
    const rawSignal of
    parsed.signals
  ) {
    try {
      let signal:
        CompiledSignal;

      if (
        "id" in rawSignal
      ) {
        let id =
          rawSignal.id;

        const current =
          elements.find(
            element =>
              element.id ===
                id &&
              isSignal(element)
          );

        if (
          !current &&
          Number(
            rawSignal.address ??
            0
          ) > 0
        ) {
          const rebound =
            findSignalByAddress(
              elements,
              Number(
                rawSignal.address
              ),
              rawSignal.mode
            );

          const reboundId =
            numericLayoutId(
              rebound
            );

          if (
            reboundId !== null
          ) {
            warnings.push(
              `Signal ID ${id} was rebound by DCC address ${rawSignal.address} to layout ID ${reboundId}.`
            );

            id =
              reboundId;
          }
        }

        const resolved =
          elements.find(
            element =>
              element.id ===
                id &&
              isSignal(element)
          );

        if (!resolved) {
          throw new Error(
            `Signal ID ${id} does not exist in the current layout.`
          );
        }

        signal = {
          ...rawSignal,
          id,
          address:
            signalConfig(
              resolved
            ).address,
        };
      } else {
        const rebound =
          findSignalByAddress(
            elements,
            rawSignal.address,
            rawSignal.mode
          );

        if (!rebound) {
          throw new Error(
            `Legacy signal address ${rawSignal.address} is missing or ambiguous in the current layout.`
          );
        }

        const id =
          requireLayoutId(
            rebound,
            `Signal #${rawSignal.address}`
          );

        signal = {
          kind: "signal",
          id,
          address:
            rawSignal.address,
          mode:
            rawSignal.mode,
          ...(rawSignal.mode ===
          "basic"
            ? {
                outputs:
                  rawSignal.outputs ??
                  1,
              }
            : {}),
          default:
            rawSignal.default,
          rules:
            rawSignal.rules.map(
              rule => ({
                value:
                  rule.value,
                conditions:
                  rule.conditions.map(
                    condition =>
                      migrateLegacyCompiledCondition(
                        condition,
                        elements
                      )
                  ),
              })
            ),
        };
      }

      if (
        bySignal.has(
          signal.id
        )
      ) {
        warnings.push(
          `Duplicate signal ID ${signal.id}; the later definition was kept.`
        );
      }

      bySignal.set(
        signal.id,
        signal
      );
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? error.message
          : String(error)
      );
    }
  }

  return {
    compiled: {
      enabled:
        parsed.enabled,
      signals:
        Array.from(
          bySignal.values()
        ),
    },
    warnings,
  };
}

function findStateByValue(
  config: SignalOutputConfiguration,
  value: number
): SignalOutputState {
  const state =
    config.states.find(
      candidate =>
        stateValue(
          config,
          candidate
        ) === value
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
  const [
    source,
    elementId,
    channel,
    rawValue,
  ] =
    condition;

  if (
    source === "sensor"
  ) {
    const sensor =
      elements.find(
        element =>
          element.id ===
            elementId &&
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
      sensorId:
        elementId,
      ...(typeof sensor.address ===
      "number"
        ? {
            sensorAddress:
              sensor.address,
          }
        : {}),
      active:
        rawValue !== 0,
    };
  }

  const turnout =
    elements.find(
      element =>
        element.id ===
          elementId &&
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
      : (
          turnout.turnoutAddress ??
          turnout.turnout1Address
        );

  return {
    id,
    type: "turnout",
    turnoutId:
      elementId,
    turnoutChannel:
      channel,
    ...(typeof address ===
    "number"
      ? {
          turnoutAddress:
            address,
        }
      : {}),
    closed:
      rawValue !== 0,
  };
}

function decompileDocument(
  compiled: CompiledDocument,
  layout: SerializedLayoutDto
): {
  document: SignalLogicDocumentDto;
  warnings: string[];
} {
  const elements =
    allElements(layout);

  const warnings: string[] =
    [];

  const groups:
    SignalLogicRuleGroupDto[] =
    [];

  compiled.signals.forEach(
    (
      compiledSignal,
      signalIndex
    ) => {
      try {
        const signal =
          elements.find(
            element =>
              element.id ===
                compiledSignal.id &&
              isSignal(element)
          );

        if (!signal) {
          throw new Error(
            `Signal ID ${compiledSignal.id} does not exist in the current layout.`
          );
        }

        const config =
          signalConfig(
            signal
          );

        const defaultState =
          findStateByValue(
            config,
            compiledSignal.default
          );

        const rules =
          compiledSignal.rules
            .map(
              (
                compiledRule,
                ruleIndex
              ) => {
                try {
                  return {
                    id:
                      `compiled-rule-${compiledSignal.id}-${ruleIndex}`,
                    stateId:
                      findStateByValue(
                        config,
                        compiledRule.value
                      ).id,
                    conditions:
                      compiledRule.conditions
                        .map(
                          (
                            condition,
                            conditionIndex
                          ) => {
                            try {
                              return decompileCondition(
                                condition,
                                elements,
                                `compiled-condition-${compiledSignal.id}-${ruleIndex}-${conditionIndex}`
                              );
                            } catch (
                              error
                            ) {
                              warnings.push(
                                error instanceof
                                Error
                                  ? error.message
                                  : String(
                                      error
                                    )
                              );

                              return null;
                            }
                          }
                        )
                        .filter(
                          (
                            condition
                          ): condition is SignalLogicConditionDto =>
                            condition !==
                            null
                        ),
                  };
                } catch (
                  error
                ) {
                  warnings.push(
                    error instanceof
                    Error
                      ? error.message
                      : String(
                          error
                        )
                  );

                  return null;
                }
              }
            )
            .filter(
              (
                rule
              ): rule is DecompiledRule =>
                rule !== null
            );

        groups.push({
          id:
            `compiled-signal-${compiledSignal.id}-${signalIndex}`,
          signalId:
            compiledSignal.id,
          signalAddress:
            config.address,
          defaultStateId:
            defaultState.id,
          rules,
        });
      } catch (
        error
      ) {
        warnings.push(
          error instanceof Error
            ? error.message
            : String(error)
        );
      }
    }
  );

  return {
    document: {
      // Kept only for the in-memory UI DTO compatibility.
      // It is not serialized to the firmware rule file and is never used
      // as a compatibility gate.
      version: 3,
      enabled:
        compiled.enabled,
      groups,
    },
    warnings,
  };
}

async function readCompiledRaw(): Promise<
  ParsedCompiledDocument | null
> {
  const response =
    await fetch(
      API_PATH,
      {
        method: "GET",
        cache: "no-store",
      }
    );

  if (
    response.status === 404
  ) {
    return null;
  }

  if (!response.ok) {
    const message =
      (
        await response.text()
      ).trim();

    throw new Error(
      message ||
        "The compiled signal logic rules could not be loaded."
    );
  }

  return parseCompiled(
    await response.text()
  );
}

async function writeCompiled(
  document: CompiledDocument
): Promise<void> {
  const response =
    await fetch(
      API_PATH,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-ndjson",
        },
        body:
          serializeCompiled(
            document
          ),
      }
    );

  if (!response.ok) {
    const body =
      await response.text();

    let message =
      body.trim();

    try {
      const parsed =
        JSON.parse(
          body
        ) as {
          message?: unknown;
        };

      if (
        typeof parsed.message ===
        "string"
      ) {
        message =
          parsed.message;
      }
    } catch {
      // Plain text response; keep it.
    }

    throw new Error(
      message ||
        "The compiled signal logic rules could not be saved."
    );
  }
}

export async function loadSignalLogicRulesWs(): Promise<SignalLogicLoadResult> {
  const [
    parsed,
    layout,
  ] =
    await Promise.all([
      readCompiledRaw(),
      loadLayout(),
    ]);

  if (
    parsed === null
  ) {
    const document:
      SignalLogicDocumentDto = {
      // UI DTO compatibility only; never written to firmware storage.
      version: 3,
      enabled: false,
      groups: [],
    };

    const state:
      SignalLogicRuntimeStateDto = {
      enabled: false,
      running: false,
    };

    publishRuntimeState(
      state
    );

    return {
      document,
      issues: [],
      created: true,
      state,
      message:
        "No signal automation file exists yet. Configure a signal and save to create it.",
    };
  }

  const migrated =
    migrateParsedCompiled(
      parsed,
      layout
    );

  if (
    parsed.containsLegacyRows
  ) {
    await writeCompiled(
      migrated.compiled
    );

    migrated.warnings.push(
      "Legacy address-based signal automation was rewritten in the current key-based format."
    );
  }

  const decompiled =
    decompileDocument(
      migrated.compiled,
      layout
    );

  const allWarnings = [
    ...migrated.warnings,
    ...decompiled.warnings,
  ];

  const document =
    decompiled.document;

  const state:
    SignalLogicRuntimeStateDto = {
    enabled:
      document.enabled,
    running:
      document.enabled,
  };

  publishRuntimeState(
    state
  );

  return {
    document,
    issues:
      warningIssues(
        allWarnings
      ),
    created: false,
    state,
    ...(allWarnings.length >
    0
      ? {
          message:
            `Signal automation loaded with ${allWarnings.length} warning(s).`,
        }
      : {}),
  };
}

export async function saveSignalLogicRulesWs(
  document: SignalLogicDocumentDto
): Promise<SignalLogicLoadResult> {
  const layout =
    await loadLayout();

  const normalized =
    normalizeDocumentReferences(
      document,
      layout
    );

  const compiled =
    compileDocument(
      normalized.document,
      layout
    );

  await writeCompiled(
    compiled
  );

  const state:
    SignalLogicRuntimeStateDto = {
    enabled:
      normalized.document.enabled,
    running:
      normalized.document.enabled,
  };

  publishRuntimeState(
    state
  );

  return {
    document:
      normalized.document,
    issues:
      warningIssues(
        normalized.warnings
      ),
    created: false,
    state,
    ...(normalized.warnings.length >
    0
      ? {
          message:
            `Signal automation saved with ${normalized.warnings.length} warning(s).`,
        }
      : {}),
  };
}
