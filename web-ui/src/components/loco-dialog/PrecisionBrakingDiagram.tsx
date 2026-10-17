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
          <marker id="braking-forward-head" markerWidth="8" markerHeight="8"
            refX="7" refY="4" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" fill="#3b82f6" />
          </marker>
          <marker id="braking-measure-head" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto-start-reverse">
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
        {/* A: moving left. Front is the leftmost point; rear the rightmost. */}
        <path d={`M220 58 H${trainStartA}`} stroke="#2563eb" strokeWidth="2.5"
          markerStart="url(#braking-measure-head)" markerEnd="url(#braking-measure-head)" />
        <text x="98" y="48" fontSize="11" fill="#2563eb" textAnchor="middle">A: ELEJE</text>
        <text x={trainStartA + 10} y="76" fontSize="10" fill="#2563eb">ELEJE</text>
        <text x={trainStartA + engineWidth + wagonWidth - 40} y="76" fontSize="10" fill="#dc2626">VÉGE</text>
        <text x="185" y="48" fontSize="11" fill="#dc2626" textAnchor="middle">A: VÉGE</text>
        <path d={`M220 66 H${trainStartA + engineWidth + wagonWidth}`}
          stroke="#dc2626" strokeWidth="2.5" markerStart="url(#braking-measure-head)"
          markerEnd="url(#braking-measure-head)" />
        {/* C: moving right. Front is the rightmost point; rear the leftmost. */}
        <path d={`M430 58 H${trainStartC + engineWidth + wagonWidth}`}
          stroke="#2563eb" strokeWidth="2.5" markerStart="url(#braking-measure-head)"
          markerEnd="url(#braking-measure-head)" />
        <path d={`M430 66 H${trainStartC}`}
          stroke="#dc2626" strokeWidth="2.5" markerStart="url(#braking-measure-head)"
          markerEnd="url(#braking-measure-head)" />
        <text x="568" y="48" fontSize="11" fill="#2563eb" textAnchor="middle">C: ELEJE</text>
        <text x="462" y="48" fontSize="11" fill="#dc2626" textAnchor="middle">C: VÉGE</text>
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
        C: stopping block ({blockLengthMm || "unknown"} mm). Mindkét irányban a belépési vonaltól mérd az ELEJE (kék) és a VÉGE (piros) pozícióját. Az eleje pozitív, a vége lehet negatív, ha kilóg. Nem méretarányos.
      </Text>
    </Card>
  );
}
