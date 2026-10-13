import {
  Alert, Badge, Button, Card, Group, NumberInput, Select, Stack,
  Switch, Text, TextInput, Title
} from "@mantine/core";
import { useCallback, useEffect, useState } from "react";

type ExternalDevice = {
  id: string;
  type: "dcc-express-s88-adapter";
  name: string;
  enabled: boolean;
  serialPort: string;
  sensorOffset: number;
  sensorCount: number;
};
type DeviceStatus = {
  id: string;
  port: string;
  connected: boolean;
  activeInputs: number;
  lastSnapshotUtc: string | null;
  message: string;
};
type DeviceReply = {
  ok: boolean;
  devices: ExternalDevice[];
  status: DeviceStatus[];
  message?: string;
};
type ApiResult = { ok: boolean; id?: string; message?: string };
const emptyDevice = (): ExternalDevice => ({
  id: "",
  type: "dcc-express-s88-adapter",
  name: "DCCExpressS88Adapter",
  enabled: true,
  serialPort: "",
  sensorOffset: 50000,
  sensorCount: 32,
});

async function postForm(path: string, payload: Record<string, string>): Promise<ApiResult> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(payload),
  });
  const result = (await response.json()) as ApiResult;
  if (!response.ok || !result.ok) throw new Error(result.message ?? "Request failed");
  return result;
}

