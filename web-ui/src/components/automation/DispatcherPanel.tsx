import {
  Badge,
  Button,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
} from "@mantine/core";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import i18next from "i18next";

import {
  wsApi,
} from "../../services/wsApi";

import {
  wsClient,
} from "../../services/wsClient";

type DispatcherLegLease = {
  ownerId?: string;
  ownerName?: string;
  locoAddress?: number;
  fromBlockId?: number;
  toBlockId?: number;
  turnoutAddresses?: number[];
  safetySensors?: number[];
  resourceKeys?: string[];
  acquiredAtMs?: number;
};

type DispatcherRouteLease = {
  ownerId?: string;
  ownerName?: string;
  locoAddress?: number;
  sourceBlockId?: number;
  destinationBlockId?: number;
  routeBlockIds?: number[];
  turnoutAddresses?: number[];
  resourceKeys?: string[];
  acquiredAtMs?: number;
};

type DispatcherSnapshot = {
  leases: DispatcherLegLease[];
  routes: DispatcherRouteLease[];
};

const emptySnapshot = (): DispatcherSnapshot => ({
  leases: [],
  routes: [],
});

function requestId(action: string): string {
  return (
    `${wsApi.clientUuid}:dispatcher-panel:${action}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2, 8)}`
  );
}

function numberList(values?: number[]): string {
  return values?.length
    ? values.join(", ")
    : "-";
}

