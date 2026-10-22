import { Badge, Button, Group, Table, Text, Tooltip } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import type { ServerWsPayloadMap } from "@domain/wsTypes";
import { wsClient, type WsConnectionStatus } from "@/services/wsClient";

type RailComEntry = ServerWsPayloadMap["railComStateChanged"]["entries"][number];

function senseLabel(entry: RailComEntry): string {
  if (entry.orientationBit === null) return "?";
  // D0 stores rerailing orientation (F/R) in either the block or loco address.
  if (entry.orientationSource === "block" || entry.orientationSource === "loco")
    return entry.orientationBit ? "F" : "R";
  // E0 explicitly describes the detector-relative direction as East/West.
  if (entry.orientationSource === "long")
    return entry.orientationBit ? "W" : "E";
  return "?";
}

function senseTooltip(entry: RailComEntry): string {
  if (entry.orientationBit === null) return "RailCom orientation unknown (no direction transmitted).";
  const source = entry.orientationSource === "block" ? "D0 block address"
    : entry.orientationSource === "loco" ? "D0 locomotive address"
      : entry.orientationSource === "long" ? "E0 separate direction bit" : "Unknown";
  const direction = senseLabel(entry);
  return `RailCom physical orientation: ${direction} (bit ${entry.orientationBit ? 1 : 0}; ${source}). Not the DCC forward/reverse command or the direction of travel.`;
}

/** Compact read-only view of the backend-authoritative RailCom presence cache. */
export default function RailComLiveSensorPanel() {
  const [entries, setEntries] = useState<RailComEntry[]>([]);
  const [connection, setConnection] = useState<WsConnectionStatus>("disconnected");
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const stopMessages = wsClient.subscribeMessages(message => {
      if (message.type === "railComStateSnapshot") {
        setEntries(message.data.entries);
        setLoaded(true);
        setRefreshing(false);
      } else if (message.type === "railComStateChanged") {
        setEntries(message.data.entries);
        setLoaded(true);
      }
    });
    // This callback also runs immediately with the current connection state.
    const stopStatus = wsClient.subscribeStatus(status => {
      setConnection(status);
      if (status === "connected") {
        wsClient.send({ type: "getRailComDebug", data: {} });
      } else {
        // A disconnected transport cannot confirm old locomotive positions.
        setLoaded(false);
        setEntries([]);
        setRefreshing(false);
      }
    });
    return () => {
      stopMessages();
      stopStatus();
    };
  }, []);

  const sorted = useMemo(() => [...entries].sort(
    (a, b) => a.sensorAddress - b.sensorAddress ||
      a.locomotiveAddress - b.locomotiveAddress,
  ), [entries]);

  const refresh = () => {
    setRefreshing(true);
    // Read Hub runtime state. Do NOT interrogate hardware on every panel open.
    if (!wsClient.send({ type: "getRailComDebug", data: {} }))
      setRefreshing(false);
  };

  return (
    <>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Badge size="xs" variant="light" color={connection === "connected" ? "green" : "gray"}>
          {connection === "connected" ? "Online" : "Offline"}
        </Badge>
        <Group gap="xs" wrap="nowrap">
          <Text size="xs" c="dimmed">{sorted.length} loco(s)</Text>
          <Button size="compact-xs" variant="light" leftSection={<IconRefresh size={13} />}
            onClick={refresh} loading={refreshing} disabled={connection !== "connected"}>
            Refresh
          </Button>
        </Group>
      </Group>
      <Table striped highlightOnHover horizontalSpacing={5} verticalSpacing={4}
        style={{ fontSize: 11, tableLayout: "fixed" }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>RC sensor</Table.Th>
            <Table.Th>DCC</Table.Th>
            <Table.Th>State</Table.Th>
            <Table.Th>Orient.</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sorted.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={4}>
                <Text size="xs" c="dimmed" ta="center" py="xs">
                  {!loaded ? "Waiting for RailCom snapshot..." : "No locomotives identified"}
                </Text>
              </Table.Td>
            </Table.Tr>
          ) : sorted.map(entry => (
            <Table.Tr key={`${entry.sensorAddress}:${entry.locomotiveAddress}`}>
              <Table.Td>{entry.sensorAddress}</Table.Td>
              <Table.Td>#{entry.locomotiveAddress}</Table.Td>
              <Table.Td>
                <Tooltip label={`Last RailCom report: ${new Date(entry.lastSeenAt).toLocaleTimeString()}`}>
                  <Badge size="xs" variant="light" color="green">Present</Badge>
                </Tooltip>
              </Table.Td>
              <Table.Td>
                <Tooltip multiline maw={260} label={senseTooltip(entry)}>
                  <Text size="xs" c={entry.orientationBit === null ? "dimmed" : "blue"}>
                    {senseLabel(entry)}
                  </Text>
                </Tooltip>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed">
        Orient.: F/R = RailCom placement orientation (D0), E/W = detector-relative direction (E0),
        ? = Unknown. This is not the DCC driving direction. RailCom does not replace occupancy feedback.
      </Text>
    </>
  );
}
