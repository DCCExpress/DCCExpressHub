import {
  Badge,
  Group,
  ScrollArea,
  Switch,
  Table,
  Text,
} from "@mantine/core";

import { wsApi } from "@/services/wsApi";
import DebugLayoutOwnerCells from "./DebugLayoutOwnerCells";
import type {
  BasicAccessoryDebugState,
  BasicAccessoryLayoutOwners,
} from "./useRuntimeDebugState";

type Props = {
  accessories: BasicAccessoryDebugState;
  vpinAccessories: BasicAccessoryDebugState;
  layoutOwners: BasicAccessoryLayoutOwners;
  connected: boolean;
  turnoutLocks: Map<number, string>;
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

export default function BasicAccessoryDebugTab({
  accessories,
  vpinAccessories,
  layoutOwners,
  connected,
  turnoutLocks,
}: Props) {
  const rows = [
    ...[...accessories.entries()].map(([address, state]) => ({ address, state, mode: "accessory" as const })),
    ...[...vpinAccessories.entries()].map(([address, state]) => ({ address, state, mode: "vpin" as const })),
  ].sort((a, b) => a.address - b.address || a.mode.localeCompare(b.mode));

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
            <Table.Th>Mode</Table.Th>
            <Table.Th>State</Table.Th>
            <Table.Th w={100}>Lock</Table.Th>
            <Table.Th>Control</Table.Th>
            <Table.Th>Last update</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(({ address, state, mode }) => {
            const lockOwner = turnoutLocks.get(address);
            const owners = layoutOwners.get(address) ?? [];

            return (
            <Table.Tr key={`${mode}:${address}`}>
              <Table.Td><Badge variant="light" color="gray">{address}</Badge></Table.Td>
              <DebugLayoutOwnerCells owners={owners} />
              <Table.Td><Badge color={mode === "vpin" ? "cyan" : "blue"} variant="light">{mode === "vpin" ? "DCC-EX VPIN" : "BASIC"}</Badge></Table.Td>
              <Table.Td>
                <Badge color={state.value ? "green" : "gray"} variant={state.value ? "filled" : "light"}>
                  {state.value ? "1 / ON" : "0 / OFF"}
                </Badge>
              </Table.Td>
              <Table.Td w={100}><Badge color="red" variant="light" title={lockOwner ?? ""} style={{ visibility: lockOwner ? "visible" : "hidden" }}>LOCKED</Badge></Table.Td>
              <Table.Td>
                <Group gap="xs">
                  <Switch
                    checked={state.value}
                    disabled={!connected || Boolean(lockOwner)}
                    onChange={event => {
                      const checked = event.currentTarget.checked;
                      if (mode === "vpin") wsApi.setVpin(address, checked);
                      else wsApi.setBasicAccessory(address, checked);
                    }}
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
