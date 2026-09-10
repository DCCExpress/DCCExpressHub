import {
  sendTurnoutOutput,
} from "./layoutOutput";

import type {
  ClientScriptSignalCatalogItem,
  ClientScriptSignalDccDirection,
  ClientScriptSignalStateCatalogItem,
  ClientScriptTurnoutCatalogItem,
  ClientScriptWorkerDccMethod,
  MainToWorkerMessage,
} from "./clientScriptWorkerProtocol";

import {
  wsApi,
} from "./wsApi";

import {
  wsClient,
} from "./wsClient";

type WorkerPoster =
  (message: MainToWorkerMessage) => void;

type JsonObject =
  Record<string, unknown>;

type Versioned<T> = {
  value: T;
  sequence: number;
};

type AccessoryChangedPayload = {
  address: number;
  active: boolean;
};

type SignalAspectChangedPayload = {
  address: number;
  aspect: number;
};

type TurnoutChangedPayload = {
  address: number;
  closed: boolean;
};

type VpinChangedPayload = {
  vpin: number;
  active: boolean;
};

let installed =
  false;

let catalogReady =
  false;

let poster:
  WorkerPoster | null =
  null;

let signals:
  ClientScriptSignalCatalogItem[] =
  [];

let turnouts:
  ClientScriptTurnoutCatalogItem[] =
  [];

// Raw states are intentionally kept separate from semantic states. The same
// accessory address can be part of a Basic-DCC signal or a turnout.
let rawSequence =
  0;

const accessoryRaw =
  new Map<number, Versioned<boolean>>();

const vpinRaw =
  new Map<number, Versioned<boolean>>();

const turnoutPhysicalRaw =
  new Map<number, Versioned<boolean>>();

const signalAspectRaw =
  new Map<number, Versioned<number>>();

let signalRecomputeTimer:
  ReturnType<typeof globalThis.setTimeout> | null =
  null;

const signalStates =
  new Map<number, string>();

const turnoutStates =
  new Map<number, boolean>();

function rememberRaw<T>(
  map: Map<number, Versioned<T>>,
  address: number,
  value: T
): void {
  rawSequence +=
    1;

  map.set(
    address,
    {
      value,
      sequence:
        rawSequence,
    }
  );
}

function newerRaw<T>(
  first: Versioned<T> | undefined,
  second: Versioned<T> | undefined
): Versioned<T> | undefined {
  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  return first.sequence >=
    second.sequence
      ? first
      : second;
}

function asObject(
  value: unknown
): JsonObject | null {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value as JsonObject
    : null;
}

function integerOrNull(
  value: unknown,
  min: number,
  max: number
): number | null {
  const numeric =
    Number(value);

  if (
    !Number.isInteger(numeric) ||
    numeric < min ||
    numeric > max
  ) {
    return null;
  }

  return numeric;
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const numeric =
    Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(
    min,
    Math.min(
      max,
      Math.trunc(numeric)
    )
  );
}

function normalizeLabel(
  value: unknown
): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase();
}

function normalizeDirections(
  value: unknown,
  count: number
): ClientScriptSignalDccDirection[] {
  const source =
    Array.isArray(value)
      ? value
      : [];

  return Array.from(
    {
      length: count,
    },
    (_, index) =>
      source[index] === "G"
        ? "G"
        : "R"
  );
}

function directionsFromBitmask(
  value: unknown,
  count: number
): ClientScriptSignalDccDirection[] {
  const numeric =
    clampInteger(
      value,
      0,
      0xffff,
      0
    );

  return Array.from(
    {
      length: count,
    },
    (_, index) =>
      (
        numeric &
        (
          1 << index
        )
      ) !== 0
        ? "G"
        : "R"
  );
}

