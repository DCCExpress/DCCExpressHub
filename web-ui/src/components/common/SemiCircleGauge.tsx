import { useId } from "react";
import { Box, Stack, Text } from "@mantine/core";

/**
 * Reusable, responsive 180° meter. Values are clamped only for rendering;
 * the actual reading and maximum remain visible for diagnostics.
 */
export type SemiCircleGaugeProps = {
  value: number;
  max: number;
  label?: string;
  unit?: string;
  maxLabel?: string;
  colorFrom?: string;
  colorTo?: string;
  width?: number;
  precision?: number;
};

const ARC_LENGTH = Math.PI * 94;

export default function SemiCircleGauge({
  value,
  max,
  label = "Current",
  unit = "",
  maxLabel = "Peak",
  colorFrom = "#24d5db",
  colorTo = "#775bff",
  width = 320,
  precision = 0,
}: SemiCircleGaugeProps) {
  const gradientId = useId().replace(/:/g, "");
  const glowId = useId().replace(/:/g, "");
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const safeMax = Number.isFinite(max) ? Math.max(0, max) : 0;
  const ratio = safeMax > 0 ? Math.min(1, safeValue / safeMax) : 0;
  const formattedValue = safeValue.toFixed(precision);
  const formattedMax = safeMax.toFixed(precision);
  const path = "M 16 116 A 94 94 0 0 1 204 116";

  return (
    <Box
      style={{ width: "100%", maxWidth: width, marginInline: "auto" }}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax || 1}
      aria-valuenow={Math.min(safeValue, safeMax || 1)}
      aria-valuetext={`${formattedValue} ${unit}, ${maxLabel} ${formattedMax} ${unit}`}
    >
      <svg viewBox="0 0 220 150" width="100%" style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={colorFrom} />
            <stop offset="100%" stopColor={colorTo} />
          </linearGradient>
          <filter id={glowId} x="-60%" y="-100%" width="220%" height="300%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
        </defs>
        <path d={path} fill="none" stroke="var(--mantine-color-default-border)" strokeWidth="16" strokeLinecap="round" opacity={0.55} />
        <path
          d={path}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="17"
          strokeLinecap="round"
          opacity={0.38}
          filter={`url(#${glowId})`}
          strokeDasharray={ARC_LENGTH}
          strokeDashoffset={ARC_LENGTH * (1 - ratio)}
          style={{ transition: "stroke-dashoffset 650ms cubic-bezier(.2,.8,.2,1)" }}
        />
        <path
          d={path}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={ARC_LENGTH}
          strokeDashoffset={ARC_LENGTH * (1 - ratio)}
          style={{ transition: "stroke-dashoffset 650ms cubic-bezier(.2,.8,.2,1)" }}
        />
        <text x="110" y="92" textAnchor="middle" fill="currentColor" fontSize="34" fontWeight="750" style={{ fontVariantNumeric: "tabular-nums" }}>{formattedValue}</text>
        <text x="110" y="111" textAnchor="middle" fill="var(--mantine-color-dimmed)" fontSize="12">{unit}</text>
        <text x="16" y="140" fill="var(--mantine-color-dimmed)" fontSize="10">0</text>
        <text x="204" y="140" textAnchor="end" fill="var(--mantine-color-dimmed)" fontSize="10">{formattedMax}</text>
      </svg>
      <Stack gap={0} align="center" mt={-4}>
        <Text fw={700} size="sm">{label}</Text>
        <Text size="xs" c="dimmed">{maxLabel}: {formattedMax} {unit} · {Math.round(ratio * 100)}%</Text>
      </Stack>
    </Box>
  );
}
