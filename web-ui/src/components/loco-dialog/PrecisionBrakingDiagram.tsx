import { Card, Text } from "@mantine/core";

type Props = {
  mode: "pull" | "push";
  locomotiveLengthMm: number;
  wagonsLengthMm: number;
  blockLengthMm: number;
  frontClearanceMm: number;
  rearClearanceMm: number;
};

/** Dynamic SVG: the two train positions explain A -> B -> C, not live tracking. */
export default function PrecisionBrakingDiagram({
  mode, locomotiveLengthMm, wagonsLengthMm, blockLengthMm,
  frontClearanceMm, rearClearanceMm,
}: Props) {
  const engineWidth = 113 * 20 / 44;
  const wagonWidth = 264 * 20 / 40;
  const blocks = [
    { name: "A", x: 18, fill: "#60a5fa", tint: "#60a5fa", label: "#93c5fd" },
    { name: "B", x: 228, fill: "#22c55e", tint: "#22c55e", label: "#86efac" },
    { name: "C", x: 438, fill: "#f59e0b", tint: "#f59e0b", label: "#fcd34d" },
  ];
  const blockWidth = 194;
  const trainStartA = 18 + 4;
  const trainStartC = 438 + 4;
  const trackY = 106;

  const train = (x: number, key: string) => {
    const engineX = mode === "pull" ? x + wagonWidth : x;
    const wagonX = mode === "pull" ? x : x + engineWidth;
    return (
      <g key={key}>
        <image href="/images/bobo.png" x={engineX} y={trackY - 24}
          width={engineWidth} height={20} preserveAspectRatio="xMidYMid meet" />
        <image href="/images/vagon.png" x={wagonX} y={trackY - 24}
          width={wagonWidth} height={20} preserveAspectRatio="xMidYMid meet" />
      </g>
    );
  };

  return (
    <Card withBorder p="sm">
      <Text fw={600} size="sm" mb={4}>Precision Braking — block position</Text>
      <svg viewBox="0 0 650 184" width="100%" role="img"
        aria-label="Blocks A B C with train at origin A and stopping position C, forward to the right">
        <defs>
          <marker id="braking-forward-head" markerWidth="8" markerHeight="8"
            refX="7" refY="4" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" fill="#3b82f6" />
          </marker>
        </defs>
        {blocks.map(block => (
          <g key={block.name}>
            <rect x={block.x} y="49" width={blockWidth} height="106" rx="10"
              fill={block.tint} fillOpacity=".09"
              stroke={block.fill} strokeWidth="1.5" />
            <text x={block.x + blockWidth / 2} y="144"
              fontSize="17" fontWeight="700" textAnchor="middle"
              fill="currentColor">{block.name}</text>
          </g>
        ))}
        <text x="325" y="16" fill="currentColor" fontSize="13" textAnchor="middle">Forward</text>
        <path d="M235 31 H415" stroke="#3b82f6" strokeWidth="3"
          fill="none" markerEnd="url(#braking-forward-head)" />
        {Array.from({ length: 41 }, (_, i) => (
          <path key={i} d={`M${19 + i * 15} ${trackY - 8} v18`}
            stroke="#8b7355" strokeWidth="3" />
        ))}
        <path d={`M18 ${trackY - 4} H632 M18 ${trackY + 6} H632`}
          stroke="#64748b" strokeWidth="2.5" fill="none" />
        {[220, 430].map(x => <path key={x} d={`M${x} 49 V155`}
          stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" />)}
        {train(trainStartA, "origin")}
        {train(trainStartC, "destination")}
        <text x="325" y="176" textAnchor="middle" fill="currentColor" fontSize="11">
          {mode === "pull" ? "Pull" : "Push"} · Loco {locomotiveLengthMm} mm
          {" · "}Wagons {wagonsLengthMm} mm
          {blockLengthMm > 0 ? ` · Block C ${blockLengthMm} mm` : ""}
        </text>
      </svg>
      <Text size="xs" c="dimmed">
        A: start · B: travel · C: target stopping block. Illustration only,
        not a physical scale drawing. Front: {frontClearanceMm} mm;
        rear: {rearClearanceMm} mm from block boundaries.
      </Text>
    </Card>
  );
}