function parseConfiguredSignal(
  element: JsonObject
): ClientScriptSignalCatalogItem | null {
  const output =
    asObject(
      element.signalOutput
    );

  if (!output) {
    return null;
  }

  const address =
    integerOrNull(
      output.address,
      1,
      2048
    );

  if (address === null) {
    return null;
  }

  const protocol =
    output.protocol === "dccext"
      ? "dccext" as const
      : "dcc" as const;

  const outputCount =
    protocol === "dcc"
      ? clampInteger(
          output.outputCount,
          1,
          16,
          1
        )
      : 1;

  if (
    protocol === "dcc" &&
    address +
        outputCount -
        1 >
      2048
  ) {
    return null;
  }

  const rawStates =
    Array.isArray(
      output.states
    )
      ? output.states
      : [];

  const states:
    ClientScriptSignalStateCatalogItem[] =
    [];

  for (
    const rawState of
    rawStates
  ) {
    const state =
      asObject(
        rawState
      );

    if (!state) {
      continue;
    }

    const label =
      String(
        state.label ?? ""
      ).trim();

    if (!label) {
      continue;
    }

    states.push({
      label,
      aspect:
        clampInteger(
          state.aspect,
          0,
          255,
          0
        ),
      dccOutputs:
        normalizeDirections(
          state.dccOutputs,
          outputCount
        ),
    });
  }

  if (
    states.length === 0
  ) {
    return null;
  }

  return {
    address,
    name:
      String(
        element.name ?? ""
      ).trim(),
    protocol,
    outputCount,
    states,
  };
}

function parseLegacySignal(
  element: JsonObject
): ClientScriptSignalCatalogItem | null {
  const type =
    String(
      element.type ?? ""
    );

  if (
    !type.startsWith(
      "tracksignal"
    )
  ) {
    return null;
  }

  const address =
    integerOrNull(
      element.address,
      1,
      2048
    );

  if (address === null) {
    return null;
  }

  const lampCount =
    type === "tracksignal4"
      ? 4
      : type === "tracksignal3"
        ? 3
        : clampInteger(
            element.aspect,
            1,
            5,
            2
          );

  const outputCount =
    clampInteger(
      element.addressLength,
      1,
      16,
      lampCount
    );

  if (
    address +
        outputCount -
        1 >
      2048
  ) {
    return null;
  }

  const states:
    ClientScriptSignalStateCatalogItem[] = [
      {
        label: "Red",
        aspect: 0,
        dccOutputs:
          directionsFromBitmask(
            element.valueRed,
            outputCount
          ),
      },
      {
        label: "Green",
        aspect: 16,
        dccOutputs:
          directionsFromBitmask(
            element.valueGreen,
            outputCount
          ),
      },
    ];

  if (lampCount >= 3) {
    states.push({
      label: "Yellow",
      aspect: 2,
      dccOutputs:
        directionsFromBitmask(
          element.valueYellow,
          outputCount
        ),
    });
  }

  if (lampCount >= 4) {
    states.push({
      label: "White",
      aspect: 3,
      dccOutputs:
        directionsFromBitmask(
          element.valueWhite,
          outputCount
        ),
    });
  }

  return {
    address,
    name:
      String(
        element.name ?? ""
      ).trim(),
    protocol: "dcc",
    outputCount,
    states,
  };
}

function parseSignal(
  element: JsonObject
): ClientScriptSignalCatalogItem | null {
  return (
    parseConfiguredSignal(
      element
    ) ??
    parseLegacySignal(
      element
    )
  );
}

function turnoutOutputMode(
  value: unknown
): ClientScriptTurnoutCatalogItem["outputMode"] {
  if (value === "extended") {
    return "extended";
  }

  if (value === "vpin") {
    return "vpin";
  }

  return "accessory";
}