export default function DispatcherPanel() {
  const [
    snapshot,
    setSnapshot,
  ] = useState<DispatcherSnapshot>(
    emptySnapshot
  );

  const refresh =
    useCallback(
      async (): Promise<void> => {
        try {
          const response =
            await wsApi.dispatcherRequest(
              requestId("snapshot"),
              "snapshot"
            );

          const extra =
            response.extra;

          setSnapshot({
            leases:
              Array.isArray(
                extra?.leases
              )
                ? extra!.leases as DispatcherLegLease[]
                : [],
            routes:
              Array.isArray(
                extra?.routes
              )
                ? extra!.routes as DispatcherRouteLease[]
                : [],
          });
        } catch {
          // The connection/status UI already reports transport failures.
        }
      },
      []
    );

  useEffect(
    () => {
      const unsubscribeChanged =
        wsClient.on(
          "dispatcherChanged",
          data => {
            setSnapshot({
              leases:
                Array.isArray(
                  data.leases
                )
                  ? data.leases as DispatcherLegLease[]
                  : [],
              routes:
                Array.isArray(
                  data.routes
                )
                  ? data.routes as DispatcherRouteLease[]
                  : [],
            });
          }
        );

      const unsubscribeStatus =
        wsClient.subscribeStatus(
          status => {
            if (
              status ===
                "connected"
            ) {
              void refresh();
            }
          }
        );

      if (
        wsClient.getStatus() ===
          "connected"
      ) {
        void refresh();
      }

      return () => {
        unsubscribeChanged();
        unsubscribeStatus();
      };
    },
    [
      refresh,
    ]
  );

  const releaseAll =
    async (): Promise<void> => {
      try {
        await wsApi.dispatcherRequest(
          requestId("releaseAll"),
          "releaseAll"
        );
      } finally {
        await refresh();
      }
    };

  return (
    <Stack
      gap="sm"
      h="100%"
    >
      <Group
        justify="space-between"
        align="center"
        wrap="wrap"
      >
        <Group gap="xs">
          <Text
            fw={700}
            size="sm"
          >
            {
              i18next.t(
                "ui.dispatcherTitle",
                {
                  defaultValue:
                    "Dispatcher",
                }
              )
            }
          </Text>

          <Badge
            size="sm"
            variant="light"
            color={
              snapshot.leases.length +
                snapshot.routes.length >
              0
                ? "green"
                : "gray"
            }
          >
            {
              snapshot.leases.length +
              snapshot.routes.length
            }
          </Badge>
        </Group>

        <Group gap="xs">
          <Button
            size="xs"
            variant="light"
            onClick={
              () =>
                void refresh()
            }
          >
            {
              i18next.t(
                "ui.refresh",
                {
                  defaultValue:
                    "Refresh",
                }
              )
            }
          </Button>

          <Button
            size="xs"
            variant="light"
            color="red"
            disabled={
              snapshot.leases.length ===
                0 &&
              snapshot.routes.length ===
                0
            }
            onClick={
              () =>
                void releaseAll()
            }
          >
            {
              i18next.t(
                "ui.releaseAll",
                {
                  defaultValue:
                    "Release all",
                }
              )
            }
          </Button>
        </Group>
      </Group>

      <Text
        size="xs"
        c="dimmed"
      >
        Backend-authoritative Dispatcher reservations. This panel does not execute routes in the browser.
      </Text>

      <ScrollArea
        type="auto"
        style={{
          flex: 1,
          minHeight: 0,
        }}
      >
        <Stack gap="md">
          <div>
            <Text
              size="sm"
              fw={700}
              mb={4}
            >
              Active leg leases
            </Text>

            <Table
              withTableBorder
              withColumnBorders
              striped
              highlightOnHover
              verticalSpacing={3}
              horizontalSpacing="xs"
              fz="xs"
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Owner</Table.Th>
                  <Table.Th>Loco</Table.Th>
                  <Table.Th>Leg</Table.Th>
                  <Table.Th>Turnouts</Table.Th>
                  <Table.Th>Safety sensors</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {
                  snapshot.leases.length ===
                    0
                    ? (
                      <Table.Tr>
                        <Table.Td colSpan={5}>
                          <Text
                            size="xs"
                            c="dimmed"
                          >
                            No active leg lease.
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    )
                    : snapshot.leases.map(
                        (
                          lease,
                          index
                        ) => (
                          <Table.Tr
                            key={
                              lease.ownerId ??
                              `leg-${index}`
                            }
                          >
                            <Table.Td>
                              {
                                lease.ownerName ??
                                lease.ownerId ??
                                "-"
                              }
                            </Table.Td>
                            <Table.Td ff="monospace">
                              {
                                lease.locoAddress
                                  ? `#${lease.locoAddress}`
                                  : "-"
                              }
                            </Table.Td>
                            <Table.Td ff="monospace">
                              {
                                `${lease.fromBlockId ?? "?"} → ${lease.toBlockId ?? "?"}`
                              }
                            </Table.Td>
                            <Table.Td ff="monospace">
                              {
                                numberList(
                                  lease.turnoutAddresses
                                )
                              }
                            </Table.Td>
                            <Table.Td ff="monospace">
                              {
                                numberList(
                                  lease.safetySensors
                                )
                              }
                            </Table.Td>
                          </Table.Tr>
                        )
                      )
                }
              </Table.Tbody>
            </Table>
          </div>

          <div>
            <Text
              size="sm"
              fw={700}
              mb={4}
            >
              Active route leases
            </Text>

            <Table
              withTableBorder
              withColumnBorders
              striped
              highlightOnHover
              verticalSpacing={3}
              horizontalSpacing="xs"
              fz="xs"
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Owner</Table.Th>
                  <Table.Th>Loco</Table.Th>
                  <Table.Th>Route</Table.Th>
                  <Table.Th>Blocks</Table.Th>
                  <Table.Th>Turnouts</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {
                  snapshot.routes.length ===
                    0
                    ? (
                      <Table.Tr>
                        <Table.Td colSpan={5}>
                          <Text
                            size="xs"
                            c="dimmed"
                          >
                            No active route lease.
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    )
                    : snapshot.routes.map(
                        (
                          lease,
                          index
                        ) => (
                          <Table.Tr
                            key={
                              lease.ownerId ??
                              `route-${index}`
                            }
                          >
                            <Table.Td>
                              {
                                lease.ownerName ??
                                lease.ownerId ??
                                "-"
                              }
                            </Table.Td>
                            <Table.Td ff="monospace">
                              {
                                lease.locoAddress
                                  ? `#${lease.locoAddress}`
                                  : "-"
                              }
                            </Table.Td>
                            <Table.Td ff="monospace">
                              {
                                `${lease.sourceBlockId ?? "?"} → ${lease.destinationBlockId ?? "?"}`
                              }
                            </Table.Td>
                            <Table.Td ff="monospace">
                              {
                                numberList(
                                  lease.routeBlockIds
                                )
                              }
                            </Table.Td>
                            <Table.Td ff="monospace">
                              {
                                numberList(
                                  lease.turnoutAddresses
                                )
                              }
                            </Table.Td>
                          </Table.Tr>
                        )
                      )
                }
              </Table.Tbody>
            </Table>
          </div>
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
