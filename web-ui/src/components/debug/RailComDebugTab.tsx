import { Badge, Group, Paper, ScrollArea, Stack, Table, Text, Title } from "@mantine/core";
import { useEffect, useState } from "react";
import { wsClient } from "@/services/wsClient";

type RailComEvent = {
  timestamp: number;
  sensorAddress: number;
  locomotiveAddress: number;
  source: string;
  event: string;
};

function parseRailComEvent(data: unknown): RailComEvent | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const item = data as Record<string, unknown>;
  const sensorAddress = Number(item.sensorAddress);
  const locomotiveAddress = Number(item.locomotiveAddress);
  if (!Number.isInteger(sensorAddress) || sensorAddress <= 0 || sensorAddress > 65535 ||
      !Number.isInteger(locomotiveAddress) || locomotiveAddress <= 0 || locomotiveAddress > 10239) return null;
  return {
    timestamp: Date.now(),
    sensorAddress,
    locomotiveAddress,
    source: typeof item.source === "string" ? item.source : "Unknown",
    event: typeof item.event === "string" ? item.event : "Detected",
  };
}

type Props = { opened: boolean; connected: boolean };

export default function RailComDebugTab({ opened, connected }: Props) {
  const [events, setEvents] = useState<RailComEvent[]>([]);
  useEffect(() => {
    if (!opened) return;
    // The backend will publish normalized railComDetected events after
    // LocoNet MULTI_SENSE / Z21 LAN_LOCONET_DETECTOR support is added.
    return wsClient.subscribeMessages(message => {
      const raw = message as unknown as { type?: string; data?: unknown };
      if (raw.type !== "railComDetected") return;
      const event = parseRailComEvent(raw.data);
      if (event) setEvents(previous => [event, ...previous].slice(0, 200));
    });
  }, [opened]);

  return (
    <Stack gap="md" h="100%" style={{ overflow: "hidden" }}>
      <Group justify="space-between">
        <Title order={5}>RailCom diagnostics</Title>
        <Group gap="xs">
          <Badge color={connected ? "green" : "red"} variant="light">
            {connected ? "WebSocket connected" : "Disconnected"}
          </Badge>
          <Badge variant="light" color="gray">Events: {events.length}</Badge>
        </Group>
      </Group>
      <Paper withBorder p="sm">
        <Text size="sm">
          RailCom identification is separate from occupancy. Sensor addresses
          remain on the Sensors tab. This tab will show detected DCC locomotive
          addresses once backend RailCom decoding and the railComDetected event
          have been implemented.
        </Text>
        <Text c="dimmed" size="xs" mt="xs">
          YD7010: enable Generate RailCom cut-out in Track Out settings.
          For Z21, LAN_LOCONET_DETECTOR forwarding must be verified on the real
          command station. No RailCom data is inferred from occupancy.
        </Text>
      </Paper>
      <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
        <Table striped highlightOnHover stickyHeader>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Time</Table.Th>
              <Table.Th>Sensor</Table.Th>
              <Table.Th>DCC address</Table.Th>
              <Table.Th>Event</Table.Th>
              <Table.Th>Source</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {events.length === 0 ? (
              <Table.Tr><Table.Td colSpan={5}>
                <Text c="dimmed" ta="center" py="lg">
                  No RailCom events received. Protocol decoding is not yet implemented.
                </Text>
              </Table.Td></Table.Tr>
            ) : events.map((event, index) => (
              <Table.Tr key={`${event.timestamp}-${event.sensorAddress}-${index}`}>
                <Table.Td>{new Date(event.timestamp).toLocaleTimeString()}</Table.Td>
                <Table.Td>{event.sensorAddress}</Table.Td>
                <Table.Td>{event.locomotiveAddress}</Table.Td>
                <Table.Td>{event.event}</Table.Td>
                <Table.Td>{event.source}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  );
}
