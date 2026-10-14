import { useMemo, useState } from "react";
import { Badge, Button, Group, Paper, ScrollArea, Stack, Text } from "@mantine/core";
import type { Graph } from "@/domain/railway/graph";

type Props = { graph: Graph };

export default function RouteGraphVisualization({ graph }: Props) {
  const [scale, setScale] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const positions = useMemo(() => {
    const result = new Map<string, { x: number; y: number }>();
    const nodes = graph.nodes;
    // Use a deterministic ring arrangement, independently of the physical canvas.
    // This is a diagnostic visualization, never a replacement for route topology.
    const radius = Math.max(165, nodes.length * 24);
    const size = radius * 2 + 180;
    nodes.forEach((node, index) => {
      const angle = (2 * Math.PI * index) / Math.max(1, nodes.length) - Math.PI / 2;
      result.set(node.name, {
        x: size / 2 + radius * Math.cos(angle),
        y: size / 2 + radius * Math.sin(angle),
      });
    });
    return result;
  }, [graph]);
  const radius = Math.max(165, graph.nodes.length * 24);
  const size = radius * 2 + 180;
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
        <svg width={size * scale} height={size * scale} viewBox={`0 0 ${size} ${size}`}
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
