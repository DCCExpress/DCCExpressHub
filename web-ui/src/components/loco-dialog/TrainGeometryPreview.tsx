import { Card, Group, SegmentedControl, Stack, Text } from "@mantine/core";
import { useState } from "react";

type ConsistMode = "pull" | "push";

type Props = {
  trainLengthMm: number;
  entireTrainDetectable: boolean;
  clearanceMarginMm: number;
};

/**
 * Forward is rightwards. The locomotive leads when pulling and remains
 * behind the wagon when pushing. Images are served from wwwroot/images.
 * This is a visual preview only; it does not change locomotive direction.
 */
export default function TrainGeometryPreview(_props: Props) {
  const [mode, setMode] = useState<ConsistMode>("pull");
  const imageHeight = 40;
  const locomotiveWidth = 113 * imageHeight / 44;
  const wagonWidth = 264;
  const trainStartX = (650 - locomotiveWidth - wagonWidth) / 2;
  const locomotiveX = mode === "pull" ? trainStartX + wagonWidth : trainStartX;
  const wagonX = mode === "pull" ? trainStartX : trainStartX + locomotiveWidth;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center" wrap="wrap">
        <Text fw={600}>Train geometry</Text>
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={value => setMode(value as ConsistMode)}
          data={[
            { label: "Pull", value: "pull" },
            { label: "Push", value: "push" },
          ]}
        />
      </Group>
      <Card withBorder p="sm">
        <svg
          viewBox="0 0 650 95"
          width="100%"
          role="img"
          aria-label={mode === "pull"
            ? "Forward direction: wagon followed by locomotive, locomotive pulling"
            : "Forward direction: locomotive followed by wagon, locomotive pushing"}
        >
          <defs>
            <marker
              id="train-geometry-forward-arrow"
              markerWidth="9"
              markerHeight="9"
              refX="8"
              refY="4"
              orient="auto"
            >
              <path d="M0 0 L8 4 L0 8 Z" fill="currentColor" />
            </marker>
          </defs>
          <text x="325" y="17" textAnchor="middle" fill="currentColor" fontSize="14">
            Forward
          </text>
          <path
            d="M170 34 H480"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            markerEnd="url(#train-geometry-forward-arrow)"
          />
          <image
            href="/images/bobo.png"
            x={locomotiveX}
            y="45"
            width={locomotiveWidth}
            height={imageHeight}
            preserveAspectRatio="xMidYMid meet"
          />
          <image
            href="/images/vagon.png"
            x={wagonX}
            y="45"
            width={wagonWidth}
            height={imageHeight}
            preserveAspectRatio="xMidYMid meet"
          />
        </svg>
      </Card>
    </Stack>
  );
}
