import {
  Badge,
  Group,
  ScrollArea,
  Stack,
  Switch,
  Table,
  Text,
} from "@mantine/core";

import { wsApi } from "@/services/wsApi";
import type {
  BasicAccessoryDebugState,
  BasicAccessoryLayoutOwners,
} from "./useRuntimeDebugState";

type Props = {
  accessories: BasicAccessoryDebugState;
  layoutOwners: BasicAccessoryLayoutOwners;
  connected: boolean;
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

export default function BasicAccessoryDebugTab({
  accessories,
  layoutOwners,
  connected,
}: Props) {
  const rows = [...accessories.entries()].sort(([a], [b]) => a - b);

  if (!rows.length) {
    return <Text c="dimmed" ta="center" py="xl">No basic accessory state received yet.</Text>;
  }

  return (
    <ScrollArea h="100%" type="auto" offsetScrollbars style={{ paddingBottom: 8 }}>
      <Table striped highlightOnHover withTableBorder stickyHeader verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Address</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th>Name</Table.Th>
            <Table.Th>State</Table.Th>
            <Table.Th>Control</Table.Th>
            <Table.Th>Last update</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(([address, state]) => {
            const owners = layoutOwners.get(address) ?? [];

            return (
            <Table.Tr key={address}>
              <Table.Td><Badge variant="light" color="gray">{address}</Badge></Table.Td>
              <Table.Td>
                {owners.length ? (
                  <Stack gap={2}>
                    {owners.map((owner, index) => (
                      <Badge
                        key={`${owner.type}:${owner.name}:${index}`}
                        variant="light"
                        color="blue"
                        size="sm"
                      >
                        {owner.type}
                      </Badge>
                    ))}
                  </Stack>
                ) : (
                  <Text size="sm" c="dimmed">—</Text>
                )}
              </Table.Td>
              <Table.Td>
                {owners.length ? (
                  <Stack gap={2}>
                    {owners.map((owner, index) => (
                      <Text
                        key={`${owner.type}:${owner.name}:${index}`}
                        size="sm"
                      >
                        {owner.name}
                      </Text>
                    ))}
                  </Stack>
                ) : (
                  <Text size="sm" c="dimmed">—</Text>
                )}
              </Table.Td>
              <Table.Td>
                <Badge color={state.value ? "green" : "gray"} variant={state.value ? "filled" : "light"}>
                  {state.value ? "1 / ON" : "0 / OFF"}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Group gap="xs">
                  <Switch
                    checked={state.value}
                    disabled={!connected}
                    onChange={event => wsApi.setBasicAccessory(address, event.currentTarget.checked)}
                    aria-label={`Basic accessory ${address}`}
                  />
                  <Text size="xs" c="dimmed">{state.value ? "ON" : "OFF"}</Text>
                </Group>
              </Table.Td>
              <Table.Td><Text size="sm" c="dimmed">{formatTime(state.updatedAt)}</Text></Table.Td>
            </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}
