import { Card, Group, SegmentedControl, Stack, Text } from "@mantine/core";
import { useState } from "react";

type Direction = "forward" | "reverse";

type Props = {
  trainLengthMm: number;
  entireTrainDetectable: boolean;
  clearanceMarginMm: number;
};

export default function TrainGeometryPreview({
  trainLengthMm,
  entireTrainDetectable,
  clearanceMarginMm,
}: Props) {
  const [direction, setDirection] = useState<Direction>("forward");
  const length = Math.max(1, trainLengthMm);
  const margin = Math.max(0, clearanceMarginMm);
  const left = 54;
  const width = 540;
  const locoAtLeft = direction === "reverse";
  const locoWidth = 112;
  const locoX = locoAtLeft ? left : left + width - locoWidth;
  const reserveWidth = Math.min(36, Math.max(6, margin / length * width));
  const trainStart = left;
  const blockStart = 140;
  const blockEnd = 510;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center" wrap="wrap">
        <Text fw={600}>Train geometry preview</Text>
        <SegmentedControl size="xs" value={direction} onChange={value => setDirection(value as Direction)}
          data={[{ label: "Forward", value: "forward" }, { label: "Reverse", value: "reverse" }]} />
      </Group>
      <Text size="xs" c="dimmed">The entire block detects current consumption, not a point sensor. Forward/Reverse changes the direction of travel.</Text>
      <Card withBorder p="xs">
        <svg viewBox="0 0 650 180" width="100%" role="img" aria-label="Schematic train footprint and locomotive in the clearance envelope">
          <rect x={left - reserveWidth} y="56" width={width + reserveWidth * 2} height="70" rx="6" fill="#f59e0b" fillOpacity=".11" stroke="#d97706" strokeDasharray="5 4" />
          <path d="M30 114 H622" stroke="#64748b" strokeWidth="3" />
          {Array.from({ length: 28 }, (_, i) => <path key={i} d={`M${34 + i * 22} 109 v10`} stroke="#64748b" strokeWidth="2" />)}
          <rect x={left} y="72" width={width} height="35" rx="3" fill="#60a5fa" fillOpacity=".4" stroke="#2563eb" />
          <rect x={locoX} y="72" width={locoWidth} height="35" rx="3" fill="#f97316" fillOpacity=".7" stroke="#c2410c" />
          <text x={locoX + locoWidth / 2} y="92" fill="#431407" fontSize="11" textAnchor="middle">LOCO</text>

          <text x={left} y="149" fill="currentColor" fontSize="12">{direction === "forward" ? "Reverse end" : "Forward end"}</text>
          <text x={left + width} y="149" fill="currentColor" fontSize="12" textAnchor="end">{direction === "forward" ? "Forward end" : "Reverse end"}</text>
          <text x="325" y="17" textAnchor="middle" fill="currentColor" fontSize="13">Train length: {length} mm · Margin: {margin} mm/side</text>
          <text x="325" y="171" textAnchor="middle" fill="currentColor" fontSize="12">Motion: {direction === "forward" ? "→" : "←"} (preview only)</text>
        </svg>
      </Card>
      <Text fw={600} size="sm">Block occupancy example</Text>
      <Card withBorder p="xs">
        <svg viewBox="0 0 650 115" width="100%" role="img" aria-label="Example block and schematic train footprint">
          <rect x={blockStart} y="12" width={blockEnd - blockStart} height="75" fill="#22c55e" fillOpacity=".10" stroke="#16a34a" strokeDasharray="5 4" />
          <text x={blockStart + 6} y="25" fontSize="12" fill="currentColor">Example block</text>
          <path d="M22 66 H625" stroke="#64748b" strokeWidth="3" />
          <rect x={trainStart - reserveWidth} y="36" width={width + 2 * reserveWidth} height="51" rx="4" fill="#f59e0b" fillOpacity=".12" stroke="#d97706" strokeDasharray="4 3" />
          <rect x={trainStart} y="44" width={width} height="35" rx="3" fill="#60a5fa" fillOpacity=".4" stroke="#2563eb" />
          <rect x={locoX} y="44" width={locoWidth} height="35" rx="3" fill="#f97316" fillOpacity=".7" stroke="#c2410c" />
          <text x={locoX + locoWidth / 2} y="64" fill="#431407" fontSize="11" textAnchor="middle">LOCO</text>
          <text x="325" y="105" fontSize="12" fill="currentColor" textAnchor="middle">Illustration only — not a measured block or clearance authorization</text>
        </svg>
      </Card>
      <Text size="xs" c="dimmed">{entireTrainDetectable
        ? "Entire train detectable: the block may remain ON until the final detectable vehicle leaves. This still requires verified sensor coverage and a stable OFF transition before release."
        : "Locomotive-only detection: the block can show OFF while undetected wagons remain inside. Retain rear-block reservations until the train tail is independently proven clear."}</Text>
    </Stack>
  );
}
