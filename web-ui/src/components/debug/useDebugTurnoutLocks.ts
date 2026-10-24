import { useEffect, useState } from "react";
import { wsClient } from "@/services/wsClient";

export type DebugTurnoutLocks = Map<number, string>;

// Display-only replica of the backend SwitchMan lock snapshot.
// Never acquires/releases a lock or sends a turnout command.
export function useDebugTurnoutLocks(opened: boolean): DebugTurnoutLocks {
  const [locks, setLocks] = useState<DebugTurnoutLocks>(new Map());

  useEffect(() => {
    if (!opened) return;
    const update = (value: unknown) => {
      if (!Array.isArray(value)) return;
      const next = new Map<number, string>();
      for (const entry of value) {
        if (!entry || typeof entry !== "object") continue;
        const item = entry as Record<string, unknown>;
        const address = Number(item.address ?? item.Address);
        if (!Number.isInteger(address) || address < 1 || address > 2048) continue;
        next.set(address, String(item.ownerName ?? item.OwnerName ?? "SwitchMan"));
      }
      setLocks(next);
    };
    const offMessages = wsClient.subscribeMessages(message => {
      const event = message as unknown as { type: string; data?: { locks?: unknown; action?: string; extra?: { locks?: unknown } } };
      if (event.type === "switchManChanged") update(event.data?.locks);
      if (event.type === "switchManResponse" && event.data?.action === "snapshot") update(event.data.extra?.locks);
    });
    const requestSnapshot = () => {
      if (!wsClient.isConnected()) return;
      wsClient.send({ type: "switchManCommand", data: {
        requestId: `debug-locks-${Date.now()}`, action: "snapshot"
      } });
    };
    const offStatus = wsClient.subscribeStatus(status => {
      if (status !== "connected") setLocks(new Map());
      else requestSnapshot();
    });
    requestSnapshot();
    return () => { offMessages(); offStatus(); };
  }, [opened]);

  return locks;
}
