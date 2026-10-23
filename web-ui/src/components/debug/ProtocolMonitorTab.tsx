import { Badge, Button, Group, ScrollArea, Select, Stack, Table, Text, TextInput } from "@mantine/core";
import { IconDownload, IconPlayerPause, IconPlayerPlay, IconTrash } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { wsClient } from "../../services/wsClient";

type MonitorEvent = {
  id: number;
  time: string;
  source: string;
  kind: string;
  detail: string;
  raw: string;
};

const MAX_ROWS = 500;

// Read-only observation of already published Hub WebSocket events.
// No command-center polling, protocol writes, or sensor-state mutation.
export default function ProtocolMonitorTab({ opened }: { opened: boolean }) {
  const [rows, setRows] = useState<MonitorEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [kind, setKind] = useState("all");
  const [query, setQuery] = useState("");
  const nextId = useRef(0);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    if (!opened) return;
    const unsubscribe = wsClient.subscribeMessages(message => {
      if (pausedRef.current) return;

      const type = message.type;
      const payload = message.data as unknown as Record<string, unknown>;
      let source = "Hub";
      let kind = "";
      let detail = "";
      let raw = "";

      if (type === "rawInfo") {
        const value = typeof payload.raw === "string" ? payload.raw : "";
        if (!value) return;
        source = /loconet/i.test(value) ? "LocoNet" : "Command center";
        kind = "Raw";
        detail = value;
        raw = value;
      } else if (type === "sensorChanged") {
        source = "Hub sensor";
        kind = "Sensor";
        detail = `Sensor #${payload.address} → ${payload.on === true ? "OCCUPIED" : "FREE"}`;
      } else if (type === "sensorSnapshot") {
        source = "Hub sensor";
        kind = "Snapshot";
        const groups = Array.isArray(payload.groups) ? payload.groups.length : 0;
        detail = `Sensor snapshot: ${groups} groups`;
      } else if (type === "turnoutChanged") {
        kind = "Turnout";
        detail = `Turnout #${payload.address} → ${payload.closed === true ? "CLOSED" : "THROWN"}`;
      } else if (type === "locoState") {
        if (!payload.loco || typeof payload.loco !== "object") return;
        const loco = payload.loco as Record<string, unknown>;
        kind = "Locomotive";
        detail = `Loco #${loco.address} · speed ${loco.speed} · ${loco.direction}`;
      } else if (type === "powerInfo") {
        kind = "Power";
        detail = "Track power state update";
      } else {
        return;
      }

      if (!raw) raw = JSON.stringify(payload);
      const time = new Date().toLocaleTimeString(undefined, { hour12: false, fractionalSecondDigits: 3 });
      const row: MonitorEvent = { id: ++nextId.current, time, source, kind, detail, raw };
      setRows(previous => [row, ...previous].slice(0, MAX_ROWS));
    });
    return unsubscribe;
  }, [opened]);

  const visible = rows.filter(row =>
    (kind === "all" || row.kind === kind) &&
    (!query || `${row.detail} ${row.raw} ${row.source}`.toLowerCase().includes(query.toLowerCase()))
  );

  const exportVisible = () => {
    const blob = new Blob([JSON.stringify([...visible].reverse(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "hub-protocol-monitor.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return <Stack h="100%" gap="xs" style={{ minHeight: 0 }}>
    <Group gap="xs" wrap="wrap">
      <Select w={155} size="xs" aria-label="Message type" value={kind} onChange={value => setKind(value ?? "all")}
        data={[{ value: "all", label: "All events" }, ...["Raw", "Sensor", "Snapshot", "Turnout", "Locomotive", "Power"].map(value => ({ value, label: value }))]} />
      <TextInput size="xs" style={{ flex: 1, minWidth: 120 }} placeholder="Search address, event or HEX…" value={query} onChange={event => setQuery(event.currentTarget.value)} />
      <Button size="xs" variant="light" color="gray" leftSection={paused ? <IconPlayerPlay size={14}/> : <IconPlayerPause size={14}/>}
        onClick={() => setPaused(value => !value)}>{paused ? "Resume" : "Pause"}</Button>
      <Button size="xs" variant="light" color="gray" leftSection={<IconDownload size={14}/>} disabled={!visible.length} onClick={exportVisible}>Export JSON</Button>
      <Button size="xs" variant="light" color="gray" leftSection={<IconTrash size={14}/>}
        onClick={() => setRows([])}>Clear</Button>
    </Group>
    <Group gap="xs">
      <Badge size="sm" color="gray" variant="light">{rows.length} / {MAX_ROWS} events</Badge>
      <Text size="xs" c="dimmed">Read-only · existing WebSocket events · captured while this tab is open</Text>
    </Group>
    <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
      <Table striped highlightOnHover withColumnBorders style={{ tableLayout: "fixed" }}>
        <Table.Thead><Table.Tr>
          <Table.Th w={105}>Time</Table.Th><Table.Th w={115}>Source</Table.Th>
          <Table.Th w={92}>Type</Table.Th><Table.Th>Message / raw payload</Table.Th>
        </Table.Tr></Table.Thead>
        <Table.Tbody>
          {visible.map(row => <Table.Tr key={row.id}>
            <Table.Td><Text size="xs" ff="monospace">{row.time}</Text></Table.Td>
            <Table.Td><Text size="xs">{row.source}</Text></Table.Td>
            <Table.Td><Badge size="xs" variant="light">{row.kind}</Badge></Table.Td>
            <Table.Td>
              <Text size="xs">{row.detail}</Text>
              <Text size="xs" c="dimmed" ff="monospace" style={{ overflowWrap: "anywhere" }}>{row.raw}</Text>
            </Table.Td>
          </Table.Tr>)}
          {!visible.length && <Table.Tr><Table.Td colSpan={4}>
            <Text size="sm" c="dimmed" ta="center">No matching events captured yet.</Text>
          </Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  </Stack>;
}
