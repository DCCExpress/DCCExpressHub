import { Badge, Box, Group, ScrollArea, Stack, Text, Tooltip } from "@mantine/core";

import DebugStateTable from "./DebugStateTable";
import type {
  DebugLayoutOwners,
  SensorDebugState,
} from "./useRuntimeDebugState";

type Props = {
  sensors: SensorDebugState;
  layoutOwners: DebugLayoutOwners;
};

export default function SensorDebugTab({
  sensors,
  layoutOwners,
}: Props) {
  const items = [...sensors.entries()].sort(([a], [b]) => a - b);
  const occupied = items.filter(([, state]) => state.value).length;

  return (
    <Stack h="100%" gap="sm" style={{ minHeight: 0 }}>
      <Box style={{ flexShrink: 0 }}>
        <Group gap="xs" mb="xs" justify="space-between">
          <Group gap="xs">
            <Text size="sm" fw={700}>Sensor overview</Text>
            <Badge color="gray" variant="light">{items.length} total</Badge>
            <Badge color="green" variant="light">{occupied} occupied</Badge>
            <Badge color="gray" variant="light">{items.length - occupied} free</Badge>
          </Group>
          <Text size="xs" c="dimmed">Live feedback</Text>
        </Group>
        <ScrollArea.Autosize mah={156} type="auto" offsetScrollbars>
          <Box
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))",
              gap: 6,
              padding: "2px 4px 6px 2px",
            }}
          >
            {items.map(([address, state]) => {
              const owners = layoutOwners.get(address) ?? [];
              return (
                <Tooltip
                  key={address}
                  label={`#${address} · ${state.value ? "OCCUPIED" : "FREE"}${owners.length ? " · " + owners.map(owner => owner.name).join(", ") : ""}`}
                  withArrow
                  multiline
                >
                  <Box
                    style={{
                      textAlign: "center",
                      padding: "6px 3px",
                      borderRadius: 7,
                      border: `1px solid var(--mantine-color-${state.value ? "green" : "gray"}-6)`,
                      background: state.value
                        ? "var(--mantine-color-green-light)"
                        : "var(--mantine-color-default-hover)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <Group gap={5} justify="center" wrap="nowrap">
                      <Box
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          flexShrink: 0,
                          background: state.value ? "var(--mantine-color-green-6)" : "var(--mantine-color-gray-5)",
                          boxShadow: state.value ? "0 0 6px var(--mantine-color-green-6)" : "none",
                        }}
                      />
                      <Text size="xs" fw={700}>{address}</Text>
                    </Group>
                  </Box>
                </Tooltip>
              );
            })}
            {items.length === 0 && <Text size="sm" c="dimmed">No sensor feedback yet.</Text>}
          </Box>
        </ScrollArea.Autosize>
      </Box>
      <Box style={{ flex: 1, minHeight: 0 }}>
        <DebugStateTable
          values={sensors}
          layoutOwners={layoutOwners}
          valueHeader="State"
          renderValue={on => (
            <Badge color={on ? "green" : "gray"} variant={on ? "filled" : "light"}>
              {on ? "ON / OCCUPIED" : "OFF / FREE"}
            </Badge>
          )}
        />
      </Box>
    </Stack>
  );
}
