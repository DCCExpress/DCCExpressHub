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
  // A configured sensor without authoritative feedback is UNKNOWN, never FREE.
  const addresses = [...new Set([...layoutOwners.keys(), ...sensors.keys()])].sort((a, b) => a - b);
  const occupied = addresses.filter(address => sensors.get(address)?.value === true).length;
  const free = addresses.filter(address => sensors.get(address)?.value === false).length;
  const unknown = addresses.length - occupied - free;

  return (
    <Stack h="100%" gap="sm" style={{ minHeight: 0 }}>
      <Box style={{ flexShrink: 0 }}>
        <Group gap="xs" mb="xs" justify="space-between">
          <Group gap="xs">
            <Text size="sm" fw={700}>Sensor overview</Text>
            <Badge color="gray" variant="light">{addresses.length} total</Badge>
            <Badge color="green" variant="light">{occupied} occupied</Badge>
            <Badge color="gray" variant="light">{free} free</Badge>
            <Badge color="red" variant="light">{unknown} unknown</Badge>
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
            {addresses.map(address => {
              const state = sensors.get(address);
              const isUnknown = !state;
              const owners = layoutOwners.get(address) ?? [];
              return (
                <Tooltip
                  key={address}
                  label={`#${address} · ${isUnknown ? "UNKNOWN" : state.value ? "OCCUPIED" : "FREE"}${owners.length ? " · " + owners.map(owner => owner.name).join(", ") : ""}`}
                  withArrow
                  multiline
                >
                  <Box
                    style={{
                      textAlign: "center",
                      padding: "6px 3px",
                      borderRadius: 7,
                      border: `1px solid var(--mantine-color-${isUnknown ? "red" : state.value ? "green" : "gray"}-6)`,
                      background: isUnknown
                        ? "var(--mantine-color-red-light)"
                        : state.value ? "var(--mantine-color-green-light)" : "var(--mantine-color-default-hover)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <Stack gap={3} align="center">
                      {isUnknown ? (
                        <Text size="xs" fw={800} c="red">NA</Text>
                      ) : (
                        <Box
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: state.value ? "var(--mantine-color-green-6)" : "var(--mantine-color-gray-5)",
                            boxShadow: state.value ? "0 0 6px var(--mantine-color-green-6)" : "none",
                          }}
                        />
                      )}
                      <Text size="xs" fw={700}>{address}</Text>
                    </Stack>
                  </Box>
                </Tooltip>
              );
            })}
            {addresses.length === 0 && <Text size="sm" c="dimmed">No sensor feedback yet.</Text>}
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
