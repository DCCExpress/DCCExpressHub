import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Table,
  Tabs,
  Text,
} from "@mantine/core";

import {
  IconPlayerPlay,
  IconRefresh,
  IconRoute,
} from "@tabler/icons-react";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import type {
  LayoutView,
} from "@/models/editor/core/LayoutView";

import type {
  ClientRouteGraphBuildResult,
} from "@/services/clientRouteGraphBuilder";

import {
  ensureClientRouteGraph,
} from "@/services/clientRouteGraphCache";

import {
  testRouteTurnoutStates,
} from "@/services/routeGraphTestExecutor";

import {
  showNotification,
} from "@mantine/notifications";

type RoutesDialogProps = {
  opened: boolean;
  onClose: () => void;
  layout: LayoutView;
  onGenerated?: () => void;
};

function turnoutText(
  states: ReadonlyArray<{
    address: number;
    closed: boolean;
  }>
): string {
  if (states.length === 0) {
    return "—";
  }

  return states
    .map(
      item =>
        `${item.address}:${item.closed ? "C" : "T"}`
    )
    .join(", ");
}

export default function RoutesDialog({
  opened,
  onClose,
  layout,
  onGenerated,
}: RoutesDialogProps) {
  const [
    result,
    setResult,
  ] = useState<ClientRouteGraphBuildResult | null>(
    null
  );

  const [
    error,
    setError,
  ] = useState<string | null>(
    null
  );

  const [
    generating,
    setGenerating,
  ] = useState(false);

  const [
    testingKey,
    setTestingKey,
  ] = useState<string | null>(
    null
  );

  const [
    revisionText,
    setRevisionText,
  ] = useState<string>(
    ""
  );

  const generate =
    useCallback(
      (
        force = false
      ) => {
        try {
          setGenerating(true);
          setError(null);

          const ensured =
            ensureClientRouteGraph(
              layout,
              {
                force,
              }
            );

          setResult(
            ensured.result
          );

          setRevisionText(
            `T${ensured.topologyRevision} / G${ensured.graphRevision}${ensured.rebuilt ? " · újraépítve" : " · cache"}`
          );

          if (ensured.rebuilt) {
            onGenerated?.();
          }
        } catch (buildError) {
          setResult(null);
          setRevisionText("");

          setError(
            buildError instanceof Error
              ? buildError.message
              : String(buildError)
          );
        } finally {
          setGenerating(false);
        }
      },
      [
        layout,
        onGenerated,
      ]
    );

  const testTurnouts =
    useCallback(
      async (
        key: string,
        label: string,
        turnoutStates: readonly {
          address: number;
          closed: boolean;
        }[]
      ) => {
        if (turnoutStates.length === 0) {
          showNotification({
            color: "blue",
            title: "Útvonalteszt",
            message:
              `${label}: ehhez a kapcsolathoz nem kell váltót állítani.`,
          });

          return;
        }

        try {
          setTestingKey(key);

          const sent =
            await testRouteTurnoutStates(
              layout,
              turnoutStates,
              500
            );

          showNotification({
            color: "green",
            title: "Útvonalteszt sikeres",
            message:
              `${label}: ${sent} váltóparancs elküldve.`,
          });
        } catch (testError) {
          showNotification({
            color: "red",
            title: "Útvonalteszt sikertelen",
            message:
              testError instanceof Error
                ? testError.message
                : String(testError),
          });
        } finally {
          setTestingKey(null);
        }
      },
      [layout]
    );

  useEffect(() => {
    if (!opened) {
      return;
    }

    generate(false);
  }, [
    opened,
    generate,
  ]);

  const nodes =
    result?.graph.nodes ?? [];

  const edges =
    result?.graph.edges ?? [];

  const routes =
    result?.routes ?? [];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconRoute size={19} />
          <Text fw={700}>
            Útvonalak
          </Text>
        </Group>
      }
      size="min(1200px, 94vw)"
      centered
    >
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap="xs">
            <Badge variant="light">
              {nodes.length} szegmens
            </Badge>

            <Badge variant="light">
              {edges.length} gráfél
            </Badge>

            <Badge variant="light">
              {routes.length} blokkútvonal
            </Badge>

            {revisionText && (
              <Badge
                variant="outline"
                color={
                  revisionText.includes("újraépítve")
                    ? "teal"
                    : "gray"
                }
              >
                {revisionText}
              </Badge>
            )}
          </Group>

          <Button
            size="xs"
            variant="light"
            leftSection={
              <IconRefresh size={15} />
            }
            loading={generating}
            onClick={() =>
              generate(true)
            }
          >
            Újragenerálás
          </Button>
        </Group>

        {error && (
          <Alert
            color="red"
            title="Gráf generálási hiba"
          >
            {error}
          </Alert>
        )}

        {!error && result && (
          <Tabs
            defaultValue="graph"
            keepMounted={false}
          >
            <Tabs.List>
              <Tabs.Tab value="graph">
                Gráf
              </Tabs.Tab>

              <Tabs.Tab value="segments">
                Szegmensek
              </Tabs.Tab>

              <Tabs.Tab value="routes">
                Útvonalhálózat
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel
              value="graph"
              pt="sm"
            >
              <ScrollArea.Autosize mah="60dvh">
                <Table
                  striped
                  highlightOnHover
                  withTableBorder
                  withColumnBorders
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>
                        Innen
                      </Table.Th>

                      <Table.Th>
                        Ide
                      </Table.Th>

                      <Table.Th>
                        Váltóállások
                      </Table.Th>

                      <Table.Th>
                        Menetirány
                      </Table.Th>

                      <Table.Th
                        style={{ width: 100 }}
                      >
                        Teszt
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>

                  <Table.Tbody>
                    {edges.map(
                      (edge, index) => (
                        <Table.Tr
                          key={`${edge.from.name}-${edge.to.name}-${index}`}
                        >
                          <Table.Td>
                            {edge.from.name}
                          </Table.Td>

                          <Table.Td>
                            {edge.to.name}
                          </Table.Td>

                          <Table.Td>
                            {turnoutText(
                              edge.turnoutStates
                            )}
                          </Table.Td>

                          <Table.Td>
                            {edge.locoDirection}
                          </Table.Td>

                          <Table.Td>
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={
                                <IconPlayerPlay size={14} />
                              }
                              loading={
                                testingKey ===
                                `edge-${index}`
                              }
                              disabled={
                                testingKey !== null &&
                                testingKey !== `edge-${index}`
                              }
                              onClick={() =>
                                void testTurnouts(
                                  `edge-${index}`,
                                  `${edge.from.name} → ${edge.to.name}`,
                                  edge.turnoutStates
                                )
                              }
                            >
                              Teszt
                            </Button>
                          </Table.Td>
                        </Table.Tr>
                      )
                    )}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            </Tabs.Panel>

            <Tabs.Panel
              value="segments"
              pt="sm"
            >
              <ScrollArea.Autosize mah="60dvh">
                <Table
                  striped
                  highlightOnHover
                  withTableBorder
                  withColumnBorders
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>
                        Szegmens
                      </Table.Th>

                      <Table.Th>
                        Hálózat
                      </Table.Th>

                      <Table.Th>
                        Sín elemek
                      </Table.Th>

                      <Table.Th>
                        Blokkok
                      </Table.Th>

                      <Table.Th>
                        Érzékelők
                      </Table.Th>

                      <Table.Th>
                        Jelzők
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>

                  <Table.Tbody>
                    {nodes.map(node => (
                      <Table.Tr key={node.name}>
                        <Table.Td>
                          {node.name}
                        </Table.Td>

                        <Table.Td>
                          {node.trackName || "—"}
                        </Table.Td>

                        <Table.Td>
                          {node.elementIds.join(", ")}
                        </Table.Td>

                        <Table.Td>
                          {node.blocks
                            .map(block => block.name)
                            .join(", ") || "—"}
                        </Table.Td>

                        <Table.Td>
                          {node.detectors
                            .map(item => item.address)
                            .join(", ") || "—"}
                        </Table.Td>

                        <Table.Td>
                          {node.signals
                            .map(item => item.address)
                            .join(", ") || "—"}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            </Tabs.Panel>

            <Tabs.Panel
              value="routes"
              pt="sm"
            >
              <ScrollArea.Autosize mah="60dvh">
                <Table
                  striped
                  highlightOnHover
                  withTableBorder
                  withColumnBorders
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>
                        Innen
                      </Table.Th>

                      <Table.Th>
                        Ide
                      </Table.Th>

                      <Table.Th>
                        Szegmenslánc
                      </Table.Th>

                      <Table.Th>
                        Váltóállások
                      </Table.Th>

                      <Table.Th>
                        Menetirány
                      </Table.Th>

                      <Table.Th
                        style={{ width: 100 }}
                      >
                        Teszt
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>

                  <Table.Tbody>
                    {routes.map(
                      (route, index) => (
                        <Table.Tr
                          key={`${route.fromBlock.id}-${route.toBlock.id}-${index}`}
                        >
                          <Table.Td>
                            {route.fromBlock.name}
                          </Table.Td>

                          <Table.Td>
                            {route.toBlock.name}
                          </Table.Td>

                          <Table.Td>
                            {route.solution.nodes
                              .map(node => node.name)
                              .join(" → ")}
                          </Table.Td>

                          <Table.Td>
                            {turnoutText(
                              route.solution.turnoutStates
                            )}
                          </Table.Td>

                          <Table.Td>
                            {route.solution.locoDirection}
                          </Table.Td>

                          <Table.Td>
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={
                                <IconPlayerPlay size={14} />
                              }
                              loading={
                                testingKey ===
                                `route-${index}`
                              }
                              disabled={
                                testingKey !== null &&
                                testingKey !== `route-${index}`
                              }
                              onClick={() =>
                                void testTurnouts(
                                  `route-${index}`,
                                  `${route.fromBlock.name} → ${route.toBlock.name}`,
                                  route.solution.turnoutStates
                                )
                              }
                            >
                              Teszt
                            </Button>
                          </Table.Td>
                        </Table.Tr>
                      )
                    )}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            </Tabs.Panel>
          </Tabs>
        )}
      </Stack>
    </Modal>
  );
}
