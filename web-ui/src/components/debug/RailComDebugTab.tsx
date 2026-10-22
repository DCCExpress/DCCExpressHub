import { Alert, Badge, Button, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { getCommandCenterInfo, type CommandCenterInfo } from "@/api/commandCenterInfo";
import { wsClient, type WsConnectionStatus } from "@/services/wsClient";

type RailComPresence = {
  sensorAddress: number;
  locomotiveAddress: number;
  lastSeenAt: number;
  source: string;
};
type Props = { opened: boolean };

export default function RailComDebugTab({ opened }: Props) {
  const [entries, setEntries] = useState<RailComPresence[]>([]);
  const [wsStatus, setWsStatus] = useState<WsConnectionStatus>("disconnected");
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState("");
  const [info, setInfo] = useState<CommandCenterInfo | null>(null);
  const [infoError, setInfoError] = useState("");

  useEffect(() => {
    if (!opened) return;
    let live = true;
    setEntries([]);
    setSnapshotAt(null);
    setRefreshNote("");

    const updateConnection = () => {
      void getCommandCenterInfo(true).then(data => {
        if (!live) return;
        setInfo(data);
        setInfoError("");
      }).catch(error => {
        if (live) setInfoError(String(error));
      });
    };
    updateConnection();
    const ticker = window.setInterval(updateConnection, 5000);
    const unsubscribe = wsClient.subscribeMessages(message => {
      if (!live) return;
      if (message.type === "railComStateSnapshot") {
        setEntries(message.data.entries);
        setSnapshotAt(Date.now());
        setRefreshing(false);
        if (message.data.interrogationRequested) {
          setRefreshNote(message.data.interrogationSent
            ? "LocoNet occupancy interrogation sent; a complete RailCom address replay is not guaranteed."
            : "LocoNet interrogation could not be sent. Showing the last reported Hub state.");
        }
      } else if (message.type === "railComStateChanged") {
        setEntries(message.data.entries);
        setSnapshotAt(Date.now());
      }
    });
    // Subscribe before requesting the initial state: a locomotive can already
    // be standing on the track when this tab opens.
    const unsubscribeStatus = wsClient.subscribeStatus(status => {
      if (!live) return;
      setWsStatus(status);
      if (status === "connected") {
        wsClient.send({ type: "getRailComDebug", data: {} });
      } else {
        setEntries([]);
        setSnapshotAt(null);
        setRefreshing(false);
      }
    });
    return () => {
      live = false;
      window.clearInterval(ticker);
      unsubscribe();
      unsubscribeStatus();
    };
  }, [opened]);

  const uniqueBlocks = useMemo(
    () => new Set(entries.map(entry => entry.sensorAddress)).size,
    [entries]
  );
  const nativeLocoNet = info?.type === "loconet";
  const ln = info?.locoNetDiagnostics;
  const knownYamorc = info?.type === "z21" && info?.profile === "yamorc7010";
  const transportConnected = nativeLocoNet
    ? Boolean(info?.connected)
    : Boolean(knownYamorc && ln?.lbServerConnected);
  const transportName = nativeLocoNet
    ? "LocoNet " + (info?.transport ?? "")
    : knownYamorc ? "YD7010 LBServer" : "No LocoNet feedback";
  const canRefresh = wsStatus === "connected" && Boolean(info?.connected) && !refreshing;

  const requestRefresh = () => {
    setRefreshing(true);
    setRefreshNote("");
    if (!wsClient.send({ type: "getRailComDebug", data: { interrogate: true } })) {
      setRefreshing(false);
      setRefreshNote("WebSocket is not connected.");
    }
  };

  return (
    <Stack gap="sm" h="100%" style={{ overflowY: "auto" }}>
      <Group justify="space-between" wrap="wrap">
        <Title order={5}>RailCom current presence</Title>
        <Group gap="xs">
          <Badge color={wsStatus === "connected" ? "green" : "red"} variant="light">
            WebSocket: {wsStatus}
          </Badge>
          <Badge color={transportConnected ? "green" : "gray"} variant="light">
            {transportName}: {transportConnected ? "Connected" : "Disconnected"}
          </Badge>
          <Button size="xs" variant="light" loading={refreshing} disabled={!canRefresh}
            onClick={requestRefresh}>
            Refresh
          </Button>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
        <Paper withBorder p="sm">
          <Text size="xs" c="dimmed">Identified locomotives</Text>
          <Text fw={700} size="lg">{entries.length}</Text>
        </Paper>
        <Paper withBorder p="sm">
          <Text size="xs" c="dimmed">RailCom blocks</Text>
          <Text fw={700} size="lg">{uniqueBlocks}</Text>
        </Paper>
        <Paper withBorder p="sm">
          <Text size="xs" c="dimmed">Hub snapshot</Text>
          <Text fw={700} size="sm">
            {snapshotAt ? new Date(snapshotAt).toLocaleTimeString() : "Waiting for data"}
          </Text>
        </Paper>
      </SimpleGrid>

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>RailCom block</Table.Th>
            <Table.Th>DCC address</Table.Th>
            <Table.Th>State</Table.Th>
            <Table.Th>Last reported</Table.Th>
            <Table.Th>Source</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {entries.length === 0 ? (
            <Table.Tr><Table.Td colSpan={5}>
              <Text c="dimmed" ta="center" py="lg">
                {snapshotAt
                  ? "No locomotive addresses currently reported as present."
                  : "Waiting for RailCom state from the Hub."}
              </Text>
            </Table.Td></Table.Tr>
          ) : entries.map(entry => (
            <Table.Tr key={String(entry.sensorAddress) + ":" + String(entry.locomotiveAddress)}>
              <Table.Td>{entry.sensorAddress}</Table.Td>
              <Table.Td>#{entry.locomotiveAddress}</Table.Td>
              <Table.Td><Badge color="green" variant="light">Occupied</Badge></Table.Td>
              <Table.Td>{new Date(entry.lastSeenAt).toLocaleTimeString()}</Table.Td>
              <Table.Td>{entry.source}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {refreshNote && <Text size="xs" c="dimmed">{refreshNote}</Text>}
      {infoError && <Text size="xs" c="red">Connection status: {infoError}</Text>}
      <Alert color="blue" variant="light" title="How current presence works">
        Occupied updates one locomotive per RailCom block; Left removes that locomotive.
        Repeated reports refresh the same row. Power OFF and command-center disconnect
        invalidate all identifiers. Refresh requests current Hub state and sends a standard
        LocoNet detector interrogation, which may not force the module to repeat locomotive
        identities. RailCom identification is informational and does not override occupancy
        or Dispatcher safety.
      </Alert>
    </Stack>
  );
}
