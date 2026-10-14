import { useMemo, useState } from "react";
import { Badge, Button, Group, Paper, ScrollArea, Stack, Text } from "@mantine/core";
import type { Graph } from "@/domain/railway/graph";
import type { LayoutView } from "@/models/editor/core/LayoutView";

type Props = { graph: Graph; layout: LayoutView };

export default function RouteGraphVisualization({ graph, layout }: Props) {
  const [scale, setScale] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const geometry = useMemo(() => {
    const serialized = JSON.parse(JSON.stringify(layout)) as {
      layers?: Array<{ elements?: Array<{ id?: number; type?: string; x?: number; y?: number; w?: number; h?: number }> }>;
    };
    const elements = new Map<number, { id?: number; type?: string; x?: number; y?: number; w?: number; h?: number }>();
    for (const layer of serialized.layers ?? []) {
      for (const element of layer.elements ?? []) {
        if (typeof element.id === "number") elements.set(element.id, element);
      }
    }
    const center = (e: { x?: number; y?: number; w?: number; h?: number }) => ({
      x: (e.x ?? 0) + (e.w ?? 0) / 2,
      y: (e.y ?? 0) + (e.h ?? 0) / 2,
    });
    const raw = graph.nodes.map(node => {
      // Place named block nodes next to their actual position on the layout.
      const blocks = node.blocks.map(block => elements.get(block.id))
        .filter((value): value is NonNullable<typeof value> => value !== undefined);
      const tracks = node.elementIds.map(id => elements.get(id))
        .filter((value): value is NonNullable<typeof value> => value !== undefined);
      const anchors = blocks.length ? blocks : tracks;
      const points = anchors.map(center);
      const fallback = { x: node.x, y: node.y };
      const x = points.length ? points.reduce((sum, p) => sum + p.x, 0) / points.length : fallback.x;
      const y = points.length ? points.reduce((sum, p) => sum + p.y, 0) / points.length : fallback.y;
      return { name: node.name, x, y };
    });
    const minX = Math.min(...raw.map(p => p.x), 0);
    const minY = Math.min(...raw.map(p => p.y), 0);
    const maxX = Math.max(...raw.map(p => p.x), 1);
    const maxY = Math.max(...raw.map(p => p.y), 1);
    const extent = Math.max(maxX - minX, maxY - minY, 1);
    const factor = Math.max(.65, Math.min(2.6, 760 / extent));
    const positions = new Map<string, { x: number; y: number }>();
    // Spread only overlapping labels; keep the overall geographical topology.
    const occupied: Array<{ x: number; y: number }> = [];
    for (const node of raw) {
      let x = 75 + (node.x - minX) * factor;
      let y = 75 + (node.y - minY) * factor;
      let attempt = 0;
      while (occupied.some(p => Math.abs(p.x - x) < 78 && Math.abs(p.y - y) < 43) && attempt < 24) {
        attempt++;
        const angle = attempt * 2.399963;
        const offset = 22 * Math.sqrt(attempt);
        x = 75 + (node.x - minX) * factor + Math.cos(angle) * offset;
        y = 75 + (node.y - minY) * factor + Math.sin(angle) * offset;
      }
      occupied.push({ x, y });
      positions.set(node.name, { x, y });
    }
    const width = Math.max(350, ...occupied.map(p => p.x + 75));
    const height = Math.max(260, ...occupied.map(p => p.y + 75));
    return { positions, width, height };
  }, [graph, layout]);
  const { positions, width, height } = geometry;
  const chosen = graph.nodes.find(node => node.name === selected);
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Group gap="xs">
          <Badge variant="light">{graph.nodes.length} nodes</Badge>
          <Badge variant="light">{graph.edges.length} directed edges</Badge>
        </Group>
        <Group gap="xs">
          <Button size="xs" variant="default" onClick={() => setScale(value => Math.max(.5, value - .25))}>−</Button>
          <Button size="xs" variant="default" onClick={() => setScale(1)}>100%</Button>
          <Button size="xs" variant="default" onClick={() => setScale(value => Math.min(3, value + .25))}>+</Button>
        </Group>
      </Group>
      <ScrollArea h={420} type="auto" offsetScrollbars>
        <svg width={width * scale} height={height * scale} viewBox={`0 0 ${width} ${height}`}
          role="img" aria-label="Directed route graph">
          <defs>
            <marker id="route-graph-arrow" markerWidth="7" markerHeight="7"
              refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L6,3 L0,6 Z" fill="#64748b" />
            </marker>
          </defs>
          {graph.edges.map((edge, index) => {
            const a = positions.get(edge.from.name);
            const b = positions.get(edge.to.name);
            if (!a || !b) return null;
            const dx = b.x - a.x, dy = b.y - a.y;
            const distance = Math.hypot(dx, dy) || 1;
            const nx = -dy / distance, ny = dx / distance;
            // Separate opposite directional edges.
            const shift = 8;
            const sx = a.x + nx * shift + dx / distance * 29;
            const sy = a.y + ny * shift + dy / distance * 29;
            const tx = b.x + nx * shift - dx / distance * 32;
            const ty = b.y + ny * shift - dy / distance * 32;
            const color = edge.locoDirection === "unknown" ? "#d97706"
              : edge.locoDirection === "reverse" ? "#a855f7" : "#2563eb";
            return <g key={index}>
              <line x1={sx} y1={sy} x2={tx} y2={ty} stroke={color}
                strokeWidth="2.2" markerEnd="url(#route-graph-arrow)" />
              <title>{edge.from.name} → {edge.to.name} · {edge.locoDirection}
                {edge.turnoutStates.length ? ` · Turnouts: ${edge.turnoutStates.map(t => `${t.address}:${t.closed ? "C" : "T"}`).join(", ")}` : ""}</title>
            </g>;
          })}
          {graph.nodes.map(node => {
            const p = positions.get(node.name)!;
            const active = selected === node.name;
            return <g key={node.name} onClick={() => setSelected(node.name)}
              style={{ cursor: "pointer" }}>
              <rect x={p.x - 34} y={p.y - 18} width="68" height="36" rx="9"
                fill={active ? "#bfdbfe" : "#e2e8f0"}
                stroke={active ? "#1d4ed8" : "#64748b"} strokeWidth={active ? 3 : 1.5} />
              <text x={p.x} y={p.y + 5} textAnchor="middle" fill="#0f172a"
                fontWeight="600" fontSize="13">{node.name}</text>
              <title>{node.name} · blocks: {node.blocks.map(b => b.name).join(", ") || "—"}</title>
            </g>;
          })}
        </svg>
      </ScrollArea>
      <Group gap="md">
        <Text size="xs" c="blue">Forward</Text>
        <Text size="xs" c="violet">Reverse</Text>
        <Text size="xs" c="orange">Unknown</Text>
      </Group>
      {chosen && <Paper withBorder p="xs">
        <Text fw={600}>{chosen.name}</Text>
        <Text size="sm">Blocks: {chosen.blocks.map(b => b.name).join(", ") || "—"}</Text>
        <Text size="sm">Sensors: {chosen.detectors.map(d => d.address).join(", ") || "—"}</Text>
        <Text size="sm">Signals: {chosen.signals.map(d => d.address).join(", ") || "—"}</Text>
        <Text size="sm">Elements: {chosen.elementIds.join(", ") || "—"}</Text>
      </Paper>}
    </Stack>
  );
}
