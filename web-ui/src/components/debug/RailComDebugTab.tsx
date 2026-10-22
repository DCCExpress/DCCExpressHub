import { Alert, Badge, Button, Group, Paper, ScrollArea, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { getCommandCenterInfo, type CommandCenterInfo } from "@/api/commandCenterInfo";
import { wsClient, type WsConnectionStatus } from "@/services/wsClient";

type RailComEvent = {
  sequence: number;
  timestamp: number;
  sensorAddress: number;
  locomotiveAddress: number;
  source: string;
  event: string;
  rawPacket?: string;
};
type RailComRawFrame = {
  sequence: number;
  timestamp: number;
  rawPacket: string;
};
type Props = { opened: boolean };

const validHex = (value: unknown): value is string =>
  typeof value === "string" && /^(?:[0-9a-fA-F]{2}){2,128}$/.test(value);

function mergeRecent<T extends { sequence: number }>(current: T[], incoming: T[]): T[] {
  const bySequence = new Map<number, T>();
  for (const entry of [...current, ...incoming]) bySequence.set(entry.sequence, entry);
  return [...bySequence.values()].sort((a, b) => b.sequence - a.sequence).slice(0, 200);
}

function parseRawFrame(data: unknown): RailComRawFrame | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const item = data as Record<string, unknown>;
  const sequence = Number(item.sequence);
  const timestamp = Number(item.timestamp);
  if (!Number.isSafeInteger(sequence) || sequence < 1 ||
      !Number.isFinite(timestamp) || timestamp <= 0 ||
      !validHex(item.rawPacket)) return null;
  return { sequence, timestamp, rawPacket: item.rawPacket };
}

function parseEvent(data: unknown): RailComEvent | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const item = data as Record<string, unknown>;
  const sequence = Number(item.sequence);
  const timestamp = Number(item.timestamp);
  const sensorAddress = Number(item.sensorAddress);
  const locomotiveAddress = Number(item.locomotiveAddress);
  if (!Number.isSafeInteger(sequence) || sequence < 1 ||
      !Number.isFinite(timestamp) || timestamp <= 0 ||
      !Number.isInteger(sensorAddress) || sensorAddress < 1 || sensorAddress > 65535 ||
      !Number.isInteger(locomotiveAddress) || locomotiveAddress < 1 || locomotiveAddress > 10239) return null;
  return {
    sequence,
    timestamp,
    sensorAddress,
    locomotiveAddress,
    source: typeof item.source === "string" ? item.source : "Unknown",
    event: typeof item.event === "string" ? item.event : "Detected",
    ...(validHex(item.rawPacket) ? { rawPacket: item.rawPacket } : {}),
  };
}

function elapsed(ms?: number) {
  if (ms === undefined || ms < 0) return "Never / unavailable";
  if (ms < 1000) return `${ms} ms ago`;
  return `${Math.round(ms / 1000)} s ago`;
}

