import { Card, Group, SegmentedControl, Stack, Text } from "@mantine/core";
import { useState } from "react";

type Direction = "forward" | "reverse";

type Props = {
  trainLengthMm: number;
  detectionOffsetMm?: number | undefined;
  clearanceMarginMm: number;
};

function Wagon({ x, width }: { x: number; width: number }) {
  return (
    <g>
      <rect x={x} y={72} width={width} height={29} rx={4} fill="#60a5fa" stroke="#1e3a8a" strokeWidth={1.4} />
      <rect x={x + 5} y={75} width={width - 10} height={4} rx={2} fill="#bfdbfe" opacity={0.7} />
      {Array.from({ length: 4 }, (_, i) => (
        <rect key={i} x={x + 12 + i * (width - 24) / 4} y={83}
          width={Math.min(13, (width - 30) / 5)} height={10} rx={2}
          fill="#dbeafe" stroke="#2563eb" strokeWidth={0.8} />
      ))}
      <path d={`M${x + width - 15} 81 v19`} stroke="#1d4ed8" strokeWidth={1} />
    </g>
  );
}

function Locomotive({ x, width, facingRight }: { x: number; width: number; facingRight: boolean }) {
  // A side elevation: cab windows, nose, engine grilles, chassis and bogies.
  const cabX = facingRight ? x + width - 37 : x + 7;
  const noseX = facingRight ? x + width - 9 : x;
  return (
    <g>
      <rect x={x + 3} y={72} width={width - 6} height={29} rx={5}
        fill="#f97316" stroke="#9a3412" strokeWidth={1.6} />
      <path d={`M${x + 8} 72 H${x + width - 8}`} stroke="#fed7aa" strokeWidth={2} />
      <rect x={cabX} y={74} width={28} height={23} rx={3}
        fill="#ea580c" stroke="#9a3412" strokeWidth={1.1} />
      <rect x={cabX + 4} y={78} width={9} height={10} rx={1.5}
        fill="#bae6fd" stroke="#0369a1" strokeWidth={0.8} />
      <rect x={cabX + 15} y={78} width={9} height={10} rx={1.5}
        fill="#bae6fd" stroke="#0369a1" strokeWidth={0.8} />
      <path d={`M${x + 44} 79 h18 M${x + 44} 83 h18 M${x + 44} 87 h18`}
        stroke="#9a3412" strokeWidth={1.3} />
      <rect x={noseX} y={79} width={9} height={20} rx={2} fill="#c2410c" />
      <circle cx={facingRight ? x + width - 3 : x + 3} cy={84} r={2.6} fill="#fef08a" />
    </g>
  );
}

export default function TrainGeometryPreview({
  trainLengthMm,
  detectionOffsetMm,
  clearanceMarginMm,
}: Props) {
  const [direction, setDirection] = useState<Direction>("forward");
  const length = Math.max(1, trainLengthMm);
  const offsetKnown = detectionOffsetMm !== undefined && Number.isFinite(detectionOffsetMm);
  const offset = Math.max(0, Math.min(length, detectionOffsetMm ?? 0));
  const margin = Math.max(0, clearanceMarginMm);
  const left = 54;
  const width = 540;
  const marker = left + (direction === "forward" ? length - offset : offset) / length * width;
  const locoAtLeft = direction === "reverse";
  const cars = 3;
  const locoWidth = 112;
  const wagonWidth = (width - locoWidth - cars * 9) / cars;
  const boxes = Array.from({ length: cars }, (_, index) => ({
    x: locoAtLeft ? left + locoWidth + 9 + index * (wagonWidth + 9) : left + index * (wagonWidth + 9),
    width: wagonWidth,
  }));
  const locoX = locoAtLeft ? left : left + width - locoWidth;
  const reserveWidth = Math.min(36, Math.max(6, margin / length * width));
  const trainStart = marker - (direction === "forward" ? length - offset : offset) / length * width;
  const trainEnd = trainStart + width;
  const blockStart = 140;
  const blockEnd = 510;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center" wrap="wrap">
        <Text fw={600}>Train geometry preview</Text>
        <SegmentedControl size="xs" value={direction} onChange={value => setDirection(value as Direction)}
          data={[{ label: "Forward", value: "forward" }, { label: "Reverse", value: "reverse" }]} />
      </Group>
      <Text size="xs" c="dimmed">Direction changes only the illustration. The detection offset stays measured from the train's physical Forward end.</Text>
      <Card withBorder p="xs">
        <svg viewBox="0 0 650 180" width="100%" role="img" aria-label="Side view of locomotive, wagons, detection marker and clearance envelope">
          <rect x={left - reserveWidth} y="56" width={width + reserveWidth * 2} height="70" rx="6" fill="#f59e0b" fillOpacity=".11" stroke="#d97706" strokeDasharray="5 4" />
          <path d="M30 114 H622" stroke="#64748b" strokeWidth="3" />
          {Array.from({ length: 28 }, (_, i) => <path key={i} d={`M${34 + i * 22} 109 v10`} stroke="#64748b" strokeWidth="2" />)}
          {boxes.map((box, index) => <Wagon key={index} x={box.x} width={box.width} />)}
          <Locomotive x={locoX} width={locoWidth} facingRight={direction === "forward"} />
          {offsetKnown && <g>
            <path d={`M${marker} 45 V131`} stroke="#dc2626" strokeWidth="2.5" strokeDasharray="5 3" />
            <circle cx={marker} cy="89" r="5" fill="#dc2626" stroke="white" strokeWidth="1.5" />
            <text x={marker} y="38" textAnchor="middle" fill="#dc2626" fontSize="12">Sensor reference</text>
          </g>}
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
          {offsetKnown && <path d={`M${marker} 32 V91`} stroke="#dc2626" strokeWidth="2" strokeDasharray="4 3" />}
          <text x="325" y="105" fontSize="12" fill="currentColor" textAnchor="middle">Illustration only — not a measured block or clearance authorization</text>
        </svg>
      </Card>
      <Text size="xs" c="dimmed">{offsetKnown
        ? `Reference at ${offset.toFixed(0)} mm from forward end. Full train plus safety margin may overlap several blocks.`
        : "Detection reference is not configured. Automatic clearance cannot be inferred."}</Text>
    </Stack>
  );
}
