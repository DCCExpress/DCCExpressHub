import {
  Badge,
  ScrollArea,
  Table,
  Text,
} from "@mantine/core";

import type {
  ReactNode,
} from "react";

import type {
  DebugStateValue,
} from "./useRuntimeDebugState";

type Props<T> = {
  values: Map<
    number,
    DebugStateValue<T>
  >;

  valueHeader: string;

  renderValue: (
    value: T
  ) => ReactNode;
};

function formatTime(
  timestamp: number
): string {
  return new Date(
    timestamp
  ).toLocaleTimeString();
}

export default function DebugStateTable<T>({
  values,
  valueHeader,
  renderValue,
}: Props<T>) {
  const rows =
    [...values.entries()]
      .sort(
        ([left], [right]) =>
          left - right
      );

  if (rows.length === 0) {
    return (
      <Text
        c="dimmed"
        ta="center"
        py="xl"
      >
        No runtime state received yet.
      </Text>
    );
  }

  return (
    <ScrollArea
      h="100%"
      type="auto"
      offsetScrollbars
      style={{
        paddingBottom: 8,
      }}
    >
      <Table
        striped
        highlightOnHover
        withTableBorder
        stickyHeader
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              Address
            </Table.Th>

            <Table.Th>
              {valueHeader}
            </Table.Th>

            <Table.Th>
              Last update
            </Table.Th>
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          {rows.map(
            ([address, state]) => (
              <Table.Tr
                key={address}
              >
                <Table.Td>
                  <Badge
                    variant="light"
                    color="gray"
                  >
                    {address}
                  </Badge>
                </Table.Td>

                <Table.Td>
                  {renderValue(
                    state.value
                  )}
                </Table.Td>

                <Table.Td>
                  <Text
                    size="sm"
                    c="dimmed"
                  >
                    {formatTime(
                      state.updatedAt
                    )}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )
          )}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}
