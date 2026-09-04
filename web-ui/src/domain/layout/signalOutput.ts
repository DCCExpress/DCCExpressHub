export const MAX_SIGNAL_LAMPS = 5;

export type SignalOutputProtocol =
  | "dcc"
  | "dccext";

export type SignalDccDirection =
  | "R"
  | "G";

export type SignalLampState = {
  color: string;
  active: boolean;
};

export type SignalOutputState = {
  id: string;
  label: string;

  /**
   * DCC Extended aspect value.
   * Ignored for Basic DCC.
   */
  aspect: number;

  /**
   * Physical lamp image for this logical signal state.
   */
  lamps: SignalLampState[];

  /**
   * Basic DCC mapping for consecutive accessory addresses.
   */
  dccOutputs: SignalDccDirection[];
};

export type SignalOutputConfiguration = {
  protocol: SignalOutputProtocol;

  /**
   * DCC Extended: common signal address.
   * Basic DCC: first consecutive accessory address.
   */
  address: number;

  /**
   * Basic DCC only.
   */
  outputCount: number;

  /**
   * Number of physical lamps drawn in the signal head.
   * Independent from states.length and outputCount.
   */
  lampCount: number;

  /**
   * Compatibility / compact display option from the old signal.
   * When enabled, the current state's first active lamp color is drawn
   * as a single lamp while the logical state remains unchanged.
   */
  displayAsSingleLamp: boolean;

  states: SignalOutputState[];
};

export function newSignalOutputStateId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `signal-state-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function resizeSignalLamps(
  lamps: SignalLampState[],
  count: number
): SignalLampState[] {
  const safeCount = Math.max(1, Math.min(MAX_SIGNAL_LAMPS, Math.trunc(count)));

  return Array.from({ length: safeCount }, (_, index) =>
    lamps[index]
      ? { ...lamps[index]! }
      : { color: "#868e96", active: false }
  );
}

export function resizeDccOutputs(
  outputs: SignalDccDirection[],
  count: number
): SignalDccDirection[] {
  const safeCount = Math.max(1, Math.min(16, Math.trunc(count)));

  return Array.from(
    { length: safeCount },
    (_, index) => outputs[index] ?? "R"
  );
}

export function cloneSignalOutputConfiguration(
  value: SignalOutputConfiguration
): SignalOutputConfiguration {
  return {
    ...value,
    states: value.states.map(state => ({
      ...state,
      lamps: state.lamps.map(lamp => ({ ...lamp })),
      dccOutputs: [...state.dccOutputs],
    })),
  };
}

export function createDefaultSignalOutputConfiguration(
  address = 1,
  lampCount = 2
): SignalOutputConfiguration {
  const safeLampCount = Math.max(1, Math.min(MAX_SIGNAL_LAMPS, Math.trunc(lampCount)));

  const lampColors = [
    "#fa5252",
    "#40c057",
    "#fab005",
    "#ffffff",
  ];

  const makeLamps = (
    activeIndex: number,
    activeColor: string
  ): SignalLampState[] =>
    Array.from({ length: safeLampCount }, (_, index) => ({
      color:
        index === activeIndex
          ? activeColor
          : (lampColors[index] ?? "#868e96"),
      active: index === activeIndex,
    }));

  return {
    protocol: "dcc",
    address: Math.max(1, Math.trunc(address)),
    outputCount: Math.max(1, safeLampCount),
    lampCount: safeLampCount,
    displayAsSingleLamp: false,
    states: [
      {
        id: newSignalOutputStateId(),
        label: "Red",
        aspect: 0,
        lamps: makeLamps(0, "#fa5252"),
        dccOutputs: Array.from(
          { length: safeLampCount },
          (_, index) => index === 0 ? "G" as const : "R" as const
        ),
      },
      {
        id: newSignalOutputStateId(),
        label: "Green",
        aspect: 16,
        lamps: makeLamps(
          Math.min(1, safeLampCount - 1),
          "#40c057"
        ),
        dccOutputs: Array.from(
          { length: safeLampCount },
          (_, index) =>
            index === Math.min(1, safeLampCount - 1)
              ? "G" as const
              : "R" as const
        ),
      },
    ],
  };
}
