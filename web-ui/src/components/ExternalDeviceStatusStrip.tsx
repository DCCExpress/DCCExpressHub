import { Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { useGamepad } from "../context/GamepadContext";

type Adapter = { id: string; name: string; enabled: boolean };
type AdapterStatus = { id: string; connected: boolean; message?: string };
type Z21Draft = { id: string; name: string; enabled: boolean; udpPort: number };
type Z21Status = { enabled: boolean; port: number; clients: number; state: string; listeners?: { port: number; clients: number; state: string }[] };

const Z21_KEY = "dccexpress.external-devices.z21.v1";
const PIKO_KEY = "dccexpress.external-devices.piko.v1";

function loadHandhelds(): Z21Draft[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(Z21_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    const devices = value.filter((item): item is Z21Draft =>
      !!item && typeof item.id === "string" && typeof item.name === "string"
      && typeof item.enabled === "boolean");
    const byPort = new Map<number, Z21Draft>();
    for (const device of devices) {
      if (!byPort.has(device.udpPort) || (device.enabled && !byPort.get(device.udpPort)!.enabled))
        byPort.set(device.udpPort, device);
    }
    return [...byPort.values()];
  } catch { return []; }
}

export default function ExternalDeviceStatusStrip() {
  const { gamepads, selectedGamepadIndex } = useGamepad();
  const [adapters, setAdapters] = useState<Adapter[]>([]);
  const [statuses, setStatuses] = useState<AdapterStatus[]>([]);
  const [handhelds, setHandhelds] = useState<Z21Draft[]>(loadHandhelds);
  const [available, setAvailable] = useState(true);
  const [z21Status, setZ21Status] = useState<Z21Status | null>(null);
  const [pikoStatus, setPikoStatus] = useState<{ clients: number; state: string } | null>(null);
  const [pikoEnabled, setPikoEnabled] = useState(false);

  useEffect(() => {
    try {
      const device = JSON.parse(window.localStorage.getItem(PIKO_KEY) ?? "null") as { enabled?: boolean; tcpPort?: number } | null;
      if (device?.enabled && Number.isInteger(device.tcpPort)) {
        void fetch("/api/piko-handheld/configure", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ enabled: "true", port: String(device.tcpPort) })
        }).catch(() => {});
      }
    } catch { /* no saved PIKO device */ }
  }, []);
  useEffect(() => {
    // Restore the opt-in listener after HUB restart when this browser has a
    // saved enabled handheld. Backend-side persistence will follow.
    for (const device of loadHandhelds().filter(item => item.enabled && Number.isInteger(item.udpPort))) {
      void fetch("/api/z21-handheld/configure", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ enabled: "true", port: String(device.udpPort) }),
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/external-devices", { cache: "no-store" });
        if (!response.ok) throw new Error("External devices API unavailable");
        const result = await response.json() as {
          ok?: boolean; devices?: Adapter[]; status?: AdapterStatus[];
        };
        if (!result.ok) throw new Error("External devices API returned an error");
        if (!active) return;
        setAdapters(result.devices ?? []);
        setStatuses(result.status ?? []);
        setAvailable(true);
      } catch {
        if (active) setAvailable(false);
      }
      if (active) setHandhelds(loadHandhelds());
      try {
        const stored = JSON.parse(window.localStorage.getItem(PIKO_KEY) ?? "null") as { enabled?: boolean } | null;
        if (active) setPikoEnabled(!!stored?.enabled);
        const reply = await fetch("/api/piko-handheld/status", { cache: "no-store" });
        const data = await reply.json() as { ok: boolean; status: { clients: number; state: string } };
        if (active) setPikoStatus(data.ok ? data.status : null);
      } catch { if (active) setPikoStatus(null); }
      try {
        const response = await fetch("/api/z21-handheld/status", { cache: "no-store" });
        if (!response.ok) throw new Error("Z21 unavailable");
        const data = await response.json() as { ok: boolean; status: Z21Status };
        if (active) setZ21Status(data.ok ? data.status : null);
      } catch { if (active) setZ21Status(null); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const enabledAdapters = adapters.filter(item => item.enabled);
  const enabledHandhelds = handhelds.filter(item => item.enabled);

  return <div style={{ alignSelf: "flex-start" }}>
    <Text size="xs" fw={600}>External devices</Text>
    <ul aria-label="External devices" style={{ margin: 0, paddingLeft: 22, fontSize: 12 }}>
    {enabledAdapters.map(device => {
      const state = statuses.find(item => item.id === device.id);
      const online = available && !!state?.connected;
      return <li key={device.id} title={state?.message ?? ""}>{device.name} · <Text span c={online ? "teal" : "dimmed"}>{online ? "Online" : available ? "Offline" : "Unknown"}</Text></li>;
    })}
    <li>Gamepad · <Text span c={gamepads.some(x => x.index === selectedGamepadIndex) ? "teal" : "dimmed"}>
      {gamepads.some(x => x.index === selectedGamepadIndex) ? "Connected" : "Disconnected"}
    </Text></li>
    {pikoEnabled && <li>PIKO SmartControl WLAN · <Text span c={pikoStatus?.clients ? "teal" : "dimmed"}>
      {pikoStatus?.clients ? "TCP connected (experimental)" : pikoStatus?.state ?? "Offline"}
    </Text></li>}
    {enabledHandhelds.map(device =>
      <li key={device.id}>{device.name} · <Text span c={z21Status?.listeners?.some(x => x.port === device.udpPort && x.clients > 0) ? "teal" : "dimmed"}>
        {z21Status?.listeners?.some(x => x.port === device.udpPort && x.clients > 0) ? "Client detected" : z21Status?.listeners?.find(x => x.port === device.udpPort)?.state ?? "Offline"}
      </Text></li>
    )}
    </ul>
  </div>;
}
