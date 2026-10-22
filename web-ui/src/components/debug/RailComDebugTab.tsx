import { Alert, Badge, Button, Group, Paper, ScrollArea, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { getCommandCenterInfo, type CommandCenterInfo } from "@/api/commandCenterInfo";
import { wsClient } from "@/services/wsClient";

type RailComEvent = {
  timestamp: number;
  sensorAddress: number;
  locomotiveAddress: number;
  source: string;
  event: string;
  rawPacket?: string;
};
type Props = { opened: boolean };

function parseEvent(data: unknown): RailComEvent | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const item = data as Record<string, unknown>;
  const sensorAddress = Number(item.sensorAddress);
  const locomotiveAddress = Number(item.locomotiveAddress);
  if (!Number.isInteger(sensorAddress) || sensorAddress < 1 || sensorAddress > 65535 ||
      !Number.isInteger(locomotiveAddress) || locomotiveAddress < 1 || locomotiveAddress > 10239) return null;
  return {
    timestamp: Date.now(),
    sensorAddress,
    locomotiveAddress,
    source: typeof item.source === "string" ? item.source : "Unknown",
    event: typeof item.event === "string" ? item.event : "Detected",
    rawPacket: typeof item.rawPacket === "string" && /^(?:[0-9a-fA-F]{2}){2,128}$/.test(item.rawPacket)
      ? item.rawPacket : undefined,
  };
}

function elapsed(ms?: number) {
  if (ms === undefined || ms < 0) return "Never / unavailable";
  if (ms < 1000) return `${ms} ms ago`;
  return `${Math.round(ms / 1000)} s ago`;
}

export default function RailComDebugTab({ opened }: Props) {
  const [events, setEvents] = useState<RailComEvent[]>([]);
  const [total, setTotal] = useState(0);
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
      const raw = message as unknown as { type?: string; data?: unknown };
      if (raw.type !== "railComDetected") return;
      const event = parseEvent(raw.data);
      if (!event) return;
      setTotal(previous => previous + 1);
      setEvents(previous => [event, ...previous].slice(0, 200));
    });
    return () => { live = false; window.clearInterval(ticker); unsubscribe(); };
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
          <Badge color={transportConnected ? "green" : "gray"} variant="light">
            LocoNet: {transportStatus}
          </Badge>
          <Button size="xs" variant="light" onClick={() => { setEvents([]); setTotal(0); }}>
            Clear events
          </Button>
        </Group>
      </Group>
      <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
            {card("RailCom events received", total, "This tab session only")}
            {card("Recent DCC addresses", recentLocos, "Distinct in retained log")}
            {card("Recent RailCom blocks", recentSensors, "Distinct in retained log")}
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
          <Text size="xs" c="dimmed">Event history is kept in browser memory only and starts when the debug dialog opens. Last-seen identification does not prove current presence.</Text>
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
