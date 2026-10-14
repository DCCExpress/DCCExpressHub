import {
  Alert, Badge, Button, Card, Group, NumberInput, Select, Stack,
  Switch, Text, TextInput, Title, Table, ScrollArea, SimpleGrid
} from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import { S88SensorIndicator } from "./components/S88SensorIndicator";

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
    {devices.length > 0 && <Card withBorder p="md" radius="md">
      <ScrollArea>
        <Table striped highlightOnHover withColumnBorders miw={760}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Device</Table.Th>
              <Table.Th>Port</Table.Th>
              <Table.Th>Groups</Table.Th>
              <Table.Th>Sensor addresses</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {devices.map(device => {
              const live = status.find(x => x.id === device.id);
              const online = !!(device.enabled && live?.connected);
              return <Table.Tr key={device.id}>
                <Table.Td><Text fw={600} size="sm">{device.name}</Text></Table.Td>
                <Table.Td><Text size="xs">DCCExpressS88Adapter</Text></Table.Td>
                <Table.Td><Text size="sm">{device.serialPort}</Text></Table.Td>
                <Table.Td><Text size="sm">{device.s88Bytes} bytes / {device.sensorCount} inputs</Text></Table.Td>
                <Table.Td><Text size="sm">{device.sensorOffset + 1}–{device.sensorOffset + device.sensorCount}</Text></Table.Td>
                <Table.Td>
                  <Badge size="sm" color={online ? "green" : device.enabled ? "yellow" : "gray"}>
                    {online ? "Connected" : device.enabled ? "Disconnected" : "Disabled"}
                  </Badge>
                  <Text size="xs" c="dimmed">{live?.message ?? "Not started"}</Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={5} wrap="nowrap">
                    <Button size="compact-xs" variant="light" onClick={() => { setMonitorId(device.id); setEditing(false); }}>Monitor</Button>
                    <Button size="compact-xs" variant="light" disabled={!device.enabled || busy} onClick={() => void test(device.id)}>Test</Button>
                    <Button size="compact-xs" variant="light" disabled={busy} onClick={() => { setDraft({ ...device }); setEditing(true); setMessage(""); }}>Edit</Button>
                    <Button size="compact-xs" variant="light" color={device.enabled ? "orange" : "teal"} disabled={busy}
                      onClick={() => void setEnabled(device, !device.enabled)}>{device.enabled ? "Stop" : "Start"}</Button>
                    <Button size="compact-xs" variant="light" color="red" disabled={busy} onClick={() => void remove(device.id)}>Delete</Button>
                  </Group>
                </Table.Td>
              </Table.Tr>;
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Card>}

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
          <NumberInput label="S88 bytes / groups" description={`${draft.s88Bytes * 8} occupancy inputs`} min={1} max={32} step={1} value={draft.s88Bytes}
            onChange={value => setDraft(old => {
              const bytes = typeof value === "number" ? value : 4;
              return { ...old, s88Bytes: bytes, sensorCount: bytes * 8 };
            })} />
        </Group>
        <Switch label="Enabled – connect automatically at backend startup" checked={draft.enabled}
          onChange={event => setDraft(old => ({ ...old, enabled: event.currentTarget.checked }))} />
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
    </Card>}
  </Stack>;
}