export default function RailComDebugTab({ opened }: Props) {
  const [events, setEvents] = useState<RailComEvent[]>([]);
  const [rawFrames, setRawFrames] = useState<RailComRawFrame[]>([]);
  const [wsStatus, setWsStatus] = useState<WsConnectionStatus>("disconnected");
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null);
  const [info, setInfo] = useState<CommandCenterInfo | null>(null);
  const [infoError, setInfoError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);

  useEffect(() => {
    if (!opened) return;
    let live = true;
    const refresh = () => {
      void getCommandCenterInfo(true).then(data => {
        if (!live) return;
        setInfo(data);
        setInfoError("");
        setLastRefresh(Date.now());
      }).catch(error => {
        if (live) setInfoError(String(error));
      });
    };
    refresh();
    const ticker = window.setInterval(refresh, 5000);
    const unsubscribe = wsClient.subscribeMessages(message => {
      if (message.type === "railComDebugSnapshot") {
        setSnapshotAt(Date.now());
        const history = message.data.events.map(parseEvent).filter((event): event is RailComEvent => event !== null);
        const frames = message.data.rawFrames.map(parseRawFrame).filter((frame): frame is RailComRawFrame => frame !== null);
        setEvents(previous => mergeRecent(previous, history));
        setRawFrames(previous => mergeRecent(previous, frames));
      } else if (message.type === "railComDetected") {
        const event = parseEvent(message.data);
        if (event) setEvents(previous => mergeRecent(previous, [event]));
      }
    });
    // subscribeStatus immediately delivers the current state, so opening the
    // dialog retrieves events that arrived before the browser/tab existed.
    const unsubscribeStatus = wsClient.subscribeStatus(status => {
      setWsStatus(status);
      if (status === "connected") wsClient.send({ type: "getRailComDebug", data: {} });
    });
    return () => { live = false; window.clearInterval(ticker); unsubscribe(); unsubscribeStatus(); };
  }, [opened]);

  // This is a recent-event view, not an authoritative train-location cache.
  // In particular, reconnect or a lost packet must not turn an old event into
  // a currently verified RailCom presence.
  const recentLocos = useMemo(() => new Set(events.map(event => event.locomotiveAddress)).size, [events]);
  const recentSensors = useMemo(() => new Set(events.map(event => event.sensorAddress)).size, [events]);
  const last = events[0];
  const ln = info?.locoNetDiagnostics;
  const nativeLocoNet = info?.type === "loconet";
  const knownTransport = info?.type === "z21" && info?.profile === "yamorc7010";
  const transportStatus = !info ? "Unknown" : nativeLocoNet
    ? info.connected ? `Connected (${info.transport ?? "LocoNet"})` : "Disconnected"
    : !knownTransport ? "No LocoNet feedback transport"
    : !ln?.lbServerEnabled ? "LBServer disabled"
    : ln.lbServerConnected ? "Connected" : "Disconnected";
  const transportConnected = nativeLocoNet ? Boolean(info?.connected) : Boolean(ln?.lbServerConnected);
  const card = (label: string, value: string | number, detail?: string) => (
    <Paper withBorder p="sm" key={label}>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700} size="lg">{value}</Text>
      {detail && <Text size="xs" c="dimmed">{detail}</Text>}
    </Paper>
  );

  return (
    <Stack gap="sm" h="100%" style={{ overflow: "hidden" }}>
      <Group justify="space-between" wrap="wrap">
        <Title order={5}>RailCom diagnostics</Title>
        <Group gap="xs">
          <Badge color={wsStatus === "connected" ? "green" : "red"} variant="light">WebSocket: {wsStatus}</Badge>
          <Badge color={transportConnected ? "green" : "gray"} variant="light">
            LocoNet: {transportStatus}
          </Badge>
          <Button size="xs" variant="light" onClick={() => { setEvents([]); setRawFrames([]); }}>
            Clear view
          </Button>
        </Group>
      </Group>
      <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
            {card("RailCom address events", events.length, "Last 200 from Hub history")}
            {card("Raw D0/E0 frames", rawFrames.length, "Last 200 from Hub history")}
            {card("Recent RailCom blocks", recentSensors, `${recentLocos} distinct DCC addresses`)}
            {card("Last RailCom event", last ? new Date(last.timestamp).toLocaleTimeString() : "Never", last ? `#${last.locomotiveAddress} · block ${last.sensorAddress}` : "No identification received")}
          </SimpleGrid>
          <Paper withBorder p="sm">
            <Group justify="space-between" mb="xs">
              <Text fw={700} size="sm">Command station and feedback transport</Text>
              <Badge variant="light" color={infoError ? "red" : "gray"}>{infoError ? "Status unavailable" : lastRefresh ? "Live polling · 5 s" : "Loading"}</Badge>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              <Text size="sm">Command station: <strong>{info?.name ?? "Unknown"}</strong></Text>
              <Text size="sm">Command station link: <strong>{info ? (info.connected ? "Connected" : "Disconnected") : "Unknown"}</strong></Text>
              <Text size="sm">LocoNet feedback: <strong>{transportStatus}</strong></Text>
              {nativeLocoNet ? (
                <>
                  <Text size="sm">Transport: <strong>{info?.transport ?? "LocoNet"}</strong></Text>
                  <Text size="sm">Endpoint: <strong>{info?.serialPort ?? (info?.host ? `${info.host}${info.port ? `:${info.port}` : ""}` : "Unavailable")}</strong></Text>
                  <Text size="sm">LocoNet frames RX: <strong>{info?.locoNetStandardTelemetry?.rxFrames ?? "Unavailable"}</strong></Text>
                  <Text size="sm">Last LocoNet RX: <strong>{elapsed(info?.locoNetStandardTelemetry?.lastRxAgeMs)}</strong></Text>
                  <Text size="sm">Occupancy reports: <strong>{info?.locoNetStandardTelemetry?.sensorReports ?? "Unavailable"}</strong></Text>
                </>
              ) : (
                <>
                  <Text size="sm">LocoNet LBServer: <strong>{transportStatus}</strong></Text>
                  <Text size="sm">Endpoint: <strong>{ln ? `${ln.host}:${ln.lbServerPort}` : "Unavailable"}</strong></Text>
                  <Text size="sm">LBServer version: <strong>{ln?.lbServerVersion || "Unavailable"}</strong></Text>
                  <Text size="sm">Connection uptime: <strong>{ln && ln.lbServerUptimeMs >= 0 ? elapsed(ln.lbServerUptimeMs).replace(" ago", "") : "Unavailable"}</strong></Text>
                  <Text size="sm">LBServer lines received: <strong>{ln?.lbServerLinesObserved ?? "Unavailable"}</strong></Text>
                  <Text size="sm">Last LocoNet RX: <strong>{elapsed(ln?.lastLbServerRxAgeMs)}</strong></Text>
                  <Text size="sm">Occupancy reports: <strong>{ln?.sensorFeedbackCount ?? "Unavailable"}</strong></Text>
                  <Text size="sm">Last occupancy feedback: <strong>{elapsed(ln?.lastSensorFeedbackAgeMs)}</strong></Text>
                  <Text size="sm">Last sensor interrogation: <strong>{elapsed(ln?.lastInterrogateAgeMs)}</strong></Text>
                  <Text size="sm">Binary feedback: <strong>{ln ? (ln.binaryFeedbackEnabled ? "Enabled" : "Disabled") : "Unavailable"}</strong></Text>
                </>
              )}
            </SimpleGrid>
            {infoError && <Text size="xs" c="red" mt="xs">{infoError}</Text>}
          </Paper>
          <Alert color="blue" variant="light" title="RailCom capability and hardware status">
            Address events are decoded from LocoNet MultiSense D0/E0 packets. The RailCom
            block address can be configured separately from the binary occupancy feedback
            address on the detector. No events can indicate missing LocoNet packets or
            decoder configuration. This log shows only decoded address entry/exit reports;
            dynamic RailCom data is excluded. Events do not alter track occupancy or
            Dispatcher safety state.
          </Alert>
          <Text size="xs" c={snapshotAt ? "dimmed" : "orange"}>
            Backend RailCom history: {snapshotAt ? `Received at ${new Date(snapshotAt).toLocaleTimeString()}` : "Waiting for snapshot"}
          </Text>
          <Text fw={700} size="sm">Recent RailCom identification events (last 200)</Text>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Time</Table.Th>
                <Table.Th>RailCom block</Table.Th>
                <Table.Th>DCC address</Table.Th>
                <Table.Th>Event</Table.Th>
                <Table.Th>Source</Table.Th>
                <Table.Th>Raw frame</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {events.length === 0 ? (
                <Table.Tr><Table.Td colSpan={6}>
                  <Text c="dimmed" ta="center" py="lg">
                    No RailCom address reports received in this tab session.
                  </Text>
                </Table.Td></Table.Tr>
              ) : events.map((event, index) => (
                <Table.Tr key={`${event.timestamp}-${event.sensorAddress}-${index}`}>
                  <Table.Td>{new Date(event.timestamp).toLocaleTimeString()}</Table.Td>
                  <Table.Td>{event.sensorAddress}</Table.Td>
                  <Table.Td>{event.locomotiveAddress}</Table.Td>
                  <Table.Td><Badge color={event.event === "Detected" ? "green" : "gray"} variant="light">{event.event === "Detected" ? "Occupied" : event.event === "Lost" ? "Left" : event.event}</Badge></Table.Td>
                  <Table.Td>{event.source}</Table.Td>
                  <Table.Td><Text size="xs" ff="monospace">{event.rawPacket ?? "—"}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Text fw={700} size="sm">Raw LocoNet RailCom frames (last 200)</Text>
          {rawFrames.length > 0 && events.length === 0 && (
            <Alert color="yellow" variant="light" title="RailCom frames received, no addresses decoded">
              D0/E0 traffic reaches the Hub, but no valid address entry/exit reports were decoded.
              Compare the raw frames with the YaMoRC module's identified locomotive and block addresses.
            </Alert>
          )}
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr><Table.Th>Time</Table.Th><Table.Th>Opcode</Table.Th><Table.Th>Raw HEX frame</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rawFrames.length === 0 ? (
                <Table.Tr><Table.Td colSpan={3}><Text c="dimmed" ta="center" py="md">
                  No D0/E0 frames observed by the backend yet. Check the LocoNet transport and trigger a fresh detector event.
                </Text></Table.Td></Table.Tr>
              ) : rawFrames.map(frame => (
                <Table.Tr key={frame.sequence}>
                  <Table.Td>{new Date(frame.timestamp).toLocaleTimeString()}</Table.Td>
                  <Table.Td>{frame.rawPacket.slice(0, 2)}</Table.Td>
                  <Table.Td><Text size="xs" ff="monospace">{frame.rawPacket}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Text size="xs" c="dimmed">Retained only in backend memory (up to 200 of each); restarting the Hub clears it. Clear view only hides entries locally. Previous identifications do not prove current presence.</Text>
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
