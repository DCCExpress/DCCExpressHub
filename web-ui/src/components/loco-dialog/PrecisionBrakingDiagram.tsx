import { Card, Text } from "@mantine/core";

type Props = {
  mode: "pull" | "push";
  locomotiveLengthMm: number;
  wagonsLengthMm: number;
  blockLengthMm: number;
  sourceBlockLengthMm: number;
  frontClearanceMm: number;
  rearClearanceMm: number;
};

/** Dynamic SVG: the two train positions explain A -> B -> C, not live tracking. */
export default function PrecisionBrakingDiagram({
  mode, locomotiveLengthMm, wagonsLengthMm, blockLengthMm, sourceBlockLengthMm,
  frontClearanceMm, rearClearanceMm,
}: Props) {
  const engineWidth = 113 * 20 / 44;
  const wagonWidth = 264 * 20 / 40;
  const blocks = [
    { name: "A", x: 18 },
    { name: "B", x: 228 },
    { name: "C", x: 438 },
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
          <marker id="braking-forward-head" markerWidth="4" markerHeight="4"
            refX="7" refY="4" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" fill="#3b82f6" />
          </marker>
          <marker id="braking-measure-head" markerWidth="4" markerHeight="4" refX="6" refY="3.5" orient="auto-start-reverse">
            <path d="M0 0 L7 3.5 L0 7 Z" fill="#dc2626" />
          </marker>
        </defs>
        {blocks.map(block => (
          <g key={block.name}>
            <text x={block.x + blockWidth / 2} y="144"
              fontSize="17" fontWeight="700" textAnchor="middle"
              fill="currentColor">{block.name}</text>
          </g>
        ))}
        <text x="325" y="16" fill="currentColor" fontSize="13" textAnchor="middle">Forward</text>
        <path d="M235 31 H415" stroke="#3b82f6" strokeWidth="1.5"
          fill="none" markerEnd="url(#braking-forward-head)" />
        {Array.from({ length: 41 }, (_, i) => (
          <path key={i} d={`M${19 + i * 15} ${trackY - 8} v18`}
            stroke="#8b7355" strokeWidth="3" />
        ))}
        <path d={`M18 ${trackY - 4} H632 M18 ${trackY + 6} H632`}
          stroke="#64748b" strokeWidth="2.5" fill="none" />
        {[220, 430].map(x => <path key={x} d={`M${x} 49 V155`}
          stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" />)}
        <path d={`M220 66 H${trainStartA + engineWidth + wagonWidth}`} stroke="#dc2626" strokeWidth="1.5" markerStart="url(#braking-measure-head)" markerEnd="url(#braking-measure-head)" />
        <text x="181" y="52" fontSize="10" fill="#dc2626" textAnchor="middle">Távolság (mm)</text>
        <path d={`M430 66 H${trainStartC}`} stroke="#dc2626" strokeWidth="1.5" markerStart="url(#braking-measure-head)" markerEnd="url(#braking-measure-head)" />
        <text x="462" y="52" fontSize="10" fill="#dc2626" textAnchor="middle">Távolság (mm)</text>
        {train(trainStartA, "origin")}
        {train(trainStartC, "destination")}
        <text x="325" y="176" textAnchor="middle" fill="currentColor" fontSize="11">
          {mode === "pull" ? "Pull" : "Push"} · Loco {locomotiveLengthMm} mm
          {" · "}Wagons {wagonsLengthMm} mm
          {sourceBlockLengthMm > 0 ? ` · A ${sourceBlockLengthMm} mm` : ""}
          {blockLengthMm > 0 ? ` · C ${blockLengthMm} mm` : ""}
        </text>
      </svg>
      <Text size="xs" c="dimmed">
        A: starting block ({sourceBlockLengthMm || "unknown"} mm) · B: travel ·
        C: stopping block ({blockLengthMm || "unknown"} mm). Mindkét irányban egyetlen távolságot mérj: belépési vonal és a vonat vége között. A vonat elejét a program számolja. Nem méretarányos.
      </Text>
    </Card>
  );
}
