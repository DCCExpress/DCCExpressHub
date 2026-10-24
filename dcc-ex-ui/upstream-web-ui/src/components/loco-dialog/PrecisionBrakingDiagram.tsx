import { Card, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

type Props = {
  mode: "pull" | "push";
  locomotiveLengthMm: number;
  wagonsLengthMm: number;
  blockLengthMm: number;
  sourceBlockLengthMm: number;
};

/** Dynamic SVG: the two train positions explain A -> B -> C, not live tracking. */
export default function PrecisionBrakingDiagram({
  mode, locomotiveLengthMm, wagonsLengthMm, blockLengthMm, sourceBlockLengthMm,
}: Props) {
  const { t } = useTranslation();
  // The illustration uses the image edges as the leading/trailing ends.
  const trainHeight = 14;
  const engineWidth = 113 * trainHeight / 44;
  const wagonWidth = 264 * trainHeight / 40;
  const blocks = [
    { name: "A", x: 18 },
    { name: "B", x: 228 },
    { name: "C", x: 438 },
  ];
  const blockWidth = 194;
  const entryA = 220; // The A-boundary, reached from the right.
  const entryC = 430; // The C-boundary, reached from the left.
  // Each illustration shows the train already crossing INTO the destination block.
  // The dimension is the POSITIVE penetration of its LEADING edge.
  const trainLengthPx = engineWidth + wagonWidth;
  const illustratedOverlapPx = 74;
  const trainStartA = entryA - illustratedOverlapPx; // Reverse: front is LEFT edge.
  const trainStartC = entryC + illustratedOverlapPx - trainLengthPx; // Forward: front is RIGHT edge.
  const trainFrontA = trainStartA;
  const trainFrontC = trainStartC + trainLengthPx;
  const trackY = 106;
  const trainY = trackY - 2 - trainHeight;
  const measurementY = trainY - 12;

  const train = (x: number, key: string) => {
    const engineX = mode === "pull" ? x + wagonWidth : x;
    const wagonX = mode === "pull" ? x : x + engineWidth;
    return (
      <g key={key}>
        <image href="/images/bobo.png" x={engineX} y={trainY}
          width={engineWidth} height={trainHeight} preserveAspectRatio="xMidYMid meet" />
        <image href="/images/vagon.png" x={wagonX} y={trackY - 2 - trainHeight}
          width={wagonWidth} height={trainHeight} preserveAspectRatio="xMidYMid meet" />
      </g>
    );
  };

  return (
    <Card withBorder p="sm">
      <Text fw={600} size="sm" mb={4}>{t("precisionBrakingMeasurement.title")}</Text>
      <svg viewBox="0 0 650 184" width="100%" role="img"
        aria-label={t("precisionBrakingMeasurement.diagramAria")}>
        <defs>
          <marker id="braking-forward-head" viewBox="0 0 6 6"
            markerUnits="userSpaceOnUse" markerWidth="5" markerHeight="5"
            refX="6" refY="3" orient="auto">
            <path d="M0 0 L6 3 L0 6 Z" fill="#3b82f6" />
          </marker>
          <marker id="braking-measure-head" viewBox="0 0 6 6"
            markerUnits="userSpaceOnUse" markerWidth="5" markerHeight="5"
            refX="6" refY="3" orient="auto-start-reverse">
            <path d="M0 0 L6 3 L0 6 Z" fill="#dc2626" />
          </marker>
        </defs>
        {blocks.map(block => (
          <g key={block.name}>
            <text x={block.x + blockWidth / 2} y="144"
              fontSize="17" fontWeight="700" textAnchor="middle"
              fill="currentColor">{block.name}</text>
          </g>
        ))}
        <text x="325" y="16" fill="currentColor" fontSize="13" textAnchor="middle">{t("precisionBrakingMeasurement.forward")}</text>
        <path d="M235 31 H415" stroke="#3b82f6" strokeWidth="1.5"
          fill="none" markerEnd="url(#braking-forward-head)" />
        {/* Minimal single-line track with unobtrusive short sleepers. */}
        {Array.from({ length: 68 }, (_, i) => (
          <line key={i}
            x1={26 + i * 9} y1={trackY - 2}
            x2={26 + i * 9} y2={trackY + 0}
            stroke="#8b7355" strokeWidth="1.3" />
        ))}
        <line x1={18} y1={trackY} x2={632} y2={trackY}
          stroke="#64748b" strokeWidth="1.8" />
        {[entryA, entryC].map(x => <path key={x} d={`M${x} 49 V155`}
          stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" />)}
        {train(trainStartA, "origin")}
        {train(trainStartC, "destination")}
        {/* The arrow spans the block entry line to the TRAIN FRONT, never the rear. */}
        <path d={`M${entryA} ${measurementY} H${trainFrontA}`}
          stroke="#dc2626" strokeWidth="1.4" fill="none"
          markerStart="url(#braking-measure-head)"
          markerEnd="url(#braking-measure-head)" />
        <path d={`M${trainFrontA} ${measurementY + 3} V${trainY}`}
          stroke="#dc2626" strokeWidth="1" strokeDasharray="2 2" />
        <text x={(entryA + trainFrontA) / 2} y={measurementY - 7}
          fontSize="10" textAnchor="middle" fill="#dc2626">
          {t("precisionBrakingMeasurement.distance")}
        </text>
        <path d={`M${entryC} ${measurementY} H${trainFrontC}`}
          stroke="#dc2626" strokeWidth="1.4" fill="none"
          markerStart="url(#braking-measure-head)"
          markerEnd="url(#braking-measure-head)" />
        <path d={`M${trainFrontC} ${measurementY + 3} V${trainY}`}
          stroke="#dc2626" strokeWidth="1" strokeDasharray="2 2" />
        <text x={(entryC + trainFrontC) / 2} y={measurementY - 7}
          fontSize="10" textAnchor="middle" fill="#dc2626">
          {t("precisionBrakingMeasurement.distance")}
        </text>
        <text x="325" y="176" textAnchor="middle" fill="currentColor" fontSize="11">
          {t(mode === "pull" ? "precisionBrakingMeasurement.pull" : "precisionBrakingMeasurement.push")}
          {" · "}{t("precisionBrakingMeasurement.locomotive")} {locomotiveLengthMm} mm
          {" · "}{t("precisionBrakingMeasurement.wagons")} {wagonsLengthMm} mm
          {sourceBlockLengthMm > 0 ? ` · A ${sourceBlockLengthMm} mm` : ""}
          {blockLengthMm > 0 ? ` · C ${blockLengthMm} mm` : ""}
        </text>
      </svg>
      <Text size="xs" c="dimmed">
        {t("precisionBrakingMeasurement.diagramHelp")}
      </Text>
    </Card>
  );
}
