import { Badge, Group, Text } from "@mantine/core";
import { useEffect, useState } from "react";

type Adapter = { id: string; name: string; enabled: boolean };
type AdapterStatus = { id: string; connected: boolean; message?: string };
type Z21Draft = { id: string; name: string; enabled: boolean };

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
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const enabledAdapters = adapters.filter(item => item.enabled);
  const enabledHandhelds = handhelds.filter(item => item.enabled);
  if (!enabledAdapters.length && !enabledHandhelds.length) return null;

  return <Group justify="flex-end" gap="xs" wrap="wrap" aria-label="External device status">
    <Text size="xs" c="dimmed">External devices:</Text>
    {enabledAdapters.map(device => {
      const state = statuses.find(item => item.id === device.id);
      const online = available && !!state?.connected;
      return <Badge key={device.id} size="md" variant="light"
        color={!available ? "gray" : online ? "teal" : "yellow"}
        title={state?.message ?? (online ? "Connected" : "Not connected")}>
        {device.name} · {online ? "Online" : available ? "Offline" : "Unknown"}
      </Badge>;
    })}
    {enabledHandhelds.map(device =>
      <Badge key={device.id} size="md" color="gray" variant="light"
        title="Z21 server is not implemented; browser-only configuration">
        {device.name} · Planned
      </Badge>
    )}
  </Group>;
}