function makeTurnout(
  element: JsonObject,
  addressKey: string,
  closedValueKey: string,
  closedAspectKey: string,
  openedAspectKey: string,
  suffix = ""
): ClientScriptTurnoutCatalogItem | null {
  const address =
    integerOrNull(
      element[addressKey],
      1,
      2048
    );

  if (address === null) {
    return null;
  }

  const name =
    String(
      element.name ?? ""
    ).trim();

  return {
    address,
    name:
      suffix && name
        ? `${name} ${suffix}`
        : name,
    outputMode:
      turnoutOutputMode(
        element.outputMode
      ),
    closedValue:
      Boolean(
        element[closedValueKey] ??
        false
      ),
    closedAspect:
      clampInteger(
        element[closedAspectKey],
        0,
        255,
        0
      ),
    openedAspect:
      clampInteger(
        element[openedAspectKey],
        0,
        255,
        1
      ),
  };
}

function parseTurnouts(
  element: JsonObject
): ClientScriptTurnoutCatalogItem[] {
  const result:
    ClientScriptTurnoutCatalogItem[] =
    [];

  const simple =
    makeTurnout(
      element,
      "turnoutAddress",
      "turnoutClosedValue",
      "turnoutClosedAspect",
      "turnoutOpenedAspect"
    );

  if (simple) {
    result.push(
      simple
    );
  }

  const first =
    makeTurnout(
      element,
      "turnout1Address",
      "turnout1ClosedValue",
      "turnout1ClosedAspect",
      "turnout1OpenedAspect",
      "#1"
    );

  if (first) {
    result.push(
      first
    );
  }

  const second =
    makeTurnout(
      element,
      "turnout2Address",
      "turnout2ClosedValue",
      "turnout2ClosedAspect",
      "turnout2OpenedAspect",
      "#2"
    );

  if (second) {
    result.push(
      second
    );
  }

  return result;
}

function uniqueSignal(
  address: number
): ClientScriptSignalCatalogItem | null {
  const matches =
    signals.filter(
      item =>
        item.address ===
        address
    );

  return matches.length === 1
    ? matches[0]!
    : null;
}

function uniqueTurnout(
  address: number
): ClientScriptTurnoutCatalogItem | null {
  const matches =
    turnouts.filter(
      item =>
        item.address ===
        address
    );

  return matches.length === 1
    ? matches[0]!
    : null;
}

function findSignalState(
  signal: ClientScriptSignalCatalogItem,
  label: string
): ClientScriptSignalStateCatalogItem | null {
  const wanted =
    normalizeLabel(
      label
    );

  if (!wanted) {
    return null;
  }

  const matches =
    signal.states.filter(
      state =>
        normalizeLabel(
          state.label
        ) ===
        wanted
    );

  return matches.length === 1
    ? matches[0]!
    : null;
}

function stateRecord<T>(
  source: Map<number, T>
): Record<string, T> {
  const result:
    Record<string, T> =
    {};

  for (
    const [
      address,
      value,
    ] of source
  ) {
    result[
      String(address)
    ] =
      value;
  }

  return result;
}

function sendCatalogs(): void {
  poster?.({
    type: "signalCatalog",
    signals:
      signals.map(
        signal => ({
          ...signal,
          states:
            signal.states.map(
              state => ({
                ...state,
                dccOutputs: [
                  ...state.dccOutputs,
                ],
              })
            ),
        })
      ),
    ready:
      catalogReady,
  });

  poster?.({
    type: "turnoutCatalog",
    turnouts:
      turnouts.map(
        turnout => ({
          ...turnout,
        })
      ),
    ready:
      catalogReady,
  });
}

function sendSignalStates(): void {
  poster?.({
    type: "signalStateSnapshot",
    states:
      stateRecord(
        signalStates
      ),
  });
}

function sendTurnoutStates(): void {
  poster?.({
    type: "turnoutStateSnapshot",
    states:
      stateRecord(
        turnoutStates
      ),
  });
}

function sendAll(): void {
  sendCatalogs();
  sendSignalStates();
  sendTurnoutStates();
}

