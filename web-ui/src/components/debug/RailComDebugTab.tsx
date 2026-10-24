import { Alert, Badge, Button, Group, Paper, Select, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { getCommandCenterInfo, type CommandCenterInfo } from "@/api/commandCenterInfo";
import { wsClient, type WsConnectionStatus } from "@/services/wsClient";

type RailComPresence = {
  sensorAddress: number;
  locomotiveAddress: number;
  lastSeenAt: number;
  source: string;
  orientationBit: boolean | null;
  orientationSource: "none" | "block" | "loco" | "long";
};
type RailComSenseMode = "off" | "block" | "loco";
type Props = { opened: boolean };

function orientationLabel(entry: RailComPresence): string {
  if (entry.orientationBit === null) return "Unknown";
  if (entry.orientationSource === "long")
    return entry.orientationBit ? "West" : "East";
  if (entry.orientationSource === "block" || entry.orientationSource === "loco")
    return entry.orientationBit ? "Forward sense" : "Reverse sense";
  return "Unknown";
}

function orientationSourceLabel(source: RailComPresence["orientationSource"]): string {
  if (source === "block") return "D0 · block bit";
  if (source === "loco") return "D0 · loco bit";
  if (source === "long") return "E0 · direction bit";
  return "Not transmitted";
}

export default function RailComDebugTab({ opened }: Props) {
  const [entries, setEntries] = useState<RailComPresence[]>([]);
  const [knownSensors, setKnownSensors] = useState<number[]>([]);
  const [wsStatus, setWsStatus] = useState<WsConnectionStatus>("disconnected");
  const [senseMode, setSenseMode] = useState<RailComSenseMode>("block");
  const [savingSense, setSavingSense] = useState(false);
  const [senseMessage, setSenseMessage] = useState("");
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState("");
  const [info, setInfo] = useState<CommandCenterInfo | null>(null);
  const [infoError, setInfoError] = useState("");

  useEffect(() => {
    if (!opened) return;
    let live = true;
    setEntries([]);
    setKnownSensors([]);
    setSnapshotAt(null);
    setRefreshNote("");
    setSenseMessage("");

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
        setKnownSensors(message.data.knownSensors);
        setSenseMode(message.data.senseMode);
        setSnapshotAt(Date.now());
        setRefreshing(false);
        if (message.data.interrogationRequested) {
          setRefreshNote(message.data.interrogationSent
            ? "LocoNet occupancy interrogation sent; a complete RailCom address replay is not guaranteed."
            : "LocoNet interrogation could not be sent. Showing the last reported Hub state.");
        }
      } else if (message.type === "railComStateChanged") {
        setEntries(message.data.entries);
        setKnownSensors(message.data.knownSensors);
        setSnapshotAt(Date.now());
      } else if (message.type === "railComSenseModeChanged") {
        setSenseMode(message.data.mode);
      } else if (message.type === "railComSenseModeResponse") {
        setSavingSense(false);
        setSenseMode(message.data.mode);
        setSenseMessage(message.data.ok
          ? "RailCom mode saved. Previous identifications were invalidated if the mode changed."
          : message.data.message);
        if (message.data.ok) wsClient.send({ type: "getRailComDebug", data: {} });
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
        setKnownSensors([]);
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

  const uniqueBlocks = knownSensors.length;
  const displayedRows = useMemo(() => {
    const activeSensors = new Set(entries.map(entry => entry.sensorAddress));
    const empty: RailComPresence[] = knownSensors
      .filter(sensorAddress => !activeSensors.has(sensorAddress))
      .map(sensorAddress => ({
        sensorAddress,
        locomotiveAddress: 0,
        lastSeenAt: 0,
        source: "",
        orientationBit: null,
        orientationSource: "none",
      }));
    return [...entries, ...empty].sort((a, b) =>
      a.sensorAddress - b.sensorAddress || a.locomotiveAddress - b.locomotiveAddress);
  }, [entries, knownSensors]);
  const canRefresh = wsStatus === "connected" && Boolean(info?.connected) && !refreshing;

  const setDirectionMode = (mode: string | null) => {
    if (mode !== "off" && mode !== "block" && mode !== "loco") return;
    setSavingSense(true);
    setSenseMessage("");
    if (!wsClient.send({ type: "setRailComSenseMode", data: { mode } })) {
      setSavingSense(false);
      setSenseMessage("WebSocket is not connected.");
    }
  };

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
          <Button size="xs" variant="light" loading={refreshing} disabled={!canRefresh}
            onClick={requestRefresh}>
            Refresh
          </Button>
        </Group>
      </Group>

      <Group align="end" wrap="wrap" gap="sm">
        <Select
          label="Standard RailCom sense direction (D0)"
          description="Select the same encoding as the RailCom detector / YD7010."
          data={[
            { value: "off", label: "Off – no D0 direction" },
            { value: "block", label: "In Block Address (+2048)" },
            { value: "loco", label: "In Loco Address (+4096)" },
          ]}
          value={senseMode}
          onChange={setDirectionMode}
          disabled={wsStatus !== "connected" || savingSense}
          w={270}
          size="sm"
        />
        {savingSense && <Text size="xs" c="dimmed">Saving RailCom mode...</Text>}
      </Group>
      {senseMessage && <Text size="xs" c={senseMessage.startsWith("RailCom mode saved") ? "dimmed" : "red"}>{senseMessage}</Text>}
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
            <Table.Th>Block</Table.Th>
            <Table.Th>Loco</Table.Th>
            <Table.Th>State</Table.Th>
            <Table.Th>Orientation</Table.Th>
            <Table.Th>Encoding</Table.Th>
            <Table.Th>Last reported</Table.Th>
            <Table.Th>Source</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {displayedRows.length === 0 ? (
            <Table.Tr><Table.Td colSpan={7}>
              <Text c="dimmed" ta="center" py="lg">
                {snapshotAt
                  ? "No RailCom detectors observed during this session."
                  : "Waiting for RailCom state from the Hub."}
              </Text>
            </Table.Td></Table.Tr>
          ) : displayedRows.map(entry => (
            <Table.Tr key={String(entry.sensorAddress) + ":" + String(entry.locomotiveAddress)}>
              <Table.Td>{entry.sensorAddress}</Table.Td>
              <Table.Td>{entry.locomotiveAddress > 0 ? `#${entry.locomotiveAddress}` : "0"}</Table.Td>
              <Table.Td>{entry.locomotiveAddress > 0
                ? <Badge color="green" variant="light">Identified</Badge>
                : <Badge color="gray" variant="light">No ID</Badge>}</Table.Td>
              <Table.Td>
                <Badge color={entry.orientationBit === null ? "gray" : "blue"} variant="light">
                  {entry.locomotiveAddress > 0 ? orientationLabel(entry) : "—"}
                </Badge>
              </Table.Td>
              <Table.Td><Text size="xs">{entry.locomotiveAddress > 0 ? orientationSourceLabel(entry.orientationSource) : "—"}</Text></Table.Td>
              <Table.Td>{entry.lastSeenAt > 0 ? new Date(entry.lastSeenAt).toLocaleTimeString() : "—"}</Table.Td>
              <Table.Td>{entry.source || "—"}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {refreshNote && <Text size="xs" c="dimmed">{refreshNote}</Text>}
      {infoError && <Text size="xs" c="red">Connection status: {infoError}</Text>}
      <Alert color="blue" variant="light" title="How current presence works">
        Occupied updates one locomotive per RailCom block; Left removes that locomotive.
        Observed detectors remain listed with Loco 0 (no identified loco), which
        does not establish physical FREE. This zero is only a UI placeholder.
        Repeated reports refresh the same row. Power OFF and command-center disconnect
        invalidate all identifiers. Refresh requests current Hub state and sends a standard
        LocoNet detector interrogation, which may not force the module to repeat locomotive
        identities. For D0 frames, Off means orientation is Unknown, even if its
        direction bit would be zero. Long E0 frames carry a separate orientation
        bit independent of this setting. Orientation describes a detector's
        placement polarity, not the locomotive's DCC forward/reverse motion or
        the exit direction; calibrate it against the layout before using it
        for automation. RailCom identification does not override occupancy or
        Dispatcher safety.
      </Alert>
    </Stack>
  );
}
