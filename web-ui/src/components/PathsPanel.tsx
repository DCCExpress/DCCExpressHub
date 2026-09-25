import {
  Alert,
  Button,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
} from "@mantine/core";

import {
  IconRefresh,
} from "@tabler/icons-react";

import {
  useState,
} from "react";

import {
  showNotification,
} from "@mantine/notifications";

import type {
  LayoutView,
} from "@/models/editor/core/LayoutView";

import {
  ensureClientRouteGraph,
  getFreshClientRouteGraphResult,
} from "@/services/clientRouteGraphCache";

import {
  testRouteTurnoutStates,
} from "@/services/routeGraphTestExecutor";

type PathsPanelProps = {
  layout: LayoutView;
  invalidate: () => void;
};

function directionArrow(
  direction:
    | "unknown"
    | "forward"
    | "reverse"
): string {
  if (direction === "forward") {
    return "→";
  }

  if (direction === "reverse") {
    return "←";
  }

  return "—";
}

export default function PathsPanel({
  layout,
  invalidate,
}: PathsPanelProps) {
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
    error,
    setError,
  ] = useState<string | null>(
    null
  );

  /*
   * No auto-build here.
   * If the topology fingerprint changed, this returns null and the user must
   * Generate (or Save) before testing stale routes.
   */
  const freshResult =
    getFreshClientRouteGraphResult(
      layout
    );

  const routes =
    freshResult?.routes ?? [];

  const generate = () => {
    try {
      setGenerating(true);
      setError(null);

      const ensured =
        ensureClientRouteGraph(
          layout,
          {
            force: true,
          }
        );

      invalidate();

      showNotification({
        color: "green",
        title: "Paths",
        message:
          `${ensured.result.routes.length} útvonal generálva.`,
      });
    } catch (buildError) {
      const message =
        buildError instanceof Error
          ? buildError.message
          : String(buildError);

      setError(message);

      showNotification({
        color: "red",
        title: "Paths generálás sikertelen",
        message,
      });
    } finally {
      setGenerating(false);
    }
  };

  const setPath =
    async (
      key: string,
      fromName: string,
      toName: string,
      turnoutStates: readonly {
        address: number;
        closed: boolean;
      }[]
    ) => {
      try {
        setTestingKey(key);
        setError(null);

        const sent =
          await testRouteTurnoutStates(
            layout,
            turnoutStates,
            500
          );

        invalidate();

        showNotification({
          color: "green",
          title: "Path beállítva",
          message:
            `${fromName} → ${toName}: ${sent} váltóparancs.`,
        });
      } catch (setErrorValue) {
        const message =
          setErrorValue instanceof Error
            ? setErrorValue.message
            : String(setErrorValue);

        setError(message);

        showNotification({
          color: "red",
          title: "Path beállítás sikertelen",
          message,
        });
      } finally {
        setTestingKey(null);
      }
    };

  return (
    <Stack
      h="100%"
      gap="xs"
    >
      <Group
        justify="space-between"
        wrap="nowrap"
      >
        <Text
          size="sm"
          c="dimmed"
        >
          Gyors blokkútvonal teszt
        </Text>

        <Button
          size="xs"
          variant="light"
          leftSection={
            <IconRefresh size={14} />
          }
          loading={generating}
          disabled={
            testingKey !== null
          }
          onClick={generate}
        >
          Generálás
        </Button>
      </Group>

      {error && (
        <Alert
          color="red"
          title="Hiba"
        >
          {error}
        </Alert>
      )}

      {routes.length === 0 ? (
        <Text
          size="sm"
          c="dimmed"
          ta="center"
          py="md"
        >
          Nincs friss útvonalhálózat. Nyomd meg a Generálás gombot,
          vagy mentsd el a layoutot.
        </Text>
      ) : (
        <ScrollArea
          style={{
            flex: 1,
            minHeight: 0,
          }}
        >
          <Table
            striped
            highlightOnHover
            withTableBorder
            withColumnBorders
            verticalSpacing="xs"
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>
                  Path
                </Table.Th>

                <Table.Th
                  ta="center"
                  style={{
                    width: 64,
                  }}
                >
                  Irány
                </Table.Th>

                <Table.Th
                  style={{
                    width: 86,
                  }}
                >
                  &nbsp;
                </Table.Th>
              </Table.Tr>
            </Table.Thead>

            <Table.Tbody>
              {routes.map(
                (
                  route,
                  index
                ) => {
                  const key =
                    `${route.fromBlock.id}-${route.toBlock.id}-${index}`;

                  return (
                    <Table.Tr
                      key={key}
                    >
                      <Table.Td>
                        <Text
                          fw={600}
                          size="sm"
                        >
                          {route.fromBlock.name}
                          {" → "}
                          {route.toBlock.name}
                        </Text>
                      </Table.Td>

                      <Table.Td
                        ta="center"
                      >
                        <Text
                          fw={700}
                          size="xl"
                          lh={1}
                          title={
                            route.solution.locoDirection
                          }
                        >
                          {directionArrow(
                            route.solution.locoDirection
                          )}
                        </Text>
                      </Table.Td>

                      <Table.Td>
                        <Button
                          size="xs"
                          fullWidth
                          variant="light"
                          loading={
                            testingKey === key
                          }
                          disabled={
                            generating ||
                            (
                              testingKey !== null &&
                              testingKey !== key
                            )
                          }
                          onClick={() =>
                            void setPath(
                              key,
                              route.fromBlock.name,
                              route.toBlock.name,
                              route.solution.turnoutStates
                            )
                          }
                        >
                          SET
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  );
                }
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Stack>
  );
}
