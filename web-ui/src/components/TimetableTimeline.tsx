import { Alert, Badge, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { useMemo } from "react";
import type { TimetableEntryDefinition } from "@/services/automationApi";

type Target = { id: string; name: string };
type Props = {
  entries: TimetableEntryDefinition[];
  movements: Target[];
  scripts: Target[];
};
type Event = { id: string; minute: number; targetKey: string; targetName: string; color: string };
const WIDTH = 1200;
const LEFT = 164;
const RIGHT = 32;
const TOP = 46;
const ROW = 43;
const DAY = 24 * 60;
const COLORS = ["#22c55e", "#38bdf8", "#f59e0b", "#c084fc", "#fb7185", "#2dd4bf", "#a3e635"];
const timeLabel = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** Visualizes real timetable firing times; never invents travel durations. */
export default function TimetableTimeline({ entries, movements, scripts }: Props) {
  const { lanes, events, unsupported } = useMemo(() => {
    const targets = new Map<string, { name: string; type: string }>();
    movements.forEach(item => targets.set(`movement:${item.id}`, { name: item.name, type: "Movement" }));
    scripts.forEach(item => targets.set(`script:${item.id}`, { name: item.name, type: "Script" }));
    const items: Event[] = [];
    let unsupportedCount = 0;
    const activeKeys = new Set<string>();
    for (const entry of entries) {
      if (!entry.enabled) continue;
      const match = entry.cron.trim().match(/^(\d{1,2})\s+(\d{1,2})$/);
      if (!match || Number(match[1]) > 59 || Number(match[2]) > 23) {
        unsupportedCount++;
        continue;
      }
      const minute = Number(match[2]) * 60 + Number(match[1]);
      for (const action of entry.actions) {
        const key = `${action.targetType}:${action.targetId}`;
        const target = targets.get(key);
        if (!target) continue;
        activeKeys.add(key);
        items.push({
          id: `${entry.id}:${action.id}`,
          minute,
          targetKey: key,
          targetName: target.name,
          color: "",
        });
      }
    }
    const visibleLanes = [...activeKeys].sort((a, b) => a.localeCompare(b));
    const colored = items.map(event => ({
      ...event,
      color: COLORS[visibleLanes.indexOf(event.targetKey) % COLORS.length]!,
    }));
    return { lanes: visibleLanes.map(key => ({ key, ...targets.get(key)! })), events: colored, unsupported: unsupportedCount };
  }, [entries, movements, scripts]);

  const height = TOP + Math.max(lanes.length, 1) * ROW + 28;
  const xAt = (minute: number) => LEFT + minute / DAY * (WIDTH - LEFT - RIGHT);
  const overlapCounts = new Map<number, number>();
  for (const event of events) overlapCounts.set(event.minute, (overlapCounts.get(event.minute) ?? 0) + 1);
  const overlaps = [...overlapCounts.entries()].filter(([, count]) => count > 1).length;

  return (
    <Stack gap="sm" style={{ minHeight: 0, flex: 1 }}>
      <Group gap="xs" wrap="wrap">
        <Badge variant="light" color="blue">24-hour departure timeline</Badge>
        <Badge variant="light" color="gray">{events.length} scheduled actions</Badge>
        {overlaps > 0 && <Badge variant="light" color="yellow">{overlaps} simultaneous start times</Badge>}
      </Group>
      <Text size="xs" c="dimmed">Each dot marks a scheduled Movement or Script start. Lines indicate a timeline, not train travel or track occupancy.</Text>
      {unsupported > 0 && (
        <Alert color="blue" variant="light" p="xs">
          {unsupported} enabled recurring/advanced cron entries are excluded from this daily fixed-time view.
        </Alert>
      )}
      <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
        <svg width="100%" viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="Timetable daily departure timeline" style={{ minWidth: 740, display: "block" }}>
          {Array.from({ length: 13 }, (_, index) => index * 120).map(minute => (
            <g key={minute}>
              <line x1={xAt(minute)} y1={TOP - 13} x2={xAt(minute)} y2={height - 24} stroke="currentColor" opacity={0.15} strokeDasharray="3 5"/>
              <text x={xAt(minute)} y={20} textAnchor="middle" fill="currentColor" fontSize={13} opacity={0.75}>{timeLabel(minute)}</text>
            </g>
          ))}
          {lanes.map((lane, index) => {
            const y = TOP + index * ROW;
            const color = COLORS[index % COLORS.length]!;
            return <g key={lane.key}>
              <rect x={0} y={y - 15} width={WIDTH} height={ROW} rx={4} fill="currentColor" opacity={index % 2 ? 0.035 : 0.065}/>
              <rect x={8} y={y - 8} width={4} height={17} rx={2} fill={color}/>
              <text x={20} y={y + 1} fill="currentColor" fontSize={13} fontWeight="600">{lane.name.length > 19 ? lane.name.slice(0, 18) + "…" : lane.name}</text>
              <text x={20} y={y + 15} fill="currentColor" opacity={0.5} fontSize={10}>{lane.type}</text>
              <line x1={LEFT} y1={y} x2={WIDTH - RIGHT} y2={y} stroke={color} opacity={0.4} strokeWidth={2}/>
            </g>;
          })}
          {events.map(event => {
            const index = lanes.findIndex(lane => lane.key === event.targetKey);
            const y = TOP + index * ROW;
            const sameTime = overlapCounts.get(event.minute)! > 1;
            return <g key={event.id}>
              <circle cx={xAt(event.minute)} cy={y} r={sameTime ? 8 : 6} fill={event.color} stroke={sameTime ? "#f59e0b" : "currentColor"} strokeWidth={sameTime ? 3 : 1}/>
              <title>{event.targetName} — {timeLabel(event.minute)}{sameTime ? " (simultaneous start)" : ""}</title>
            </g>;
          })}
          {lanes.length === 0 && <text x={WIDTH / 2} y={TOP + 15} textAnchor="middle" fill="currentColor" opacity={0.65} fontSize={16}>Add fixed-time timetable actions to see them here.</text>}
        </svg>
      </ScrollArea>
    </Stack>
  );
}
