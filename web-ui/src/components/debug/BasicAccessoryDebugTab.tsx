import {
  Badge,
  Group,
  ScrollArea,
  Switch,
  Table,
  Text,
} from "@mantine/core";

import { wsApi } from "@/services/wsApi";

import type {
  BasicAccessoryDebugState,
} from "./useRuntimeDebugState";

type Props = {
  accessories: BasicAccessoryDebugState;
  connected: boolean;
};

function formatTime(
  timestamp: number
): string {
  return new Date(timestamp).toLocaleTimeString();
}

export default function BasicAccessoryDebugTab({
  accessories,
  connected,
}: Props) {
  const rows=[...accessories.entries()].sort(([a],[b])=>a-b);

  if(!rows.length) {
    return <Text c="dimmed" ta="center" py="xl">No basic accessory state received yet.</Text>;
  }

  return <ScrollArea h="100%" type="auto" offsetScrollbars style={{paddingBottom:8}}>
    <Table striped highlightOnHover withTableBorder stickyHeader verticalSpacing="sm">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Address</Table.Th>
          <Table.Th>State</Table.Th>
          <Table.Th>Control</Table.Th>
          <Table.Th>Last update</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map(([address,state])=>
          <Table.Tr key={address}>
            <Table.Td><Badge variant="light" color="gray">{address}</Badge></Table.Td>
            <Table.Td>
              <Badge color={state.value?"green":"gray"} variant={state.value?"filled":"light"}>
                {state.value?"1 / ON":"0 / OFF"}
              </Badge>
            </Table.Td>
            <Table.Td>
              <Group gap="xs">
                <Switch
                  checked={state.value}
                  disabled={!connected}
                  onChange={event=>wsApi.setBasicAccessory(address,event.currentTarget.checked)}
                  aria-label={`Basic accessory ${address}`}
                />
                <Text size="xs" c="dimmed">{state.value?"ON":"OFF"}</Text>
              </Group>
            </Table.Td>
            <Table.Td><Text size="sm" c="dimmed">{formatTime(state.updatedAt)}</Text></Table.Td>
          </Table.Tr>
        )}
      </Table.Tbody>
    </Table>
  </ScrollArea>;
}
