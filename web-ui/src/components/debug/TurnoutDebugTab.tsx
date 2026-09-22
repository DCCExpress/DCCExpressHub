import {
  Badge,
  Button,
  Group,
  NumberInput,
  ScrollArea,
  Switch,
  Table,
  Text,
} from "@mantine/core";

import { useEffect, useState } from "react";
import { wsApi } from "@/services/wsApi";
import type {
  DebugStateValue,
  TurnoutDebugState,
  TurnoutDebugValue,
} from "./useRuntimeDebugState";

type Props = {
  turnouts: TurnoutDebugState;
  connected: boolean;
};

type ExtendedRowProps = {
  address: number;
  state: DebugStateValue<TurnoutDebugValue>;
  connected: boolean;
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function ExtendedTurnoutControl({ address, state, connected }: ExtendedRowProps) {
  const [value, setValue] = useState<number | string>(state.value.aspect ?? 0);

  useEffect(() => {
    if (state.value.aspect !== null) {
      setValue(state.value.aspect);
    }
  }, [state.value.aspect]);

  const parsedValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  const valid = Number.isInteger(parsedValue) && parsedValue >= 0 && parsedValue <= 255;

  return (
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
        w={100}
        aria-label={`Extended turnout ${address} aspect`}
      />

      <Button
        size="xs"
        variant="light"
        disabled={!connected || !valid}
        onClick={() => {
          if (!valid) return;
          wsApi.setSignalAspect(address, parsedValue);
        }}
      >
        Set
      </Button>
    </Group>
  );
}

export default function TurnoutDebugTab({ turnouts, connected }: Props) {
  const rows = [...turnouts.entries()].sort(([left], [right]) => left - right);

  if (!rows.length) {
    return <Text c="dimmed" ta="center" py="xl">No turnout runtime state received yet.</Text>;
  }

  return (
    <ScrollArea h="100%" type="auto" offsetScrollbars style={{ paddingBottom: 8 }}>
      <Table striped highlightOnHover withTableBorder stickyHeader verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Address</Table.Th>
            <Table.Th>Mode</Table.Th>
            <Table.Th>State</Table.Th>
            <Table.Th>Control</Table.Th>
            <Table.Th>Last update</Table.Th>
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          {rows.map(([address, state]) => {
            const value = state.value;

            return (
              <Table.Tr key={address}>
                <Table.Td><Badge variant="light" color="gray">{address}</Badge></Table.Td>

                <Table.Td>
                  <Badge
                    variant="light"
                    color={
                      value.outputMode === "extended"
                        ? "violet"
                        : value.outputMode === "vpin"
                          ? "cyan"
                          : "blue"
                    }
                  >
                    {value.outputMode === "extended"
                      ? "EXTENDED"
                      : value.outputMode === "vpin"
                        ? "VPIN"
                        : "BASIC"}
                  </Badge>
                </Table.Td>

                <Table.Td>
                  {value.outputMode === "extended" ? (
                    <Group gap="xs">
                      <Badge color="violet" variant="light">
                        Aspect {value.aspect ?? "?"}
                      </Badge>
                      <Text size="xs" c="dimmed">
                        C={value.closedAspect} / T={value.openedAspect}
                      </Text>
                      {value.logicalClosed !== null && (
                        <Badge color={value.logicalClosed ? "green" : "orange"} variant="light">
                          {value.logicalClosed ? "CLOSED" : "THROWN"}
                        </Badge>
                      )}
                    </Group>
                  ) : (
                    <Group gap="xs">
                      <Badge color={value.physicalValue ? "blue" : "orange"} variant="light">
                        {value.physicalValue ? "1" : "0"}
                      </Badge>
                      {value.logicalClosed !== null && (
                        <Badge color={value.logicalClosed ? "green" : "orange"} variant="light">
                          {value.logicalClosed ? "CLOSED" : "THROWN"}
                        </Badge>
                      )}
                    </Group>
                  )}
                </Table.Td>

                <Table.Td>
                  {value.outputMode === "extended" ? (
                    <ExtendedTurnoutControl
                      address={address}
                      state={state}
                      connected={connected}
                    />
                  ) : (
                    <Group gap="xs">
                      <Switch
                        checked={value.physicalValue}
                        disabled={!connected}
                        onChange={event => {
                          const next = event.currentTarget.checked;
                          if (value.outputMode === "vpin") {
                            wsApi.setVpin(address, next);
                          } else {
                            wsApi.setTurnout(address, next);
                          }
                        }}
                        aria-label={`Turnout ${address}`}
                      />
                      <Text size="xs" c="dimmed">{value.physicalValue ? "1" : "0"}</Text>
                    </Group>
                  )}
                </Table.Td>

                <Table.Td>
                  <Text size="sm" c="dimmed">{formatTime(state.updatedAt)}</Text>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}
