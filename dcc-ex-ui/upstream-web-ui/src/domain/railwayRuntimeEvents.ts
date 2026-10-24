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
  closed: boolean;
  logicalClosed?: boolean | null;
  outputMode?: "accessory" | "extended" | "vpin";
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

export type RuntimePhysicalSnapshotPayload = {
  basicAccessories: Array<{
    address: number;
    active: boolean;
  }>;
  extendedAccessories: Array<{
    address: number;
    aspect: number;
  }>;
};

export type SensorChangedPayload = {
  address: number;
  on: boolean;
};

export type SensorSnapshotPayload = {
  groups: Array<[number, number, number]>;
};

export type BlockStateChangedPayload =
  Record<string, BlockState>;
