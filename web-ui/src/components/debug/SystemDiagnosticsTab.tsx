import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Card, Group, ScrollArea, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { getCommandCenterInfo, type CommandCenterInfo } from "@/api/commandCenterInfo";
import { wsClient, type WsConnectionStatus } from "@/services/wsClient";

type Traffic = { incoming: number; outgoing: number; sensor: number; peakIncoming: number; lastMessage: string; messageTypes: Array<{ type: string; count: number }> };

export default function SystemDiagnosticsTab({ opened }: { opened: boolean }) {
  const [info, setInfo] = useState<CommandCenterInfo | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<WsConnectionStatus>(wsClient.getStatus());
  const [traffic, setTraffic] = useState<Traffic>({ incoming: 0, outgoing: 0, sensor: 0, peakIncoming: 0, lastMessage: "—", messageTypes: [] });
  const counters = useRef({ incoming: 0, outgoing: 0, sensor: 0, peak: 0, last: "—", types: new Map<string, number>() });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!opened) return;
    let live = true;
    const refresh = () => {
      void getCommandCenterInfo(true).then(data => {
        if (live) { setInfo(data); setError(""); }
      }).catch(reason => {
        if (live) setError(String(reason));
      });
    };
    counters.current = { incoming: 0, outgoing: 0, sensor: 0, peak: 0, last: "—", types: new Map<string, number>() };
    setTraffic({ incoming: 0, outgoing: 0, sensor: 0, peakIncoming: 0, lastMessage: "—", messageTypes: [] });
    refresh();
    const offStatus = wsClient.subscribeStatus(setStatus);
    const offIn = wsClient.subscribeMessages(message => {
      counters.current.incoming++;
      counters.current.types.set(message.type, (counters.current.types.get(message.type) ?? 0) + 1);
      counters.current.last = message.type;
      if (message.type === "sensorChanged" || message.type === "sensorSnapshot") counters.current.sensor++;
    });
    const offOut = wsClient.subscribeOutgoingMessages(() => { counters.current.outgoing++; });
    const ticker = window.setInterval(() => {
      const c = counters.current;
      c.peak = Math.max(c.peak, c.incoming);
      setTraffic({ incoming: c.incoming, outgoing: c.outgoing, sensor: c.sensor, peakIncoming: c.peak, lastMessage: c.last, messageTypes: [...c.types.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count) });
      c.incoming = 0;
      c.outgoing = 0;
      c.sensor = 0;
      c.types.clear();
    }, 1000);
    const polling = window.setInterval(refresh, 5000);
    return () => { live = false; offStatus(); offIn(); offOut(); window.clearInterval(ticker); window.clearInterval(polling); };
  }, [opened, refreshKey]);

  return (
    <ScrollArea h="100%">
      <Stack gap="md" pb="sm">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">Live communication overview · updates every second</Text>
          <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} onClick={() => setRefreshKey(v => v + 1)}>Refresh</Button>
        </Group>
        {error && <Alert color="red">{error}</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Card withBorder>
            <Text fw={600}>Command center</Text>
            <Group gap="xs" mt="xs"><Badge color={info?.connected ? "green" : "red"}>{info?.connected ? "CONNECTED" : "DISCONNECTED"}</Badge><Text size="sm">{info?.name ?? "Loading…"}</Text></Group>
            <Text size="sm" mt="xs">Protocol: {info?.type ?? "—"}</Text>
            <Text size="sm">Transport: {info?.transport ?? "—"}</Text>
            <Text size="sm">Endpoint: {info?.host ? info.host + (info.port ? ":" + info.port : "") : "—"}</Text>
            {info?.feedbackLinkName && <Text size="sm">Feedback: {info.feedbackLinkName}{info.feedbackHost ? " · " + info.feedbackHost : ""}</Text>}
          </Card>
          <Card withBorder>
            <Text fw={600}>WebSocket</Text>
            <Group gap="xs" mt="xs"><Badge color={status === "connected" ? "green" : status === "connecting" || status === "reconnecting" ? "yellow" : "red"}>{status.toUpperCase()}</Badge></Group>
            <Text size="sm" mt="xs">Received: {traffic.incoming} msg/s</Text>
            <Text size="sm">Sent: {traffic.outgoing} msg/s</Text>
            <Text size="sm">Sensor messages: {traffic.sensor} msg/s</Text>
            <Text size="sm">Peak received (this session): {traffic.peakIncoming} msg/s</Text>
            <Text size="sm">Last message type: {traffic.lastMessage}</Text>
          </Card>
        </SimpleGrid>
        {info?.locoNetDiagnostics && (
          <Card withBorder>
            <Group justify="space-between" mb="xs">
              <Text fw={600}>LocoNet TCP</Text>
              <Badge color={info.locoNetDiagnostics.lbServerConnected ? "green" : "red"}>
                {info.locoNetDiagnostics.lbServerConnected ? "CONNECTED" : "DISCONNECTED"}
              </Badge>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              <Text size="sm">Endpoint: {info.locoNetDiagnostics.host}:{info.locoNetDiagnostics.lbServerPort}</Text>
              <Text size="sm">LB server: {info.locoNetDiagnostics.lbServerEnabled ? "Enabled" : "Disabled"}</Text>
              <Text size="sm">LB version: {info.locoNetDiagnostics.lbServerVersion || "—"}</Text>
              <Text size="sm">Connected for: {info.locoNetDiagnostics.lbServerUptimeMs >= 0 ? Math.floor(info.locoNetDiagnostics.lbServerUptimeMs / 1000) + " s" : "—"}</Text>
              <Text size="sm">Last TCP RX: {info.locoNetDiagnostics.lastLbServerRxAgeMs >= 0 ? info.locoNetDiagnostics.lastLbServerRxAgeMs + " ms ago" : "No data"}</Text>
              <Text size="sm">TCP lines observed: {info.locoNetDiagnostics.lbServerLinesObserved}</Text>
              <Text size="sm">Sensor reports: {info.locoNetDiagnostics.sensorFeedbackCount}</Text>
              <Text size="sm">Last sensor: {info.locoNetDiagnostics.lastSensorAddress > 0 ? "#" + info.locoNetDiagnostics.lastSensorAddress + " = " + (info.locoNetDiagnostics.lastSensorOn === null ? "Unknown" : info.locoNetDiagnostics.lastSensorOn ? "ON" : "OFF") : "—"}</Text>
              <Text size="sm">Last sensor RX: {info.locoNetDiagnostics.lastSensorFeedbackAgeMs >= 0 ? info.locoNetDiagnostics.lastSensorFeedbackAgeMs + " ms ago" : "No data"}</Text>
              <Text size="sm">Binary feedback: {info.locoNetDiagnostics.binaryFeedbackEnabled ? "Enabled (port " + info.locoNetDiagnostics.binaryPort + ")" : "Disabled"}</Text>
              <Text size="sm">Interrogate: {info.locoNetDiagnostics.interrogateEnabled ? "Enabled" : "Disabled"}</Text>
              <Text size="sm">Last interrogate: {info.locoNetDiagnostics.lastInterrogateAgeMs >= 0 ? Math.floor(info.locoNetDiagnostics.lastInterrogateAgeMs / 1000) + " s ago" : "—"}</Text>
            </SimpleGrid>
            <Text size="xs" c="dimmed" mt="xs">Live backend totals refresh every 5 seconds. TCP lines and sensor reports are cumulative counters, not msg/s.</Text>
          </Card>
        )}
        <Card withBorder>
          <Text fw={600} mb="xs">Message types (live, msg/s)</Text>
          {traffic.messageTypes.length === 0
            ? <Text size="sm" c="dimmed">No messages in the last second</Text>
            : traffic.messageTypes.map(item => (
              <Group key={item.type} justify="space-between" gap="xs" py={3}>
                <Text size="sm" ff="monospace">{item.type}</Text>
                <Text size="sm" fw={600} style={{ fontVariantNumeric: "tabular-nums" }}>{item.count}</Text>
              </Group>
            ))}
        </Card>
        <Text size="xs" c="dimmed">Message rates are measured in this browser while the diagnostics tab is open. Sensor messages include snapshots; they are not individual occupancy transitions. Protocol-specific R-BUS/LocoNet packet counters and backend queue statistics are not available in this view.</Text>
      </Stack>
    </ScrollArea>
  );
}
