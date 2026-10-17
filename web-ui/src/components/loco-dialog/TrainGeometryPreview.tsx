import { Card, Group, SegmentedControl, Stack, Text } from "@mantine/core";
import { useState } from "react";

type ConsistMode = "pull" | "push";

type Props = {
  trainLengthMm: number;
  locomotiveLengthMm: number;
  wagonsLengthMm: number;
  entireTrainDetectable: boolean;
  clearanceMarginMm: number;
};

export default function TrainGeometryPreview({
  trainLengthMm,
  locomotiveLengthMm,
  wagonsLengthMm,
  entireTrainDetectable,
  clearanceMarginMm,
}: Props) {
  const [mode, setMode] = useState<ConsistMode>("pull");
  const height = 40;
  const locomotiveWidth = 113 * height / 44;
  const wagonWidth = 264;
  const startX = (650 - locomotiveWidth - wagonWidth) / 2;
  const locomotiveX = mode === "pull" ? startX + wagonWidth : startX;
  const wagonX = mode === "pull" ? startX : startX + locomotiveWidth;
  const trackY = 156;
  const blockLeft = 100;
  const blockRight = 550;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center" wrap="wrap">
        <Text fw={600}>Train geometry</Text>
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={value => setMode(value as ConsistMode)}
          data={[{ label: "Pull", value: "pull" }, { label: "Push", value: "push" }]}
        />
      </Group>
      <Card withBorder p="sm">
        <svg viewBox="0 0 650 225" width="100%" role="img"
          aria-label={mode === "pull" ? "Train pulling to the right within a marked block" : "Train pushing to the right within a marked block"}>
          <defs>
            <marker id="train-geometry-forward-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto">
              <path d="M0 0 L8 4 L0 8 Z" fill="currentColor" />
            </marker>
          </defs>
          <text x="325" y="17" textAnchor="middle" fill="currentColor" fontSize="14">Forward</text>
          <path d="M170 33 H480" fill="none" stroke="currentColor" strokeWidth="3" markerEnd="url(#train-geometry-forward-arrow)" />

          {/* The consist sits about 80 px below the direction arrow. */}
          <image href="/images/bobo.png" x={locomotiveX} y="113"
            width={locomotiveWidth} height={height} preserveAspectRatio="xMidYMid meet" />
          <image href="/images/vagon.png" x={wagonX} y="113"
            width={wagonWidth} height={height} preserveAspectRatio="xMidYMid meet" />

          {/* Track sleepers and rails are purely illustrative. */}
          {Array.from({ length: 31 }, (_, index) => (
            <path key={index} d={`M${25 + index * 20} ${trackY - 7} v17`}
              stroke="#64748b" strokeWidth="3" />
          ))}
          <path d={`M20 ${trackY - 3} H630 M20 ${trackY + 6} H630`}
            fill="none" stroke="#94a3b8" strokeWidth="2" />

          {/* The highlighted block occupies only the section between boundary lines. */}
          <path d={`M${blockLeft} ${trackY + 2} H${blockRight}`}
            stroke="#ef4444" strokeWidth="7" strokeLinecap="butt" />
          <path d={`M${blockLeft} ${trackY - 23} V${trackY + 30} M${blockRight} ${trackY - 23} V${trackY + 30}`}
            stroke="#ef4444" strokeWidth="3" strokeDasharray="5 3" fill="none" />
          <text x="325" y="205" textAnchor="middle" fill="#ef4444" fontSize="13">Block</text>
        </svg>
      </Card>
      <Text size="xs" c="dimmed">
        Locomotive: {locomotiveLengthMm} mm · Wagons: {wagonsLengthMm} mm ·
        Total: {trainLengthMm} mm · Clearance: {clearanceMarginMm} mm
      </Text>
      <Text size="xs" c="dimmed">
        {entireTrainDetectable
          ? "Entire train electrically detectable: occupancy can remain ON until the last detectable wagon leaves."
          : "Locomotive-only detection: an OFF sensor does not prove the wagons have cleared the block."}
      </Text>
    </Stack>
  );
}
