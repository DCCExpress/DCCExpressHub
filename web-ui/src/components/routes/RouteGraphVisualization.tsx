import { useMemo, useState } from "react";
import { Badge, Button, Group, Paper, ScrollArea, Select, Slider, Stack, Text } from "@mantine/core";
import type { Graph } from "@/domain/railway/graph";
import type { LayoutView } from "@/models/editor/core/LayoutView";

type Props = { graph: Graph; layout: LayoutView };

export default function RouteGraphVisualization({ graph, layout }: Props) {
  const [scale, setScale] = useState(1);
  const [viewMode, setViewMode] = useState<"physical" | "force" | "layers">("force");
  const [xSpacing, setXSpacing] = useState(2);
  const [ySpacing, setYSpacing] = useState(2);
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
    const physical = graph.nodes.map(node => {
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
    // All layout algorithms operate on visualization copies only. No Graph
    // nodes or edges are mutated. This entire feature can be removed independently.
    type Point = { name: string; x: number; y: number };
    const edges = graph.edges.map(edge => [edge.from.name, edge.to.name] as const);
    const raw: Point[] = physical.map(p => ({ ...p }));
    if (viewMode === "force" && raw.length > 1) {
      const coordinates = new Map(raw.map(p => [p.name, p]));
      const xExtent = Math.max(1, Math.max(...raw.map(p => p.x)) - Math.min(...raw.map(p => p.x)));
      const yExtent = Math.max(1, Math.max(...raw.map(p => p.y)) - Math.min(...raw.map(p => p.y)));
      const unit = 320 / Math.max(xExtent, yExtent);
      const originX = Math.min(...raw.map(p => p.x));
      const originY = Math.min(...raw.map(p => p.y));
      // Normalize into readable units before applying forces.
      for (const p of raw) { p.x = (p.x - originX) * unit; p.y = (p.y - originY) * unit; }
      const anchors = raw.map(p => ({ x: p.x, y: p.y }));
      const pairs = new Set<string>();
      for (const [from, to] of edges) {
        if (from === to || !coordinates.has(from) || !coordinates.has(to)) continue;
        pairs.add([from, to].sort().join("\u0000"));
      }
      const springs = [...pairs].map(key => {
        const [a, b] = key.split("\u0000");
        return [coordinates.get(a!)!, coordinates.get(b!)!] as const;
      });
      for (let iteration = 0; iteration < 180; iteration++) {
        const movement = raw.map(() => ({ x: 0, y: 0 }));
        for (let i = 0; i < raw.length; i++) {
          for (let j = i + 1; j < raw.length; j++) {
            let dx = raw[j]!.x - raw[i]!.x, dy = raw[j]!.y - raw[i]!.y;
            if (Math.abs(dx) + Math.abs(dy) < .001) {
              const angle = (j + 1) * 2.399963;
              dx = Math.cos(angle); dy = Math.sin(angle);
            }
            const distanceSquared = Math.max(25, dx * dx + dy * dy);
            const distance = Math.sqrt(distanceSquared);
            const repel = 8500 / distanceSquared;
            movement[i]!.x -= dx / distance * repel;
            movement[i]!.y -= dy / distance * repel;
            movement[j]!.x += dx / distance * repel;
            movement[j]!.y += dy / distance * repel;
          }
        }
        for (const [a, b] of springs) {
          const i = raw.indexOf(a), j = raw.indexOf(b);
          const dx = b.x - a.x, dy = b.y - a.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const strength = (distance - 125) * .035;
          movement[i]!.x += dx / distance * strength;
          movement[i]!.y += dy / distance * strength;
          movement[j]!.x -= dx / distance * strength;
          movement[j]!.y -= dy / distance * strength;
        }
        const cooling = Math.max(.12, 1 - iteration / 180);
        for (let i = 0; i < raw.length; i++) {
          // Anchor gently to the physical layout, preserving relative geography.
          movement[i]!.x += (anchors[i]!.x - raw[i]!.x) * .025;
          movement[i]!.y += (anchors[i]!.y - raw[i]!.y) * .025;
          raw[i]!.x += Math.max(-16, Math.min(16, movement[i]!.x)) * cooling;
          raw[i]!.y += Math.max(-16, Math.min(16, movement[i]!.y)) * cooling;
        }
      }
    } else if (viewMode === "layers" && raw.length > 0) {
      // Breadth-first levels on the undirected topology; direction stays on
      // the rendered edges. Seed with the leftmost physically placed node.
      const neighbors = new Map(raw.map(p => [p.name, new Set<string>()]));
      for (const [a, b] of edges) {
        neighbors.get(a)?.add(b);
        neighbors.get(b)?.add(a);
      }
      const byName = new Map(raw.map(p => [p.name, p]));
      const remaining = new Set(raw.map(p => p.name));
      let startColumn = 0;
      while (remaining.size) {
        const root = [...remaining].sort((a, b) =>
          (byName.get(a)!.x - byName.get(b)!.x) ||
          (byName.get(a)!.y - byName.get(b)!.y))[0]!;
        const levels = new Map<string, number>([[root, 0]]);
        const queue = [root];
        remaining.delete(root);
        for (let head = 0; head < queue.length; head++) {
          const name = queue[head]!;
          for (const neighbor of neighbors.get(name) ?? []) {
            if (!remaining.has(neighbor)) continue;
            levels.set(neighbor, levels.get(name)! + 1);
            remaining.delete(neighbor);
            queue.push(neighbor);
          }
        }
        const columns = new Map<number, Point[]>();
        for (const name of queue) {
          const level = levels.get(name)!;
          const column = columns.get(level) ?? [];
          column.push(byName.get(name)!);
          columns.set(level, column);
        }
        for (const [level, column] of columns) {
          column.sort((a, b) => a.y - b.y || a.x - b.x);
          column.forEach((p, row) => { p.x = (startColumn + level) * 145; p.y = row * 95; });
        }
        startColumn += Math.max(...columns.keys()) + 2;
      }
    }
    const minX = Math.min(...raw.map(p => p.x), 0);
    const minY = Math.min(...raw.map(p => p.y), 0);
    const maxX = Math.max(...raw.map(p => p.x), 1);
    const maxY = Math.max(...raw.map(p => p.y), 1);
    const extent = Math.max(maxX - minX, maxY - minY, 1);
    const factor = Math.max(.65, Math.min(2.6, 760 / extent));
    const factorX = factor * xSpacing;
    const factorY = factor * ySpacing;
    const positions = new Map<string, { x: number; y: number }>();
    // Spread only overlapping labels; keep the overall geographical topology.
    const occupied: Array<{ x: number; y: number }> = [];
    for (const node of raw) {
      let x = 75 + (node.x - minX) * factorX;
      let y = 75 + (node.y - minY) * factorY;
      let attempt = 0;
      while (occupied.some(p => Math.abs(p.x - x) < 78 && Math.abs(p.y - y) < 43) && attempt < 24) {
        attempt++;
        const angle = attempt * 2.399963;
        const offset = 22 * Math.sqrt(attempt);
        x = 75 + (node.x - minX) * factorX + Math.cos(angle) * offset;
        y = 75 + (node.y - minY) * factorY + Math.sin(angle) * offset;
      }
      occupied.push({ x, y });
      positions.set(node.name, { x, y });
    }
    const width = Math.max(350, ...occupied.map(p => p.x + 75));
    const height = Math.max(260, ...occupied.map(p => p.y + 75));
    return { positions, width, height };
  }, [graph, layout, xSpacing, ySpacing, viewMode]);
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
      <Group align="end" gap="md">
        <Select label="Graph layout" value={viewMode}
          data={[
            { value: "force", label: "Force-directed (physical anchors)" },
            { value: "physical", label: "Physical positions" },
            { value: "layers", label: "Hierarchical (BFS)" },
          ]}
          onChange={value => {
            if (value === "physical" || value === "force" || value === "layers") setViewMode(value);
          }} w={270} allowDeselect={false} />
        <Text size="xs" c="dimmed">Display only · graph topology unchanged</Text>
      </Group>
      <Group grow gap="md">
        <Stack gap={2}>
          <Text size="xs">X spacing: {xSpacing.toFixed(1)}×</Text>
          <Slider min={0.5} max={6} step={0.25} value={xSpacing} onChange={setXSpacing}
            label={value => `${value.toFixed(2)}×`} />
        </Stack>
        <Stack gap={2}>
          <Text size="xs">Y spacing: {ySpacing.toFixed(1)}×</Text>
          <Slider min={0.5} max={6} step={0.25} value={ySpacing} onChange={setYSpacing}
            label={value => `${value.toFixed(2)}×`} />
        </Stack>
        <Button size="xs" variant="subtle" onClick={() => { setXSpacing(2); setYSpacing(2); }}>Reset spacing</Button>
      </Group>
      <ScrollArea h={420} type="auto" offsetScrollbars>
        <svg width={width * scale} height={height * scale} viewBox={`0 0 ${width} ${height}`}
          role="img" aria-label="Directed route graph">
          <defs>
            <marker id="route-graph-arrow-end" markerWidth="7" markerHeight="7"
              refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L6,3 L0,6 Z" fill="#64748b" />
            </marker>
            <marker id="route-graph-arrow-start" markerWidth="7" markerHeight="7"
              refX="0" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M6,0 L0,3 L6,6 Z" fill="#64748b" />
            </marker>
          </defs>
          {(() => {
            const connections = new Map<string, {
              first: string; second: string; forward: boolean; backward: boolean;
              labels: string[];
            }>();
            for (const edge of graph.edges) {
              const from = edge.from.name, to = edge.to.name;
              if (from === to) continue;
              const [first, second] = [from, to].sort();
              const key = JSON.stringify([first, second]);
              let connection = connections.get(key);
              if (!connection) {
                connection = { first, second, forward: false, backward: false, labels: [] };
                connections.set(key, connection);
              }
              if (from === first) connection.forward = true;
              else connection.backward = true;
              connection.labels.push(`${from} → ${to} (${edge.locoDirection})`);
            }
            return [...connections.values()].map(connection => {
              const a = positions.get(connection.first);
              const b = positions.get(connection.second);
              if (!a || !b) return null;
              const dx = b.x - a.x, dy = b.y - a.y;
              const distance = Math.max(1, Math.hypot(dx, dy));
              const sx = a.x + dx / distance * 34;
              const sy = a.y + dy / distance * 20;
              const tx = b.x - dx / distance * 34;
              const ty = b.y - dy / distance * 20;
              return <g key={JSON.stringify([connection.first, connection.second])}>
                <line x1={sx} y1={sy} x2={tx} y2={ty}
                  stroke="#64748b" strokeWidth="2.2"
                  markerStart={connection.backward ? "url(#route-graph-arrow-start)" : undefined}
                  markerEnd={connection.forward ? "url(#route-graph-arrow-end)" : undefined} />
                <title>{connection.labels.join(" | ")}</title>
              </g>;
            });
          })()}
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
