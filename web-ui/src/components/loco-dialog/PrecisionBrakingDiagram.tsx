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
  // Keep the entire consist visible while leaving room for a real measurement arrow.
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
  const trainStartA = 18 + 8;
  const trainStartC = entryC + 55;
  const trainRearA = trainStartA + engineWidth + wagonWidth;
  const trainRearC = trainStartC;
  const trackY = 106;
  const measurementY = trackY - 4 - trainHeight / 2;

  const train = (x: number, key: string) => {
    const engineX = mode === "pull" ? x + wagonWidth : x;
    const wagonX = mode === "pull" ? x : x + engineWidth;
    return (
      <g key={key}>
        <image href="/images/bobo.png" x={engineX} y={trackY - 4 - trainHeight}
          width={engineWidth} height={trainHeight} preserveAspectRatio="xMidYMid meet" />
        <image href="/images/vagon.png" x={wagonX} y={trackY - 4 - trainHeight}
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
        {Array.from({ length: 41 }, (_, i) => (
          <path key={i} d={`M${19 + i * 15} ${trackY - 8} v18`}
            stroke="#8b7355" strokeWidth="3" />
        ))}
        <path d={`M18 ${trackY - 4} H632 M18 ${trackY + 6} H632`}
          stroke="#64748b" strokeWidth="2.5" fill="none" />
        {[entryA, entryC].map(x => <path key={x} d={`M${x} 49 V155`}
          stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" />)}
        {train(trainStartA, "origin")}
        {train(trainStartC, "destination")}
        {/* The end of each arrow shares the exact x coordinate of the dashed
            entry boundary and the outer edge of the last vehicle image. */}
        <path d={`M${entryA} ${measurementY} H${trainRearA}`}
          stroke="#dc2626" strokeWidth="1.4" fill="none"
          markerStart="url(#braking-measure-head)"
          markerEnd="url(#braking-measure-head)" />
        <text x={(entryA + trainRearA) / 2} y="82" fontSize="10"
          textAnchor="middle" fill="#dc2626">
          {t("precisionBrakingMeasurement.distance")}
        </text>
        <path d={`M${entryC} ${measurementY} H${trainRearC}`}
          stroke="#dc2626" strokeWidth="1.4" fill="none"
          markerStart="url(#braking-measure-head)"
          markerEnd="url(#braking-measure-head)" />
        <text x={(entryC + trainRearC) / 2} y="82" fontSize="10"
          textAnchor="middle" fill="#dc2626">
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