export default function ExternalDevicesPage({ onBack }: { onBack: () => void }) {
  const [devices, setDevices] = useState<ExternalDevice[]>([]);
  const [status, setStatus] = useState<DeviceStatus[]>([]);
  const [ports, setPorts] = useState<string[]>([]);
  const [draft, setDraft] = useState<ExternalDevice>(emptyDevice);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/external-devices", { cache: "no-store" });
    const body = (await response.json()) as DeviceReply;
    if (!response.ok || !body.ok) throw new Error(body.message ?? "Could not load devices.");
    setDevices(body.devices ?? []);
    setStatus(body.status ?? []);
  }, []);
  const refreshPorts = useCallback(async () => {
    const response = await fetch("/api/external-devices/ports", { cache: "no-store" });
    const body = (await response.json()) as { ports?: string[]; ok?: boolean };
    if (!response.ok || !body.ok) throw new Error("Could not load serial ports.");
    setPorts(body.ports ?? []);
  }, []);

  useEffect(() => {
    void refresh().catch(error => setMessage(String(error)));
    void refreshPorts().catch(error => setMessage(String(error)));
    const timer = window.setInterval(() => {
      void refresh().catch(() => { /* keep last known status */ });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [refresh, refreshPorts]);

  const startNew = () => { setDraft(emptyDevice()); setEditing(true); setMessage(""); };
  const save = async () => {
    setBusy(true);
    setMessage("");
    try {
      await postForm("/api/external-devices/save", {
        id: draft.id,
        type: draft.type,
        name: draft.name,
        enabled: String(draft.enabled),
        serialPort: draft.serialPort,
        sensorOffset: String(draft.sensorOffset),
        sensorCount: String(draft.sensorCount),
      });
      await refresh();
      setEditing(false);
      setMessage("Device saved. The backend will connect automatically when enabled.");
    } catch (error) { setMessage("NOK: " + String(error)); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!window.confirm("Remove this external device?")) return;
    setBusy(true);
    try {
      await postForm("/api/external-devices/remove", { id });
      await refresh();
      if (draft.id === id) setEditing(false);
      setMessage("Device removed.");
    } catch (error) { setMessage("NOK: " + String(error)); }
    finally { setBusy(false); }
  };
  const test = async (id: string) => {
    setBusy(true);
    try {
      const result = await postForm("/api/external-devices/test", { id });
      setMessage(result.message ?? "Connection OK.");
      await refresh();
    } catch (error) { setMessage("NOK: " + String(error)); }
    finally { setBusy(false); }
  };

  const portOptions = [...new Set([...ports, ...(draft.serialPort ? [draft.serialPort] : [])])]
    .sort((a, b) => a.localeCompare(b));

  return <Stack gap="md" p="md">
    <Group justify="space-between" align="center">
      <div>
        <Title order={2}>External Devices</Title>
        <Text c="dimmed" size="sm">
          Additional feedback devices work alongside DCC-EX, Roco Z21 and YaMoRC.
        </Text>
      </div>
      <Group>
        <Button variant="light" onClick={() => { void refreshPorts().catch(e => setMessage(String(e))); }}>Refresh ports</Button>
        <Button variant="light" onClick={startNew}>Add device</Button>
        <Button variant="subtle" onClick={onBack}>Back to Home</Button>
      </Group>
    </Group>

    {message && <Alert color={message.startsWith("NOK") ? "red" : "blue"} onClose={() => setMessage("")} withCloseButton>{message}</Alert>}

    {devices.length === 0 && !editing &&
      <Text c="dimmed">No external devices configured. Select Add device to connect an S88 adapter.</Text>}
    {devices.map(device => {
      const live = status.find(x => x.id === device.id);
      const online = !!(device.enabled && live?.connected);
      return <Card key={device.id} withBorder radius="md" p="md">
        <Group justify="space-between" align="start">
          <Stack gap={4}>
            <Group gap="xs">
              <Text fw={600}>{device.name}</Text>
              <Badge color={online ? "green" : "gray"}>
                {online ? "Connected" : device.enabled ? "Disconnected" : "Disabled"}
              </Badge>
            </Group>
            <Text size="sm" c="dimmed">DCCExpressS88Adapter · {device.serialPort} · 115200 baud</Text>
            <Text size="sm">Sensor addresses: {device.sensorOffset + 1}–{device.sensorOffset + device.sensorCount}</Text>
            <Text size="xs" c="dimmed">{live?.message ?? "Not started"}{live?.connected ? ` · ${live.activeInputs} inputs reporting` : ""}</Text>
          </Stack>
          <Group gap="xs">
            <Button size="xs" variant="light" disabled={!device.enabled || busy} onClick={() => void test(device.id)}>Test</Button>
            <Button size="xs" variant="light" onClick={() => { setDraft({ ...device }); setEditing(true); setMessage(""); }}>Edit</Button>
            <Button size="xs" variant="light" color="red" disabled={busy} onClick={() => void remove(device.id)}>Remove</Button>
          </Group>
        </Group>
      </Card>;
    })}

    {editing && <Card withBorder radius="md" p="lg">
      <Stack gap="md">
        <Title order={4}>{draft.id ? "Edit external device" : "Add external device"}</Title>
        <Select
          label="Device"
          data={[{ value: "dcc-express-s88-adapter", label: "DCCExpressS88Adapter" }]}
          value={draft.type}
          onChange={() => {}}
          allowDeselect={false}
        />
        <TextInput label="Name" value={draft.name} onChange={event => setDraft(old => ({ ...old, name: event.currentTarget.value }))} />
        <Select
          label="Serial port"
          placeholder="Select COM / tty port"
          searchable
          data={portOptions}
          value={draft.serialPort || null}
          onChange={value => setDraft(old => ({ ...old, serialPort: value ?? "" }))}
        />
        <Group grow>
          <NumberInput label="Sensor offset" description="Input 1 = offset + 1" min={0} max={65527} value={draft.sensorOffset}
            onChange={value => setDraft(old => ({ ...old, sensorOffset: typeof value === "number" ? value : 0 }))} />
          <NumberInput label="S88 inputs" description="8–256 inputs, in multiples of 8" min={8} max={256} step={8} value={draft.sensorCount}
            onChange={value => setDraft(old => ({ ...old, sensorCount: typeof value === "number" ? value : 32 }))} />
        </Group>
        <Switch label="Enabled – connect automatically at backend startup" checked={draft.enabled}
          onChange={event => setDraft(old => ({ ...old, enabled: event.currentTarget.checked }))} />
        <Text size="xs" c="dimmed">
          Choose a unique sensor range that does not overlap with command-center feedback,
          R-BUS, LocoNet, or other external devices. If the adapter disconnects,
          its sensor addresses become UNKNOWN (never automatically FREE).
        </Text>
        <Group justify="flex-end">
          <Button variant="light" onClick={() => setEditing(false)}>Cancel</Button>
          <Button loading={busy} onClick={() => void save()}>Save device</Button>
        </Group>
      </Stack>
    </Card>}
  </Stack>;
}
