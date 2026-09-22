import {
  Badge,
  Button,
  Group,
  NumberInput,
  ScrollArea,
  Table,
  Text,
} from "@mantine/core";

import { useEffect, useState } from "react";
import { wsApi } from "@/services/wsApi";
import type {
  DebugStateValue,
  ExtendedAccessoryDebugState,
} from "./useRuntimeDebugState";

type Props = {
  accessories: ExtendedAccessoryDebugState;
  connected: boolean;
};

type RowProps = {
  address: number;
  state: DebugStateValue<number>;
  connected: boolean;
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function ExtendedAccessoryRow({ address, state, connected }: RowProps) {
  const [value, setValue] = useState<number | string>(state.value);
  useEffect(() => setValue(state.value), [state.value]);

  const parsedValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  const valid = Number.isInteger(parsedValue) && parsedValue >= 0 && parsedValue <= 255;

  return (
    <Table.Tr>
      <Table.Td><Badge variant="light" color="gray">{address}</Badge></Table.Td>
      <Table.Td><Badge color="violet" variant="light">{state.value}</Badge></Table.Td>
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          <NumberInput
            value={value}
            min={0}
            max={255}
            step={1}
            allowDecimal={false}
            allowNegative={false}
            clampBehavior="strict"
            disabled={!connected}
            onChange={setValue}
            w={110}
            aria-label={`Extended accessory ${address} value`}
          />
          <Button
            size="xs"
            variant="light"
            disabled={!connected || !valid}
            onClick={() => valid && wsApi.setSignalAspect(address, parsedValue)}
          >
            Set
          </Button>
        </Group>
      </Table.Td>
      <Table.Td><Text size="sm" c="dimmed">{formatTime(state.updatedAt)}</Text></Table.Td>
    </Table.Tr>
  );
}

export default function ExtendedAccessoryDebugTab({ accessories, connected }: Props) {
  const rows = [...accessories.entries()].sort(([a], [b]) => a - b);

  if (!rows.length) {
    return <Text c="dimmed" ta="center" py="xl">No extended accessory state received yet.</Text>;
  }

  return (
    <ScrollArea h="100%" type="auto" offsetScrollbars style={{ paddingBottom: 8 }}>
      <Table striped highlightOnHover withTableBorder stickyHeader verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Address</Table.Th>
            <Table.Th>Current value</Table.Th>
            <Table.Th>Control</Table.Th>
            <Table.Th>Last update</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(([address, state]) => (
            <ExtendedAccessoryRow
              key={address}
              address={address}
              state={state}
              connected={connected}
            />
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}
