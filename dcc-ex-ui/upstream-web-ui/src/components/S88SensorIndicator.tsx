import { Box, Stack, Text } from "@mantine/core";

export function S88SensorIndicator({ number, active, known }: {
  number: number;
  active: boolean;
  known: boolean;
}) {
  return (
    <Box
      title={known ? `S88 input ${number}: ${active ? "ON" : "OFF"}` : `S88 input ${number}: unknown`}
      aria-label={known ? `S88 input ${number} ${active ? "active" : "inactive"}` : `S88 input ${number} unknown`}
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: 6,
        minWidth: 36,
        padding: "8px 2px 5px",
        background: "var(--mantine-color-body)",
      }}
    >
      <Stack align="center" gap={5}>
        <Box
          style={{
            width: 11,
            height: 11,
            borderRadius: "50%",
            background: !known ? "var(--mantine-color-gray-5)" : active ? "var(--mantine-color-lime-5)" : "var(--mantine-color-dark-4)",
            boxShadow: known && active ? "0 0 7px var(--mantine-color-lime-5)" : undefined,
            border: "1px solid var(--mantine-color-default-border)",
          }}
        />
        <Text size="xs" fw={600} lh={1} ta="center" c={known && active ? "lime" : "dimmed"}>{number}</Text>
      </Stack>
    </Box>
  );
}
