import {
  Alert, Badge, Button, Card, Group, NumberInput, Select, Stack,
  Switch, Text, TextInput, Title, SimpleGrid, Table, Autocomplete
} from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import { S88SensorIndicator } from "./components/S88SensorIndicator";
import AppModal from "./components/common/AppModal";

type ExternalDevice = {
  id: string;
  type: "dcc-express-s88-adapter";
  name: string;
  enabled: boolean;
  serialPort: string;
  sensorOffset: number;
  sensorCount: number;
  s88Bytes: number;
};
type DeviceStatus = {
  id: string;
  port: string;
  connected: boolean;
  activeInputs: number;
  lastSnapshotUtc: string | null;
  message: string;
  snapshot: boolean[];
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
  s88Bytes: 4,
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

type Z21Device = { id: string; name: string; enabled: boolean; udpPort: number };
const Z21_KEY = "dccexpress.external-devices.z21.v1";
function loadZ21(): Z21Device[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(Z21_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter((x): x is Z21Device => x && typeof x.id === "string" &&
      typeof x.name === "string" && typeof x.enabled === "boolean" &&
      Number.isInteger(x.udpPort) && x.udpPort > 0 && x.udpPort <= 65535);
    // One listener per UDP port. Prefer the enabled entry for older duplicates.
    const byPort = new Map<number, Z21Device>();
    for (const device of valid)
      if (!byPort.has(device.udpPort) || (device.enabled && !byPort.get(device.udpPort)!.enabled))
        byPort.set(device.udpPort, device);
    return [...byPort.values()];
  } catch { return []; }
}
const newZ21 = (): Z21Device => ({
  id: "z21-" + Date.now(), name: "ROCO WLANMAUS", enabled: false, udpPort: 21105,
});

export default function ExternalDevicesPage({
  onBack,
  onDiagnostics,
}: {
  onBack: () => void;
  onDiagnostics: () => void;
}) {
  const [devices, setDevices] = useState<ExternalDevice[]>([]);
  const [status, setStatus] = useState<DeviceStatus[]>([]);
  const [ports, setPorts] = useState<string[]>([]);
  const [draft, setDraft] = useState<ExternalDevice>(emptyDevice);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [monitorId, setMonitorId] = useState<string | null>(null);
  const [addTypeOpen, setAddTypeOpen] = useState(false);
  const [z21Devices, setZ21Devices] = useState<Z21Device[]>(loadZ21);
  useEffect(() => {
    // Normalize older duplicate entries sharing the same UDP port.
    try { window.localStorage.setItem(Z21_KEY, JSON.stringify(loadZ21())); } catch { /* storage unavailable */ }
  }, []);
  const [z21Draft, setZ21Draft] = useState<Z21Device | null>(null);
  const [z21Status, setZ21Status] = useState<{ enabled: boolean; clients: number; state: string; port: number; listeners?: { port: number; clients: number; state: string }[] } | null>(null);
  const refreshZ21 = useCallback(async () => {
    const response = await fetch("/api/z21-handheld/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Z21 status unavailable");
    const result = await response.json() as { ok: boolean; status: { enabled: boolean; clients: number; state: string; port: number; listeners?: { port: number; clients: number; state: string }[] } };
    if (result.ok) setZ21Status(result.status);
  }, []);
  useEffect(() => {
    void refreshZ21().catch(() => {});
    const interval = window.setInterval(() => void refreshZ21().catch(() => {}), 4000);
    return () => window.clearInterval(interval);
  }, [refreshZ21]);
  const saveZ21 = async () => {
    if (!z21Draft || !z21Draft.name.trim() || !Number.isInteger(z21Draft.udpPort) ||
        z21Draft.udpPort < 1 || z21Draft.udpPort > 65535) return;
    if (z21Devices.some(x => x.id !== z21Draft.id && x.udpPort === z21Draft.udpPort)) {
      setMessage("NOK: Another Z21 listener already uses UDP port " + z21Draft.udpPort);
      return;
    }
    const previous = z21Devices.find(x => x.id === z21Draft.id);
    const next = [...z21Devices.filter(x => x.id !== z21Draft.id), z21Draft];
    try {
      if (previous?.enabled && previous.udpPort !== z21Draft.udpPort)
        await postForm("/api/z21-handheld/configure", { enabled: "false", port: String(previous.udpPort) });
      await postForm("/api/z21-handheld/configure", {
        enabled: String(z21Draft.enabled), port: String(z21Draft.udpPort),
      });
      window.localStorage.setItem(Z21_KEY, JSON.stringify(next));
      setZ21Devices(next);
      setZ21Draft(null);
      await refreshZ21();
      setMessage("Z21 UDP listener configuration saved.");
    } catch (error) { setMessage("NOK: " + String(error)); }
  };
  const deleteZ21 = async (id: string) => {
    if (!window.confirm("Delete this Z21 handheld configuration?")) return;
    const next = z21Devices.filter(x => x.id !== id);
    try {
      await postForm("/api/z21-handheld/configure", { enabled: "false", port: String(z21Devices.find(x => x.id === id)?.udpPort ?? 21105) });
      window.localStorage.setItem(Z21_KEY, JSON.stringify(next));
      setZ21Devices(next);
      if (z21Draft?.id === id) setZ21Draft(null);
    } catch (error) { setMessage("NOK: " + String(error)); }
  };

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
        sensorCount: String(draft.s88Bytes * 8),
        s88Bytes: String(draft.s88Bytes),
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
      if (monitorId === id) setMonitorId(null);
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

  const setEnabled = async (device: ExternalDevice, enabled: boolean) => {
    setBusy(true);
    try {
      await postForm("/api/external-devices/save", {
        id: device.id, name: device.name, type: device.type,
        serialPort: device.serialPort, sensorOffset: String(device.sensorOffset),
        sensorCount: String(device.s88Bytes * 8), s88Bytes: String(device.s88Bytes),
        enabled: String(enabled),
      });
      await refresh();
      setMessage(enabled ? "Device enabled: backend will connect automatically." :
        "Device disabled: backend will close its serial port and invalidate its sensors.");
    } catch (error) { setMessage("NOK: " + String(error)); }
    finally { setBusy(false); }
  };
  const selected = devices.find(x => x.id === monitorId);
  const selectedStatus = status.find(x => x.id === monitorId);

  const portOptions = [...new Set([...ports, ...(draft.serialPort ? [draft.serialPort] : [])])]
    .sort((a, b) => a.localeCompare(b));

  return <Stack gap="md" p="md">
    <Group justify="space-between" align="center">
      <div>
        <Title order={2}>External Devices</Title>
        <Text c="dimmed" size="sm">
          Configure external feedback adapters and handheld controllers.
        </Text>
      </div>
      <Group>
        <Button variant="light" onClick={() => { void refreshPorts().catch(e => setMessage(String(e))); }}>Refresh ports</Button>
        <Button variant="light" onClick={() => setAddTypeOpen(true)}>Add device</Button>
        <Button variant="subtle" onClick={onBack}>Back to Home</Button>
      </Group>
    </Group>

    <AppModal opened={addTypeOpen} onClose={() => setAddTypeOpen(false)} title="Add external device" centered>
      <Stack>
        <Button variant="light" onClick={() => { startNew(); setZ21Draft(null); setAddTypeOpen(false); }}>DCCExpress S88 adapter</Button>
        <Button variant="light" onClick={() => { setZ21Draft({ ...newZ21(), udpPort: Array.from({ length: 100 }, (_, i) => 21105 + i).find(port => !z21Devices.some(x => x.udpPort === port)) ?? 21105 }); setEditing(false); setMonitorId(null); setAddTypeOpen(false); }}>Z21 handheld controller (WLANMAUS)</Button>
        <Text size="xs" c="dimmed">Multiple Z21 listeners require distinct UDP ports.</Text>
      </Stack>
    </AppModal>

    {message && <Alert color={message.startsWith("NOK") ? "red" : "blue"} onClose={() => setMessage("")} withCloseButton>{message}</Alert>}

    <Card withBorder padding={0}>
      <Table.ScrollContainer minWidth={740}>
        <Table striped highlightOnHover verticalSpacing="sm">
          <Table.Thead><Table.Tr>
            <Table.Th>Device</Table.Th><Table.Th>Type</Table.Th><Table.Th>Configuration</Table.Th>
            <Table.Th>Status</Table.Th><Table.Th>Actions</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {devices.map(device => {
              const live = status.find(x => x.id === device.id);
              const online = !!(device.enabled && live?.connected);
              return <Table.Tr key={device.id}>
                <Table.Td><Text fw={600}>{device.name}</Text></Table.Td>
                <Table.Td>S88 adapter</Table.Td>
                <Table.Td><Text size="sm">{device.serialPort || "No serial port"} · {device.sensorCount} inputs · Sensors {device.sensorOffset + 1}–{device.sensorOffset + device.sensorCount}</Text></Table.Td>
                <Table.Td><Badge color={online ? "green" : device.enabled ? "yellow" : "gray"}>
                  {online ? "Connected" : device.enabled ? "Disconnected" : "Disabled"}</Badge></Table.Td>
                <Table.Td><Group gap="xs" wrap="nowrap">
                  <Button size="xs" variant="light" onClick={() => { setDraft({ ...device }); setEditing(true); setZ21Draft(null); setMonitorId(null); }}>Config</Button>
                  <Button size="xs" color="red" variant="subtle" disabled={busy} onClick={() => void remove(device.id)}>Delete</Button>
                </Group></Table.Td>
              </Table.Tr>;
            })}
            {z21Devices.map(device => <Table.Tr key={device.id}>
              <Table.Td><Text fw={600}>{device.name}</Text></Table.Td>
              <Table.Td>Z21 WLANMAUS</Table.Td>
              <Table.Td>UDP {device.udpPort} · Z21 LAN</Table.Td>
              <Table.Td><Badge color={z21Status?.listeners?.find(x => x.port === device.udpPort)?.clients ? "teal" : "gray"}>
                {z21Status?.listeners?.find(x => x.port === device.udpPort)?.clients ? "Client detected" : z21Status?.listeners?.find(x => x.port === device.udpPort)?.state ?? "Disabled"}
              </Badge></Table.Td>
              <Table.Td><Group gap="xs" wrap="nowrap">
                <Button size="xs" variant="light" onClick={() => { setZ21Draft({ ...device }); setEditing(false); setMonitorId(null); }}>Config</Button>
                <Button size="xs" color="red" variant="subtle" onClick={() => void deleteZ21(device.id)}>Delete</Button>
              </Group></Table.Td>
            </Table.Tr>)}
            {devices.length === 0 && z21Devices.length === 0 && <Table.Tr><Table.Td colSpan={5}>
              <Text ta="center" c="dimmed" py="md">No external devices configured. Use Add device to get started.</Text>
            </Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>

    <AppModal opened={z21Draft !== null} onClose={() => setZ21Draft(null)} title="Z21 handheld configuration" centered size="lg">
      <Stack gap="md">
        <Group justify="space-between"><Title order={4}>Z21 handheld configuration</Title><Badge color="cyan">Z21 UDP</Badge></Group>
        <Alert color="blue">Z21 UDP supports locomotive drive, functions, turnouts, track power and emergency stop. Full WLANMAUS compatibility is still under test.</Alert>
        <TextInput label="Name" value={z21Draft?.name ?? ""} onChange={event => { const value = event.currentTarget.value; setZ21Draft(old => old && ({ ...old, name: value })); }} />
        <NumberInput label="Z21 server UDP port" min={1} max={65535} value={z21Draft?.udpPort ?? 21105}
          description="Default: 21105. The handset connects to the HUB's IP address."
          onChange={value => setZ21Draft(old => old && ({ ...old, udpPort: typeof value === "number" ? value : 0 }))} />
        <Switch label="Enable handheld support (when available)" checked={z21Draft?.enabled ?? false}
          onChange={event => { const checked = event.currentTarget.checked; setZ21Draft(old => old && ({ ...old, enabled: checked })); }} />
        <Group justify="flex-end">
          <Button variant="light" onClick={() => setZ21Draft(null)}>Cancel</Button>
          <Button onClick={saveZ21} disabled={!z21Draft?.name.trim() || !z21Draft || z21Draft.udpPort < 1 || z21Draft.udpPort > 65535 || busy}>Save</Button>
        </Group>
      </Stack>
    </AppModal>



    {selected && <Card withBorder radius="md" p="lg">
      <Stack gap="sm">
        <Group justify="space-between">
          <div>
            <Title order={4}>S88Adapter monitor — {selected.name}</Title>
            <Text size="sm" c="dimmed">
              {selected.serialPort} · 115200 baud · {selected.s88Bytes} bytes / {selected.sensorCount} inputs · Sensor {selected.sensorOffset + 1}–{selected.sensorOffset + selected.sensorCount}
            </Text>
          </div>
          <Group gap="xs">
            <Badge color={selectedStatus?.connected ? "green" : "gray"}>
              {selectedStatus?.connected ? "ONLINE" : selected.enabled ? "OFFLINE" : "DISABLED"}
            </Badge>
            <Button variant="subtle" size="xs" onClick={() => setMonitorId(null)}>Close monitor</Button>
          </Group>
        </Group>
        <Text size="xs" c="dimmed">
          {selectedStatus?.message ?? "Waiting for backend connection"}
          {selectedStatus?.lastSnapshotUtc && ` · Last snapshot: ${new Date(selectedStatus.lastSnapshotUtc).toLocaleTimeString()}`}
        </Text>
        <SimpleGrid cols={{ base: 4, xs: 8, md: 16 }} spacing="xs">
          {Array.from({ length: selected.sensorCount }, (_, index) =>
            <S88SensorIndicator key={index} number={index + 1}
              known={!!selectedStatus?.connected && index < (selectedStatus.snapshot?.length ?? 0)}
              active={!!selectedStatus?.snapshot?.[index]} />
          )}
        </SimpleGrid>
        <Text size="xs" c="dimmed">
          S88 input 1 = Hub sensor {selected.sensorOffset + 1}. The backend owns this COM/tty port.
          The original USB diagnostic console can be opened after stopping the device.
        </Text>
        <Group>
          <Button variant="light" disabled={selected.enabled} onClick={onDiagnostics}>
            Open S88Adapter diagnostics
          </Button>
          {selected.enabled && <Text size="xs" c="dimmed">Stop the device first to release the serial port for diagnostics.</Text>}
        </Group>
      </Stack>
    </Card>}

    <AppModal opened={editing} onClose={() => setEditing(false)} title={draft.id ? "Configure S88 adapter" : "Add S88 adapter"} centered size="lg">
      <Stack gap="md">
        <Title order={4}>{draft.id ? "Configure S88 adapter" : "Add S88 adapter"}</Title>
        {draft.id && <Group gap="xs">
          <Button variant="light" size="xs" disabled={busy} onClick={() => { setMonitorId(draft.id); setEditing(false); }}>Monitor</Button>
          <Button variant="light" size="xs" disabled={busy || !draft.enabled} onClick={() => void test(draft.id)}>Test</Button>
          <Button variant="light" size="xs" disabled={busy} onClick={() => void setEnabled(draft, !draft.enabled)}>{draft.enabled ? "Stop" : "Start"}</Button>
        </Group>}
        <Select
          label="Device"
          data={[{ value: "dcc-express-s88-adapter", label: "DCCExpressS88Adapter" }]}
          value={draft.type}
          onChange={() => {}}
          allowDeselect={false}
        />
        <TextInput label="Name" value={draft.name} onChange={event => { const value = event.currentTarget.value; setDraft(old => ({ ...old, name: value })); }} />
        <Autocomplete
          label="Serial port"
          placeholder="Select or type COM9 / tty path"
          data={portOptions}
          value={draft.serialPort}
          onChange={value => setDraft(old => ({ ...old, serialPort: value }))}
          description="Manual port names are allowed even when the device is disconnected."
        />
        {draft.serialPort.trim() && ports.length > 0 &&
          !ports.some(port => port.toLowerCase() === draft.serialPort.trim().toLowerCase()) &&
          <Alert color="yellow">Port {draft.serialPort} is not currently detected. The configuration can still be saved; connection may fail until the device is available.</Alert>}
        <Group grow>
          <NumberInput label="Sensor offset" description="Input 1 = offset + 1" min={0} max={65527} value={draft.sensorOffset}
            onChange={value => setDraft(old => ({ ...old, sensorOffset: typeof value === "number" ? value : 0 }))} />
          <NumberInput label="S88 bytes / groups" description={`${draft.s88Bytes * 8} occupancy inputs`} min={1} max={32} step={1} value={draft.s88Bytes}
            onChange={value => setDraft(old => {
              const bytes = typeof value === "number" ? value : 4;
              return { ...old, s88Bytes: bytes, sensorCount: bytes * 8 };
            })} />
        </Group>
        <Switch label="Enabled – connect automatically at backend startup" checked={draft.enabled}
          onChange={event => { const checked = event.currentTarget.checked; setDraft(old => ({ ...old, enabled: checked })); }} />
        <Text size="xs" c="dimmed">
          The backend reads STATUS and only sends SET BYTES / SAVE if the adapter needs an update.
          Replacing the COM/tty port closes the old connection before opening the new one.
        </Text>
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
    </AppModal>
  </Stack>;
}
