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

import {
  useTranslation,
} from "react-i18next";

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
  const { t } = useTranslation();

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

  const [
    revisionRebuilt,
    setRevisionRebuilt,
  ] = useState(false);

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
            `T${ensured.topologyRevision} / G${ensured.graphRevision} · ${ensured.rebuilt ? t("ui.rebuilt") : t("ui.cached")}`
          );
          setRevisionRebuilt(
            ensured.rebuilt
          );

          if (ensured.rebuilt) {
            onGenerated?.();
          }
        } catch (buildError) {
          setResult(null);
          setRevisionText("");
          setRevisionRebuilt(false);

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
        t,
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
            title: t("ui.routeTest"),
            message: t(
              "ui.routeTestNoTurnoutRequired",
              { value1: label }
            ),
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
            title: t("ui.routeTestSucceeded"),
            message: t(
              "ui.routeTestCommandsSent",
              {
                value1: label,
                value2: sent,
              }
            ),
          });
        } catch (testError) {
          showNotification({
            color: "red",
            title: t("ui.routeTestFailed"),
            message:
              testError instanceof Error
                ? testError.message
                : String(testError),
          });
        } finally {
          setTestingKey(null);
        }
      },
      [
        layout,
        t,
      ]
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
            {t("ui.routes")}
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
              {t("ui.segmentsCount", { value1: nodes.length })}
            </Badge>

            <Badge variant="light">
              {t("ui.graphEdgesCount", { value1: edges.length })}
            </Badge>

            <Badge variant="light">
              {t("ui.blockRoutesCount", { value1: routes.length })}
            </Badge>

            {revisionText && (
              <Badge
                variant="outline"
                color={
                  revisionRebuilt
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
            {t("ui.regenerate")}
          </Button>
        </Group>

        {error && (
          <Alert
            color="red"
            title={t("ui.graphGenerationError")}
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
                {t("ui.graph")}
              </Tabs.Tab>

              <Tabs.Tab value="segments">
                {t("ui.segments")}
              </Tabs.Tab>

              <Tabs.Tab value="routes">
                {t("ui.routeNetwork")}
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
                        {t("ui.from")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.to")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.turnoutPositions")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.direction")}
                      </Table.Th>

                      <Table.Th
                        style={{ width: 100 }}
                      >
                        {t("ui.test")}
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
                            {edge.locoDirection === "forward"
                              ? t("ui.forward")
                              : edge.locoDirection === "reverse"
                                ? t("ui.reverse")
                                : t("ui.unknown")}
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
                              {t("ui.test")}
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
                        {t("ui.segment")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.network")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.trackElements")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.blocks")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.detectors")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.signals")}
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
                        {t("ui.from")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.to")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.segment")}lánc
                      </Table.Th>

                      <Table.Th>
                        {t("ui.turnoutPositions")}
                      </Table.Th>

                      <Table.Th>
                        {t("ui.direction")}
                      </Table.Th>

                      <Table.Th
                        style={{ width: 100 }}
                      >
                        {t("ui.test")}
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
                            {route.solution.locoDirection === "forward"
                              ? t("ui.forward")
                              : route.solution.locoDirection === "reverse"
                                ? t("ui.reverse")
                                : t("ui.unknown")}
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
                              {t("ui.test")}
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