function recomputeSignalStates(): void {
  signalStates.clear();

  const uniqueAddresses =
    new Set(
      signals.map(
        signal =>
          signal.address
      )
    );

  for (
    const address of
    uniqueAddresses
  ) {
    const signal =
      uniqueSignal(
        address
      );

    if (!signal) {
      continue;
    }

    if (
      signal.protocol ===
      "dccext"
    ) {
      if (
        !signalAspectRaw.has(
          address
        )
      ) {
        continue;
      }

      const aspect =
        signalAspectRaw.get(
          address
        )!.value;

      const matches =
        signal.states.filter(
          state =>
            state.aspect ===
            aspect
        );

      if (
        matches.length === 1
      ) {
        signalStates.set(
          address,
          matches[0]!.label
        );
      }

      continue;
    }

    const outputs:
      ClientScriptSignalDccDirection[] =
      [];

    let complete =
      true;

    for (
      let index = 0;
      index <
        signal.outputCount;
      ++index
    ) {
      const outputAddress =
        signal.address +
        index;

      if (
        !accessoryRaw.has(
          outputAddress
        )
      ) {
        complete =
          false;
        break;
      }

      outputs.push(
        accessoryRaw.get(
          outputAddress
        )!.value
          ? "G"
          : "R"
      );
    }

    if (!complete) {
      continue;
    }

    const matches =
      signal.states.filter(
        state =>
          state.dccOutputs.length ===
            outputs.length &&
          state.dccOutputs.every(
            (
              direction,
              index
            ) =>
              direction ===
              outputs[index]
          )
      );

    if (
      matches.length === 1
    ) {
      signalStates.set(
        address,
        matches[0]!.label
      );
    }
  }
}

function recomputeTurnoutStates(): void {
  turnoutStates.clear();

  const uniqueAddresses =
    new Set(
      turnouts.map(
        turnout =>
          turnout.address
      )
    );

  for (
    const address of
    uniqueAddresses
  ) {
    const turnout =
      uniqueTurnout(
        address
      );

    if (!turnout) {
      continue;
    }

    if (
      turnout.outputMode ===
      "extended"
    ) {
      const aspectEntry =
        signalAspectRaw.get(
          address
        );

      const physicalEntry =
        turnoutPhysicalRaw.get(
          address
        );

      if (
        aspectEntry &&
        (
          !physicalEntry ||
          aspectEntry.sequence >
            physicalEntry.sequence
        )
      ) {
        if (
          aspectEntry.value ===
          turnout.closedAspect
        ) {
          turnoutStates.set(
            address,
            true
          );
        } else if (
          aspectEntry.value ===
          turnout.openedAspect
        ) {
          turnoutStates.set(
            address,
            false
          );
        }

        continue;
      }

      if (physicalEntry) {
        turnoutStates.set(
          address,
          physicalEntry.value ===
            turnout.closedValue
        );
      }

      continue;
    }

    if (
      turnout.outputMode ===
      "vpin"
    ) {
      const entry =
        vpinRaw.get(
          address
        );

      if (entry) {
        turnoutStates.set(
          address,
          entry.value ===
            turnout.closedValue
        );
      }

      continue;
    }

    // Basic accessory turnouts can be reported either as turnoutChanged or
    // accessoryChanged. Use whichever event arrived most recently.
    const entry =
      newerRaw(
        turnoutPhysicalRaw.get(
          address
        ),
        accessoryRaw.get(
          address
        )
      );

    if (entry) {
      turnoutStates.set(
        address,
        entry.value ===
          turnout.closedValue
      );
    }
  }
}

function recomputeAndSendSignals(): void {
  recomputeSignalStates();
  sendSignalStates();
}

function scheduleSignalRecompute(): void {
  if (
    signalRecomputeTimer !==
    null
  ) {
    globalThis.clearTimeout(
      signalRecomputeTimer
    );
  }

  // A Basic-DCC signal state can require several consecutive accessory
  // commands. Batch their feedback so scripts do not observe a transient
  // intermediate R/G pattern as another logical signal state.
  signalRecomputeTimer =
    globalThis.setTimeout(
      () => {
        signalRecomputeTimer =
          null;

        recomputeAndSendSignals();
      },
      25
    );
}

