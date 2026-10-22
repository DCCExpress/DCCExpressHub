import type { ServerWsPayloadMap } from "@domain/wsTypes";
import { wsClient } from "./wsClient";

type RailComEntry = ServerWsPayloadMap["railComStateChanged"]["entries"][number];

// Read-only, transient identification cache. RailCom is NOT an occupancy source:
// the existing sensorSnapshot/sensorChanged handling stays authoritative.
let addressesBySensor = new Map<number, readonly number[]>();
const listeners = new Set<() => void>();

function publishIfChanged(next: Map<number, readonly number[]>): void {
  if (next.size === addressesBySensor.size &&
    [...next].every(([sensor, addresses]) => {
      const old = addressesBySensor.get(sensor);
      return old?.length === addresses.length &&
        addresses.every((value, index) => value === old[index]);
    })) return;

  addressesBySensor = next;
  listeners.forEach(listener => listener());
}

function acceptPresence(entries: RailComEntry[]): void {
  const values = new Map<number, Set<number>>();
  for (const entry of entries) {
    // 0 is a display placeholder in the debug view, NEVER a locomotive.
    if (!Number.isInteger(entry.sensorAddress) || entry.sensorAddress <= 0 ||
        !Number.isInteger(entry.locomotiveAddress) || entry.locomotiveAddress <= 0) continue;
    const locos = values.get(entry.sensorAddress) ?? new Set<number>();
    locos.add(entry.locomotiveAddress);
    values.set(entry.sensorAddress, locos);
  }
  const next = new Map<number, readonly number[]>();
  values.forEach((locos, sensor) => next.set(sensor, [...locos].sort((a, b) => a - b)));
  publishIfChanged(next);
}

// Register once at the transport boundary, not once per canvas or detector.
wsClient.on("railComStateChanged", data => acceptPresence(data.entries));
wsClient.on("railComStateSnapshot", data => acceptPresence(data.entries));
wsClient.subscribeStatus(status => {
  if (status === "connected") {
    // Read the existing Hub snapshot so the overlay also works when the Log
    // tab has never been opened. This does not interrogate the hardware.
    wsClient.send({ type: "getRailComDebug", data: {} });
  } else {
    publishIfChanged(new Map());
  }
});

export function getRailComLocomotives(sensorAddress: number): readonly number[] {
  return addressesBySensor.get(sensorAddress) ?? [];
}

export function subscribeRailComSensorChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
