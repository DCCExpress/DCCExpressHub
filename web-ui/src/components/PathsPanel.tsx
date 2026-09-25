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

import {
  useTranslation,
} from "react-i18next";

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
  const { t } = useTranslation();

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
        title: t("ui.paths"),
        message: t(
          "ui.pathsGenerated",
          { value1: ensured.result.routes.length }
        ),
      });
    } catch (buildError) {
      const message =
        buildError instanceof Error
          ? buildError.message
          : String(buildError);

      setError(message);

      showNotification({
        color: "red",
        title: t("ui.pathsGenerationFailed"),
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
          title: t("ui.pathSet"),
          message: t(
            "ui.pathSetMessage",
            {
              value1: fromName,
              value2: toName,
              value3: sent,
            }
          ),
        });
      } catch (setErrorValue) {
        const message =
          setErrorValue instanceof Error
            ? setErrorValue.message
            : String(setErrorValue);

        setError(message);

        showNotification({
          color: "red",
          title: t("ui.pathSetFailed"),
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
          {t("ui.quickBlockRouteTest")}
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
          {t("ui.generate")}
        </Button>
      </Group>

      {error && (
        <Alert
          color="red"
          title={t("ui.error")}
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
          {t("ui.noFreshRouteNetwork")}
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
                  {t("ui.path")}
                </Table.Th>

                <Table.Th
                  ta="center"
                  style={{
                    width: 64,
                  }}
                >
                  {t("ui.direction")}
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
                          {t("ui.setPath")}
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
