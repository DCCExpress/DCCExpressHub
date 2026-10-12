import { Alert, Badge, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { loadAutomationBlockCatalog } from "@/services/automationBlockCatalog";
import type { MovementPage } from "@/domain/movement";
import type { TimetableEntryDefinition } from "@/services/automationApi";

type Target = { id: string; name: string };
type Props = {
  entries: TimetableEntryDefinition[];
  movements: MovementPage[];
  scripts: Target[];
};
type Journey = { id: string; name: string; start: number; duration: number; blocks: number[]; color: string };
type Marker = { id: string; minute: number; name: string; kind: string };
const WIDTH = 1320;
const LEFT = 160;
const RIGHT = 35;
const TOP = 52;
const ROW = 48;
const DAY = 24 * 60;
const COLORS = ["#22c55e", "#38bdf8", "#f59e0b", "#c084fc", "#fb7185", "#2dd4bf", "#a3e635"];
const timeLabel = (minute: number): string => {
  const rounded = ((Math.round(minute) % DAY) + DAY) % DAY;
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
};

/**
 * Planning-only time–distance chart. A Movement's planned total is divided
 * equally over its routeRef block-to-block legs, not treated as measured
 * intermediate arrival times. No arrival times are fabricated when missing.
 */
export default function TimetableTimeline({ entries, movements, scripts }: Props) {
  const [blockNames, setBlockNames] = useState<Record<number, string>>({});
  useEffect(() => {
    let cancelled = false;
    void loadAutomationBlockCatalog().then(blocks => {
      if (!cancelled) setBlockNames(Object.fromEntries(blocks.map(block => [block.id, block.name])));
    }).catch(() => { /* Fall back to block IDs when no layout is loaded. */ });
    return () => { cancelled = true; };
  }, []);
  const { journeys, markers, blockOrder, missingDuration, unsupported } = useMemo(() => {
    const byMovement = new Map(movements.map(item => [item.id, item]));
    const byScript = new Map(scripts.map(item => [item.id, item]));
    const results: Journey[] = [];
    const dots: Marker[] = [];
    const order: number[] = [];
    const seen = new Set<number>();
    let missing = 0;
    let excluded = 0;
    for (const entry of entries) {
      if (!entry.enabled) continue;
      const match = entry.cron.trim().match(/^(\d{1,2})\s+(\d{1,2})$/);
      if (!match || Number(match[1]) > 59 || Number(match[2]) > 23) {
        excluded++;
        continue;
      }
      const start = Number(match[2]) * 60 + Number(match[1]);
      for (const action of entry.actions) {
        if (action.targetType === "script") {
          const script = byScript.get(action.targetId);
          if (script) dots.push({ id: `${entry.id}:${action.id}`, minute: start, name: script.name, kind: "Script" });
          continue;
        }
        const movement = byMovement.get(action.targetId);
        if (!movement) continue;
        const blocks = movement.routeRef
          ? [movement.routeRef.fromBlockId, ...movement.routeRef.viaBlockIds, movement.routeRef.toBlockId]
          : [];
        const durationSeconds = movement.plannedDurationSeconds;
        if (blocks.length < 2 || durationSeconds == null || durationSeconds <= 0) {
          missing++;
          dots.push({ id: `${entry.id}:${action.id}`, minute: start, name: movement.name, kind: "Movement (no planned route/duration)" });
          continue;
        }
        for (const block of blocks) if (!seen.has(block)) { seen.add(block); order.push(block); }
        results.push({
          id: `${entry.id}:${action.id}`,
          name: movement.name,
          start,
          duration: durationSeconds / 60,
          blocks,
          color: COLORS[results.length % COLORS.length]!,
        });
      }
    }
    return { journeys: results, markers: dots, blockOrder: order, missingDuration: missing, unsupported: excluded };
  }, [entries, movements, scripts]);

  const height = TOP + Math.max(blockOrder.length, 1) * ROW + 44;
  const xAt = (minute: number) => LEFT + minute / DAY * (WIDTH - LEFT - RIGHT);
  const yAt = (block: number) => TOP + blockOrder.indexOf(block) * ROW;
  const label = (block: number) => blockNames[block] || `Block #${block}`;
  const beyondMidnight = journeys.filter(j => j.start + j.duration > DAY).length;

  return (
    <Stack gap="sm" style={{ minHeight: 0, flex: 1 }}>
      <Group gap="xs" wrap="wrap">
        <Badge variant="light" color="blue">Time–distance diagram</Badge>
        <Badge variant="light" color="gray">{journeys.length} planned journeys</Badge>
        <Badge variant="light" color="gray">{blockOrder.length} blocks</Badge>
      </Group>
      <Text size="xs" c="dimmed">Horizontal: scheduled time · Vertical: Movement route blocks. Leg times are evenly estimated from Planned total. Block order follows the encountered Movement routes, not physical geography.</Text>
      {(missingDuration > 0 || unsupported > 0 || beyondMidnight > 0) && (
        <Alert color="yellow" variant="light" p="xs">
          {missingDuration > 0 && `${missingDuration} Movement actions have no route or Planned duration. `}
          {unsupported > 0 && `${unsupported} recurring/advanced timetable entries are not displayed. `}
          {beyondMidnight > 0 && `${beyondMidnight} journeys extend beyond midnight and are clipped at 24:00.`}
        </Alert>
      )}
      <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
        <svg width="100%" viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="Planned train journeys across route blocks and timetable time" style={{ minWidth: 840, display: "block" }}>
          {Array.from({ length: 13 }, (_, index) => index * 120).map(minute => (
            <g key={minute}>
              <line x1={xAt(minute)} y1={TOP - 17} x2={xAt(minute)} y2={height - 25} stroke="currentColor" opacity={0.15} strokeDasharray="3 5"/>
              <text x={xAt(minute)} y={22} textAnchor="middle" fill="currentColor" fontSize={13} opacity={0.75}>{minute === DAY ? "24:00" : timeLabel(minute)}</text>
            </g>
          ))}
          {blockOrder.map((block, index) => {
            const y = TOP + index * ROW;
            return <g key={block}>
              <rect x={0} y={y - ROW / 2} width={WIDTH} height={ROW} fill="currentColor" opacity={index % 2 ? 0.025 : 0.06}/>
              <text x={LEFT - 12} y={y + 4} textAnchor="end" fill="currentColor" fontSize={13} fontWeight="600">{label(block)}</text>
              <line x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} stroke="currentColor" opacity={0.18}/>
            </g>;
          })}
          <defs><clipPath id="movement-planned-day"><rect x={LEFT} y={TOP - ROW / 2} width={WIDTH - LEFT - RIGHT} height={Math.max(blockOrder.length, 1) * ROW}/></clipPath></defs>
          <g clipPath="url(#movement-planned-day)">
            {journeys.map(journey => {
              const points = journey.blocks.map((block, i) => {
                const minute = journey.start + journey.duration * i / (journey.blocks.length - 1);
                return { block, minute, x: xAt(minute), y: yAt(block) };
              });
              return <g key={journey.id}>
                <polyline points={points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={journey.color} strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round"/>
                {points.map((p, index) => <circle key={index} cx={p.x} cy={p.y} r={4.5} fill={journey.color} stroke="currentColor" strokeWidth={0.8}/>)}
                <title>{journey.name}: {timeLabel(journey.start)} → {timeLabel(journey.start + journey.duration)} · {journey.blocks.map(label).join(" → ")} · Planned {Math.round(journey.duration * 60)} s</title>
              </g>;
            })}
          </g>
          {blockOrder.length === 0 && <text x={WIDTH / 2} y={TOP + 14} textAnchor="middle" fill="currentColor" opacity={0.65} fontSize={15}>Set a Movement route and Planned duration, then schedule it at a fixed time.</text>}
        </svg>
      </ScrollArea>
      {markers.length > 0 && <Text size="xs" c="dimmed">Starts without a planned path: {markers.slice(0, 8).map(m => `${m.name} (${timeLabel(m.minute)})`).join(", ")}{markers.length > 8 ? ` +${markers.length - 8} more` : ""}</Text>}
    </Stack>
  );
}
