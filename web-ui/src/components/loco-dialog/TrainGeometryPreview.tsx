import { Card, Group, SegmentedControl, Stack, Text } from "@mantine/core";
import { useState } from "react";

type Direction = "forward" | "reverse";

type Props = {
  trainLengthMm: number;
  detectionOffsetMm?: number | undefined;
  clearanceMarginMm: number;
};

function Wagon({ x, width, index }: { x: number; width: number; index: number }) {
  return (
    <g>
      <rect x={x} y={72} width={width} height={38} rx={5} fill="#60a5fa" stroke="#1e3a8a" strokeWidth={1.4} />
      <rect x={x + 5} y={76} width={width - 10} height={5} rx={2} fill="#bfdbfe" opacity={0.7} />
      {Array.from({ length: 4 }, (_, i) => (
        <rect key={i} x={x + 12 + i * (width - 24) / 4} y={84}
          width={Math.min(13, (width - 30) / 5)} height={11} rx={2}
          fill="#dbeafe" stroke="#2563eb" strokeWidth={0.8} />
      ))}
      <path d={`M${x + width - 15} 83 v20`} stroke="#1d4ed8" strokeWidth={1} />
      <text x={x + width / 2} y={106} textAnchor="middle" fontSize={9} fill="#1e3a8a">W{index + 1}</text>
    </g>
  );
}

function Locomotive({ x, width, facingRight }: { x: number; width: number; facingRight: boolean }) {
  const cabX = facingRight ? x + width - 34 : x + 6;
  const noseX = facingRight ? x + width - 8 : x;
  return (
    <g>
      <rect x={x + 4} y={71} width={width - 8} height={39} rx={6}
        fill="#f97316" stroke="#9a3412" strokeWidth={1.7} />
      <rect x={x + 12} y={76} width={width - 24} height={29} rx={4}
        fill="#fdba74" fillOpacity={0.5} />
      <rect x={cabX} y={74} width={28} height={33} rx={4}
        fill="#ea580c" stroke="#9a3412" strokeWidth={1.2} />
      <rect x={cabX + 5} y={78} width={18} height={12} rx={2}
        fill="#bae6fd" stroke="#0369a1" strokeWidth={1} />
      <rect x={cabX + 5} y={94} width={18} height={8} rx={2}
        fill="#bae6fd" stroke="#0369a1" strokeWidth={0.8} />
      <rect x={x + 39} y={80} width={28} height={14} rx={4}
        fill="#c2410c" fillOpacity={0.65} />
      <path d={`M${x + 43} 83 h20 M${x + 43} 87 h20 M${x + 43} 91 h20`}
        stroke="#fed7aa" strokeWidth={1.5} />
      <path d={`M${noseX + 4} 78 v23`} stroke="#7c2d12" strokeWidth={2} />
      <circle cx={facingRight ? x + width - 3 : x + 3} cy={80} r={2.5} fill="#fef08a" />
      <circle cx={facingRight ? x + width - 3 : x + 3} cy={102} r={2.5} fill="#fef08a" />
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
        <svg viewBox="0 0 650 180" width="100%" role="img" aria-label="Top view of locomotive, wagons, detection marker and clearance envelope">
          <rect x={left - reserveWidth} y="56" width={width + reserveWidth * 2} height="70" rx="6" fill="#f59e0b" fillOpacity=".11" stroke="#d97706" strokeDasharray="5 4" />
          <path d="M30 95 H622 M30 112 H622" stroke="#64748b" strokeWidth="3" />
          {Array.from({ length: 28 }, (_, i) => <path key={i} d={`M${34 + i * 22} 92 v24`} stroke="#64748b" strokeWidth="2" />)}
          {boxes.map((box, index) => <Wagon key={index} x={box.x} width={box.width} index={index} />)}
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
          <path d="M22 58 H625 M22 72 H625" stroke="#64748b" strokeWidth="3" />
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
