
import type {
  BlockState,
  LocoReservation,
  LocoState,
} from "./domainTypes.js";

/**
 * Szerver -> kliens vasúti runtime event payloadok.
 *
 * Ezek az élő állapotfrissítések a command center,
 * a szimulátor és a kliens közös contractjai.
 */
export type LocoReservationChangedPayload = {
  locoAddress: number;
  reservation: LocoReservation | null;
};

export type LocoStateChangedPayload = {
  loco: LocoState;
};

export type TurnoutChangedPayload = {
  address: number;
  closed: boolean;
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
