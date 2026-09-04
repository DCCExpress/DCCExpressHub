import { Badge, Button, Checkbox, Group, Stack, Text } from "@mantine/core";
import { IconPlayerPlay, IconPlayerStop, IconTrash } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ClientWsMessage, TypedServerWsMessage } from "@domain/wsTypes";
import { wsClient, type WsConnectionStatus } from "@/services/wsClient";

type LogCategory = "raw" | "io" | "status" | "other" | "system";
type LogDirection = "RX" | "TX" | "SYS";

type LogEntry = {
  id: number;
  timestamp: string;
  direction: LogDirection;
  category: LogCategory;
  type: string;
  text: string;
};

type LogFilters = Record<Exclude<LogCategory, "system">, boolean>;

const MAX_LOG_ENTRIES = 200;
const FILTER_STORAGE_KEY = "dcc-express-lite.layout.log-filters";

const IO_MESSAGE_TYPES = new Set([
  "setTrackPower", "setProgrammingPower", "emergencyStop", "setLoco",
  "setLocoFunction", "setTurnout", "setSensor", "setBasicAccessory",
  "setVpin", "setBlock", "setBlockRemove", "setBlocksReset",
  "turnoutChanged", "sensorChanged", "accessoryChanged", "vpinChanged",
  "sensorSnapshot",
  "blockStateChanged", "locoState", "powerInfo",
]);

const STATUS_MESSAGE_TYPES = new Set([
  "dccExStatus", "commandCenterInfo", "serverRuntimeStatsChanged",
  "fastClockChanged", "getLoco", "getBlocks", "getLayoutRuntimeSnapshot",
]);

function loadFilters(): LogFilters {
  const defaults: LogFilters = { raw: true, io: true, status: false, other: false };
  try {
    const stored = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!stored) return defaults;
    return { ...defaults, ...(JSON.parse(stored) as Partial<LogFilters>) };
  } catch {
    return defaults;
  }
}

function categoryFor(type: string): LogCategory {
  if (type === "rawInfo" || type === "ack" || type === "writeDccExDirectCommand" || type === "dccExDirectCommandResponse") return "raw";
  if (IO_MESSAGE_TYPES.has(type)) return "io";
  if (STATUS_MESSAGE_TYPES.has(type)) return "status";
  return "other";
}

function stringifyData(data: unknown): string {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data ?? null);
  } catch {
    return String(data);
  }
}

function describeIncoming(message: TypedServerWsMessage): string {
  if (message.type === "rawInfo") return message.data.raw;
  if (message.type === "ack") return message.data;
  if (message.type === "dccExDirectCommandResponse") return message.data.response;
  return stringifyData(message.data);
}

function describeOutgoing(message: ClientWsMessage): string {
  if (message.type === "writeDccExDirectCommand") {
    const data = message.data as { raw?: string } | undefined;
    return data?.raw ?? stringifyData(message.data);
  }
  return stringifyData(message.data);
}

function directionColor(direction: LogDirection): string {
  if (direction === "TX") return "orange";
  if (direction === "RX") return "cyan";
  return "gray";
}

export default function LayoutRuntimeLogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filters, setFilters] = useState<LogFilters>(loadFilters);
  const [enabled, setEnabled] = useState(false);
  const enabledRef = useRef(enabled);
  const nextIdRef = useRef(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const append = useCallback((direction: LogDirection, category: LogCategory, type: string, text: string) => {
    if (!enabledRef.current) return;
    const entry: LogEntry = {
      id: nextIdRef.current++,
      timestamp: new Date().toLocaleTimeString([], { hour12: false }),
      direction,
      category,
      type,
      text,
    };
    setEntries(current => [...current.slice(-(MAX_LOG_ENTRIES - 1)), entry]);
  }, []);

  useEffect(() => {
    const unsubscribeIncoming = wsClient.subscribeMessages(message => {
      append("RX", categoryFor(message.type), message.type, describeIncoming(message));
    });
    const unsubscribeOutgoing = wsClient.subscribeOutgoingMessages(message => {
      append("TX", categoryFor(message.type), message.type, describeOutgoing(message));
    });
    const unsubscribeStatus = wsClient.subscribeStatus((status: WsConnectionStatus) => {
      append("SYS", "system", "websocket", status.toUpperCase());
    });
    return () => {
      unsubscribeIncoming();
      unsubscribeOutgoing();
      unsubscribeStatus();
    };
  }, [append]);

  const visibleEntries = useMemo(
    () => entries.filter(entry => entry.category === "system" || filters[entry.category]),
    [entries, filters],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [visibleEntries]);

  const setFilter = (key: keyof LogFilters, checked: boolean) => {
    setFilters(current => {
      const next = { ...current, [key]: checked };
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  return (
    <Stack h="100%" gap="xs" style={{ minHeight: 0 }}>
      <Group justify="space-between" gap="xs">
        <Text fw={700}>Live command and I/O log</Text>
        <Group gap={5}>
          <Button
            size="compact-xs"
            variant={enabled ? "filled" : "light"}
            color={enabled ? "green" : "gray"}
            leftSection={enabled ? <IconPlayerPlay size={14} /> : <IconPlayerStop size={14} />}
            onClick={() => setEnabled(value => !value)}
          >
            {enabled ? "Enabled" : "Disabled"}
          </Button>
          <Button size="compact-xs" variant="light" color="red" leftSection={<IconTrash size={14} />} onClick={() => setEntries([])}>
            Clear
          </Button>
        </Group>
      </Group>

      <Group gap="sm">
        <Checkbox size="xs" label="Raw DCC-EX" checked={filters.raw} onChange={event => setFilter("raw", event.currentTarget.checked)} />
        <Checkbox size="xs" label="I/O" checked={filters.io} onChange={event => setFilter("io", event.currentTarget.checked)} />
        <Checkbox size="xs" label="Status polling" checked={filters.status} onChange={event => setFilter("status", event.currentTarget.checked)} />
        <Checkbox size="xs" label="Other WS" checked={filters.other} onChange={event => setFilter("other", event.currentTarget.checked)} />
      </Group>

      <Text size="xs" c="dimmed">
        Status polling is hidden by default. The newest {MAX_LOG_ENTRIES} messages are retained in this browser tab.
      </Text>

      <div
        ref={viewportRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: 8,
          border: "1px solid var(--mantine-color-dark-4)",
          borderRadius: 4,
          background: "var(--mantine-color-dark-9)",
          fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
          fontSize: 11,
        }}
      >
        {visibleEntries.map(entry => (
          <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "68px 34px minmax(70px, auto) 1fr", gap: 6, paddingBlock: 2 }}>
            <span style={{ color: "var(--mantine-color-dimmed)" }}>{entry.timestamp}</span>
            <Badge size="xs" variant="light" color={directionColor(entry.direction)}>{entry.direction}</Badge>
            <span style={{ color: "var(--mantine-color-blue-3)" }}>{entry.type}</span>
            <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{entry.text}</span>
          </div>
        ))}
        {visibleEntries.length === 0 && <Text size="xs" c="dimmed">Waiting for matching messages…</Text>}
      </div>
    </Stack>
  );
}
