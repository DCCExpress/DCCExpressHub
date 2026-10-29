import { Text } from "@mantine/core";
import { useEffect, useState } from "react";

type Adapter = { id: string; name: string; enabled: boolean };
type AdapterStatus = { id: string; connected: boolean; message?: string };
type Z21Draft = { id: string; name: string; enabled: boolean; udpPort: number };
type Z21Status = { enabled: boolean; port: number; clients: number; state: string };

const Z21_KEY = "dccexpress.external-devices.z21.v1";

function loadHandhelds(): Z21Draft[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(Z21_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Z21Draft =>
      !!item && typeof item.id === "string" && typeof item.name === "string"
      && typeof item.enabled === "boolean");
  } catch { return []; }
}

export default function ExternalDeviceStatusStrip() {
  const [adapters, setAdapters] = useState<Adapter[]>([]);
  const [statuses, setStatuses] = useState<AdapterStatus[]>([]);
  const [handhelds, setHandhelds] = useState<Z21Draft[]>(loadHandhelds);
  const [available, setAvailable] = useState(true);
  const [z21Status, setZ21Status] = useState<Z21Status | null>(null);

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
  if (!enabledAdapters.length && !enabledHandhelds.length) return null;

  return <ul aria-label="External devices" style={{ margin: 0, paddingLeft: 22, alignSelf: "flex-end", fontSize: 12 }}>
    <li><Text span size="xs" fw={600}>External devices</Text></li>
    {enabledAdapters.map(device => {
      const state = statuses.find(item => item.id === device.id);
      const online = available && !!state?.connected;
      return <li key={device.id} title={state?.message ?? ""}>{device.name} · <Text span c={online ? "teal" : "dimmed"}>{online ? "Online" : available ? "Offline" : "Unknown"}</Text></li>;
    })}
    {enabledHandhelds.map(device =>
      <li key={device.id}>{device.name} · <Text span c={z21Status?.enabled && z21Status.clients > 0 ? "teal" : "dimmed"}>
        {z21Status?.enabled && z21Status.clients > 0 ? "Client detected" : z21Status?.enabled ? z21Status.state : "Offline"}
      </Text></li>
    )}
  </ul>;
}