function recomputeAndSendTurnouts(): void {
  recomputeTurnoutStates();
  sendTurnoutStates();
}

export function applyClientScriptLayoutAccessoryCatalog(
  layoutValue: unknown
): void {
  const layout =
    asObject(
      layoutValue
    );

  const nextSignals:
    ClientScriptSignalCatalogItem[] =
    [];

  const nextTurnouts:
    ClientScriptTurnoutCatalogItem[] =
    [];

  if (layout) {
    const layers =
      Array.isArray(
        layout.layers
      )
        ? layout.layers
        : [];

    for (
      const rawLayer of
      layers
    ) {
      const layer =
        asObject(
          rawLayer
        );

      if (!layer) {
        continue;
      }

      const elements =
        Array.isArray(
          layer.elements
        )
          ? layer.elements
          : [];

      for (
        const rawElement of
        elements
      ) {
        const element =
          asObject(
            rawElement
          );

        if (!element) {
          continue;
        }

        const signal =
          parseSignal(
            element
          );

        if (signal) {
          nextSignals.push(
            signal
          );
        }

        nextTurnouts.push(
          ...parseTurnouts(
            element
          )
        );
      }
    }
  }

  signals =
    nextSignals;

  turnouts =
    nextTurnouts;

  catalogReady =
    true;

  recomputeSignalStates();
  recomputeTurnoutStates();
  sendAll();
}

export function sendClientScriptLayoutAccessoryStateToWorker(): void {
  sendAll();
}

function clearLiveState(): void {
  if (
    signalRecomputeTimer !==
    null
  ) {
    globalThis.clearTimeout(
      signalRecomputeTimer
    );

    signalRecomputeTimer =
      null;
  }

  accessoryRaw.clear();
  vpinRaw.clear();
  turnoutPhysicalRaw.clear();
  signalAspectRaw.clear();
  signalStates.clear();
  turnoutStates.clear();

  sendSignalStates();
  sendTurnoutStates();
}

export function installClientScriptLayoutAccessoryTracking(
  workerPoster: WorkerPoster
): void {
  poster =
    workerPoster;

  if (installed) {
    return;
  }

  installed =
    true;

  wsClient.on<AccessoryChangedPayload>(
    "accessoryChanged",
    data => {
      const address =
        integerOrNull(
          data?.address,
          1,
          32767
        );

      if (address === null) {
        return;
      }

      rememberRaw(
        accessoryRaw,
        address,
        Boolean(
          data?.active
        )
      );

      scheduleSignalRecompute();
      recomputeAndSendTurnouts();
    }
  );

  wsClient.on<SignalAspectChangedPayload>(
    "signalAspectChanged",
    data => {
      const address =
        integerOrNull(
          data?.address,
          1,
          2048
        );

      const aspect =
        integerOrNull(
          data?.aspect,
          0,
          255
        );

      if (
        address === null ||
        aspect === null
      ) {
        return;
      }

      rememberRaw(
        signalAspectRaw,
        address,
        aspect
      );

      recomputeAndSendSignals();
      recomputeAndSendTurnouts();
    }
  );

  wsClient.on<TurnoutChangedPayload>(
    "turnoutChanged",
    data => {
      const address =
        integerOrNull(
          data?.address,
          1,
          2048
        );

      if (address === null) {
        return;
      }

      rememberRaw(
        turnoutPhysicalRaw,
        address,
        Boolean(
          data?.closed
        )
      );

      recomputeAndSendTurnouts();
    }
  );

  wsClient.on<VpinChangedPayload>(
    "vpinChanged",
    data => {
      const address =
        integerOrNull(
          data?.vpin,
          1,
          32767
        );

      if (address === null) {
        return;
      }

      rememberRaw(
        vpinRaw,
        address,
        Boolean(
          data?.active
        )
      );

      recomputeAndSendTurnouts();
    }
  );

  wsClient.subscribeStatus(
    status => {
      if (
        status ===
        "connected"
      ) {
        wsApi.getLayoutRuntimeSnapshot();
        return;
      }

      // Same safety rule as sensors: no stale state may satisfy an IS/WAIT
      // condition after the WebSocket connection is gone.
      clearLiveState();
    }
  );

  if (
    wsClient.isConnected()
  ) {
    wsApi.getLayoutRuntimeSnapshot();
  }
}

