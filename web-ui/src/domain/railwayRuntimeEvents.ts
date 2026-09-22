import type {
  BlockState,
  LocoReservation,
  LocoState,
} from "./domainTypes.js";

export type LocoReservationChangedPayload = {
  locoAddress: number;
  reservation: LocoReservation | null;
};

export type LocoStateChangedPayload = {
  loco: LocoState;
};

export type TurnoutChangedPayload = {
  address: number;

  /**
   * Physical DCC accessory value.
   * Kept as `closed` for wire compatibility with the existing protocol.
   */
  closed: boolean;

  outputMode?: "accessory" | "extended";

  /**
   * Current extended accessory aspect when outputMode === "extended".
   */
  aspect?: number | null;

  closedAspect?: number;
  openedAspect?: number;
};

export type AccessoryChangedPayload = {
  address: number;
  active: boolean;
};

export type VpinChangedPayload = {
  vpin: number;
  active: boolean;
};

export type SignalAspectChangedPayload = {
  address: number;
  aspect: number;
};

export type SensorChangedPayload = {
  address: number;
  on: boolean;
};

export type SensorSnapshotPayload = {
  /** Tuples are [baseAddress, activeBits, knownBits], covering 16 addresses. */
  groups: Array<[number, number, number]>;
};

export type BlockStateChangedPayload =
  Record<string, BlockState>;
