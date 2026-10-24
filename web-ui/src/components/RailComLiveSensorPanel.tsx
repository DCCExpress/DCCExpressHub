import { Badge, Button, Group, Table, Text, Tooltip } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import type { ServerWsPayloadMap } from "@domain/wsTypes";
import { wsClient, type WsConnectionStatus } from "@/services/wsClient";

type RailComEntry = ServerWsPayloadMap["railComStateChanged"]["entries"][number];
type LocoDirection = ServerWsPayloadMap["locoState"]["loco"]["direction"];

function expectedExit(entry: RailComEntry, direction?: LocoDirection): "F" | "R" | "?" {
  if (entry.orientationBit === null || !direction) return "?";
  // This is the *expected* track reference direction, not a confirmed exit.
  // 1 = facing forward, 0 = facing reverse (MultiSense placement polarity).
  return entry.orientationBit === (direction === "forward") ? "F" : "R";
}

function senseLabel(entry: RailComEntry): string {
  if (entry.orientationBit === null) return "Unknown";
  const source = entry.orientationSource === "block" ? "B"
    : entry.orientationSource === "loco" ? "L"
      : entry.orientationSource === "long" ? "E" : "?";
  return `${entry.orientationBit ? "F" : "R"}/${source}`;
}

function senseTooltip(entry: RailComEntry): string {
  if (entry.orientationBit === null) return "No direction data (Sense direction Off)";
  const source = entry.orientationSource === "block" ? "D0 block address"
    : entry.orientationSource === "loco" ? "D0 locomotive address"
      : entry.orientationSource === "long" ? "E0 separate direction bit" : "Unknown";
  return `Orientation ${entry.orientationBit ? "F" : "R"} (raw bit ${entry.orientationBit ? 1 : 0}) from ${source}. Not travel direction.`;
}

/** Compact read-only view of the backend-authoritative RailCom presence cache. */
export default function RailComLiveSensorPanel() {
  const [entries, setEntries] = useState<RailComEntry[]>([]);
  const [knownSensors, setKnownSensors] = useState<number[]>([]);
  const [connection, setConnection] = useState<WsConnectionStatus>("disconnected");
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [locoDirections, setLocoDirections] = useState<Record<number, LocoDirection>>({});

  useEffect(() => {
    // Replays the latest Hub direction even when this panel mounts late.
    const stopLocos = wsClient.on("locoState", data => {
      const { address, direction } = data.loco;
      if (!Number.isInteger(address) || address <= 0) return;
      setLocoDirections(current => current[address] === direction
        ? current : { ...current, [address]: direction });
    });
    const stopMessages = wsClient.subscribeMessages(message => {
      if (message.type === "railComStateSnapshot") {
        setEntries(message.data.entries);
        setKnownSensors(message.data.knownSensors);
        setLoaded(true);
        setRefreshing(false);
      } else if (message.type === "railComStateChanged") {
        setEntries(message.data.entries);
        setKnownSensors(message.data.knownSensors);
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
        setKnownSensors([]);
        setLocoDirections({});
        setRefreshing(false);
      }
    });
    return () => {
      stopLocos();
      stopMessages();
      stopStatus();
    };
  }, []);

  // Keep detectors visible when the last locomotive leaves (DCC 0 is a
  // display placeholder only, not an actual DCC address or FREE status).
  const sorted = useMemo(() => {
    const active = entries.filter(entry => entry.locomotiveAddress > 0);
    const occupied = new Set(active.map(entry => entry.sensorAddress));
    const empty: RailComEntry[] = knownSensors
      .filter(sensor => sensor > 0 && !occupied.has(sensor))
      .map(sensorAddress => ({
        sensorAddress,
        locomotiveAddress: 0,
        lastSeenAt: 0,
        source: "",
        orientationBit: null,
        orientationSource: "none",
      }));
    return [...active, ...empty].sort(
      (a, b) => a.sensorAddress - b.sensorAddress ||
        a.locomotiveAddress - b.locomotiveAddress,
    );
  }, [entries, knownSensors]);

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
          <Text size="xs" c="dimmed">{entries.length} loco(s) · {knownSensors.length} sensor(s)</Text>
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
            <Table.Th>Block</Table.Th>
            <Table.Th>Loco</Table.Th>
            <Table.Th>Sense</Table.Th>
            <Table.Th>Dir</Table.Th>
            <Table.Th>Exit</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sorted.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={5}>
                <Text size="xs" c="dimmed" ta="center" py="xs">
                  {!loaded ? "Waiting for RailCom snapshot..." : "No RailCom detectors observed yet"}
                </Text>
              </Table.Td>
            </Table.Tr>
          ) : sorted.map(entry => (
            <Table.Tr key={`${entry.sensorAddress}:${entry.locomotiveAddress}`}>
              <Table.Td>{entry.sensorAddress}</Table.Td>
              <Table.Td>{entry.locomotiveAddress > 0 ? `#${entry.locomotiveAddress}` : "0"}</Table.Td>
              <Table.Td>
                <Tooltip multiline maw={260} label={senseTooltip(entry)}>
                  <span style={{ display: "inline-block" }}><Text size="xs" c={entry.orientationBit === null ? "dimmed" : "blue"}>
                    {entry.locomotiveAddress > 0 ? senseLabel(entry) : "—"}
                  </Text></span>
                </Tooltip>
              </Table.Td>
              <Table.Td>
                <Tooltip label={`Hub DCC direction for #${entry.locomotiveAddress}`}>
                  <span style={{ display: "inline-block" }}><Text size="xs" c="dimmed">
                    {entry.locomotiveAddress === 0 ? "—"
                      : locoDirections[entry.locomotiveAddress] === "forward" ? "F"
                        : locoDirections[entry.locomotiveAddress] === "reverse" ? "R" : "?"}
                  </Text></span>
                </Tooltip>
              </Table.Td>
              <Table.Td>
                <Tooltip multiline maw={280} label="Predicted departure from RailCom orientation + current DCC direction. Not a confirmed block exit; calibrate each detector reference before use in automation.">
                  <span style={{ display: "inline-block" }}><Text size="xs" fw={700}
                    c={expectedExit(entry, locoDirections[entry.locomotiveAddress]) === "?" ? "dimmed" : "teal"}>
                    {entry.locomotiveAddress === 0 ? "—" : expectedExit(entry, locoDirections[entry.locomotiveAddress])}
                  </Text></span>
                </Tooltip>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed">
        Sense: F/R = physical orientation (1 → F, 0 → R); B = block, L = loco, E = long.
        Dir = current DCC command; Exit = predicted departure (not measured). ? = unknown.
        Loco 0 = no identified locomotive on this observed block, not confirmed physical FREE.
        Rows do not replace occupancy feedback.
      </Text>
    </>
  );
}