function numberArg(
  args: unknown[],
  index: number
): number {
  return Number(
    args[index]
  );
}

function booleanArg(
  args: unknown[],
  index: number
): boolean {
  return Boolean(
    args[index]
  );
}

function stringArg(
  args: unknown[],
  index: number
): string {
  return String(
    args[index] ?? ""
  );
}

function executeSignalStateCommand(
  args: unknown[]
): string | null {
  const address =
    numberArg(
      args,
      0
    );

  const label =
    stringArg(
      args,
      1
    ).trim();

  const signal =
    uniqueSignal(
      address
    );

  if (!signal) {
    sendSignalStates();

    return (
      `dcc.setSignalState: signal address ${address} is not uniquely configured in the layout.`
    );
  }

  const state =
    findSignalState(
      signal,
      label
    );

  if (!state) {
    sendSignalStates();

    return (
      `dcc.setSignalState: signal ${address} has no unique configured state "${label}".`
    );
  }

  if (
    signal.protocol ===
    "dccext"
  ) {
    const ok =
      wsApi.setSignalAspect(
        signal.address,
        state.aspect
      );

    if (!ok) {
      sendSignalStates();

      return (
        "dcc.setSignalState: WebSocket command could not be sent."
      );
    }

  } else {
    for (
      let index = 0;
      index <
        signal.outputCount;
      ++index
    ) {
      const active =
        state.dccOutputs[index] ===
        "G";

      const ok =
        wsApi.setBasicAccessory(
          signal.address +
            index,
          active
        );

      if (!ok) {
        // Do not make the semantic cache optimistic after a partial/failed
        // multi-output transmission. Server feedback will rebuild truth.
        sendSignalStates();

        return (
          "dcc.setSignalState: one or more Basic DCC accessory commands could not be sent."
        );
      }
    }

  }

  // Do not update semantic state optimistically. Wait for the Hub's
  // signalAspectChanged/accessoryChanged feedback so is*/waitFor* reflects
  // accepted runtime state rather than merely command intent.
  return null;
}

function executeTurnoutStateCommand(
  args: unknown[]
): string | null {
  const address =
    numberArg(
      args,
      0
    );

  const logicalClosed =
    booleanArg(
      args,
      1
    );

  const turnout =
    uniqueTurnout(
      address
    );

  if (!turnout) {
    sendTurnoutStates();

    return (
      `dcc.setTurnoutState: turnout address ${address} is not uniquely configured in the layout.`
    );
  }

  const physicalValue =
    logicalClosed
      ? turnout.closedValue
      : !turnout.closedValue;

  const ok =
    sendTurnoutOutput(
      turnout.outputMode,
      turnout.address,
      physicalValue,
      {
        closedValue:
          turnout.closedValue,
        closedAspect:
          turnout.closedAspect,
        openedAspect:
          turnout.openedAspect,
      }
    );

  if (!ok) {
    sendTurnoutStates();

    return (
      "dcc.setTurnoutState: WebSocket command could not be sent."
    );
  }

  // Do not update semantic state optimistically. The Hub will broadcast the
  // accepted turnout/vpin/aspect runtime change, which updates the cache.

  return null;
}

export function executeClientScriptLayoutAccessoryCommand(
  method: ClientScriptWorkerDccMethod,
  args: unknown[]
): string | null | undefined {
  if (
    method ===
    "setSignalState"
  ) {
    return executeSignalStateCommand(
      args
    );
  }

  if (
    method ===
    "setTurnoutState"
  ) {
    return executeTurnoutStateCommand(
      args
    );
  }

  return undefined;
}
