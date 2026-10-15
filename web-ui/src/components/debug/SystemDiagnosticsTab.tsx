import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Card, Group, ScrollArea, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconCpu, IconPlugConnected, IconActivityHeartbeat, IconRefresh } from "@tabler/icons-react";
import SemiCircleGauge from "@/components/common/SemiCircleGauge";
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
  const [cpuPercent, setCpuPercent] = useState<number | null>(null);
  const previousCpu = useRef<{ cpu: number; at: number } | null>(null);

  useEffect(() => {
    if (!opened) return;
    let live = true;
    const refresh = () => {
      void getCommandCenterInfo(true).then(data => {
        if (live) {
          const host = data.hostDiagnostics;
          if (host) {
            const previous = previousCpu.current;
            if (previous && host.sampledAtMs > previous.at) {
              const percent = (host.cpuTimeMs - previous.cpu) / (host.sampledAtMs - previous.at) / Math.max(1, host.processorCount) * 100;
              setCpuPercent(Math.max(0, Math.min(100, percent)));
            }
            previousCpu.current = { cpu: host.cpuTimeMs, at: host.sampledAtMs };
          }
          setInfo(data);
          setError("");
        }
      }).catch(reason => {
        if (live) setError(String(reason));
      });
    };
    previousCpu.current = null;
    setCpuPercent(null);
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
      setTraffic({ incoming: c.incoming, outgoing: c.outgoing, sensor: c.sensor, peakIncoming: c.peak, lastMessage: c.last, messageTypes: [...c.types.entries()].map(([type, count]) => ({ type, count })) });
      c.incoming = 0;
      c.outgoing = 0;
      c.sensor = 0;
      // Preserve the discovered message types and their insertion order.
      // Reset only the per-second values, so idle types remain visible as 0.
      c.types.forEach((_count, type) => c.types.set(type, 0));
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
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
          <Card withBorder padding={0} style={{ overflow: "hidden" }}>
            <Group gap="xs" px="md" py={10} bg="var(--mantine-color-blue-light)" style={{ borderBottom: "2px solid var(--mantine-color-blue-6)" }}><IconCpu size={17} color="var(--mantine-color-blue-7)" /><Text fw={700} c="var(--mantine-color-blue-light-color)">PC · Host</Text></Group>
            <Stack p="md" gap="xs">
            {info?.hostDiagnostics ? (
              <Stack gap={5}>
                <Text size="sm">Machine: {info.hostDiagnostics.machine}</Text>
                <Text size="xs" c="dimmed" lineClamp={2}>{info.hostDiagnostics.os}</Text>
                <Text size="sm">CPU: <Badge color="blue" variant="light">{cpuPercent === null ? "Measuring…" : cpuPercent.toFixed(1) + "%"}</Badge> ({info.hostDiagnostics.processorCount} cores)</Text>
                <Text size="sm">Process RAM: <Badge color="blue" variant="light">{(info.hostDiagnostics.workingSetBytes / 1048576).toFixed(1)} MB</Badge></Text>
                <Text size="sm">Managed heap: <Badge color="gray" variant="light">{(info.hostDiagnostics.managedHeapBytes / 1048576).toFixed(1)} MB</Badge></Text>
                <Text size="sm">System uptime: <Badge color="indigo" variant="light">{Math.floor(info.hostDiagnostics.uptimeSeconds / 3600)}h {Math.floor(info.hostDiagnostics.uptimeSeconds % 3600 / 60)}m</Badge></Text>
                <Text size="xs" c="dimmed">CPU and RAM measure the Hub process</Text>
              </Stack>
            ) : <Text size="sm" c="dimmed">Host diagnostics unavailable</Text>}
            </Stack>
          </Card>
          <Card withBorder padding={0} style={{ overflow: "hidden" }}>
            <Group gap="xs" px="md" py={10} bg="var(--mantine-color-teal-light)" style={{ borderBottom: "2px solid var(--mantine-color-teal-6)" }}><IconPlugConnected size={17} color="var(--mantine-color-teal-7)" /><Text fw={700} c="var(--mantine-color-teal-light-color)">{info?.type === "loconet" ? "LocoNet " + (info?.transport?.toLowerCase() === "tcp" ? "TCP" : "Serial") : info?.name ?? "Command center"}</Text></Group>
            <Stack p="md" gap="xs">
            <Badge color={info?.connected ? "green" : "red"}>{info?.connected ? "CONNECTED" : "DISCONNECTED"}</Badge>
            <Stack gap={5} mt="xs">
              <Text size="sm">Protocol: {info?.type ?? "—"} · {info?.transport ?? "—"}</Text>
              <Text size="sm">Endpoint: {info?.host ? info.host + (info.port ? ":" + info.port : "") : info?.serialPort || "—"}</Text>
              {info?.locoNetStandardTelemetry && (
                <>
                  <Text size="sm">RX / TX: <Badge color="teal" variant="light">{info.locoNetStandardTelemetry.rxFrames}</Badge> / <Badge color="cyan" variant="light">{info.locoNetStandardTelemetry.txFrames}</Badge> frames</Text>
                  <Text size="sm">Sensors: <Badge color="teal" variant="light">{info.locoNetStandardTelemetry.sensorReports}</Badge> · Turnouts: <Badge color="cyan" variant="light">{info.locoNetStandardTelemetry.turnoutReports}</Badge></Text>
                  <Text size="sm">Power reports: <Badge color="orange" variant="light">{info.locoNetStandardTelemetry.powerReports}</Badge></Text>
                  <Text size="sm">Last RX: <Badge color="gray" variant="light">{info.locoNetStandardTelemetry.lastRxAgeMs >= 0 ? info.locoNetStandardTelemetry.lastRxAgeMs + " ms ago" : "—"}</Badge></Text>
                </>
              )}
              {info?.locoNetDiagnostics && (
                <>
                  <Text size="sm">LB server: {info.locoNetDiagnostics.lbServerConnected ? "Connected" : "Disconnected"}</Text>
                  <Text size="sm">LB lines: {info.locoNetDiagnostics.lbServerLinesObserved}</Text>
                  <Text size="sm">Sensor feedback: {info.locoNetDiagnostics.sensorFeedbackCount}</Text>
                </>
              )}
              {info?.feedbackLinkName && <Text size="sm">Feedback: {info.feedbackLinkName}</Text>}
            </Stack>
            </Stack>
          </Card>
          <Card withBorder padding={0} style={{ overflow: "hidden" }}>
            <Group gap="xs" px="md" py={10} bg="var(--mantine-color-violet-light)" style={{ borderBottom: "2px solid var(--mantine-color-violet-6)" }}><IconActivityHeartbeat size={17} color="var(--mantine-color-violet-7)" /><Text fw={700} c="var(--mantine-color-violet-light-color)">WebSocket</Text></Group>
            <Stack p="md" gap="xs">
            <Group align="flex-start" justify="space-between" gap="xs" wrap="nowrap">
              <Stack gap="xs" style={{ minWidth: 0, flex: 1 }}>
                <Badge style={{ alignSelf: "flex-start" }} color={status === "connected" ? "green" : status === "connecting" || status === "reconnecting" ? "yellow" : "red"}>{status.toUpperCase()}</Badge>
                <Text size="sm">Received: <Badge color="violet" variant="light">{traffic.incoming} msg/s</Badge></Text>
              </Stack>
              <SemiCircleGauge compact width={80} value={traffic.incoming} max={traffic.peakIncoming} label="Current received" maxLabel="Session peak" unit="msg/s" />
            </Group>
            <Text size="sm">Sent: <Badge color="violet" variant="light">{traffic.outgoing} msg/s</Badge></Text>
            <Text size="sm">Sensor messages: <Badge color="cyan" variant="light">{traffic.sensor} msg/s</Badge></Text>
            <Text size="sm">Peak received (this session): <Badge color="grape" variant="light">{traffic.peakIncoming} msg/s</Badge></Text>
            <Text size="sm">Last message type: {traffic.lastMessage}</Text>
            </Stack>
          </Card>
        </SimpleGrid>
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
