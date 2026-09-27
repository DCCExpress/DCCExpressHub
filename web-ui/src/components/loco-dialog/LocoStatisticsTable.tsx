import {
  Card,
  Group,
  Progress,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  Loco,
} from "@domain/types";

import LocoImage from "../loco/LocoImage";

import {
  getLocoCounterSnapshot,
  subscribeLocoCounterRuntime,
} from "../../services/locoCounterRuntime";

type Props = {
  locos:
    readonly Loco[];
  t: (
    key: string
  ) => string;
};

type StatisticsRow = {
  id: string;
  address: number;
  name: string;
  image?: string;
  dailyKm: number;
  totalKm: number;
  dailyHours: number;
  totalHours: number;
};

type StatisticsMetric =
  | "dailyKm"
  | "totalKm"
  | "dailyHours"
  | "totalHours";

function safeNumber(
  value: unknown
): number {
  const numeric =
    Number(
      value
    );

  return (
    Number.isFinite(
      numeric
    ) &&
    numeric >=
      0
  )
    ? numeric
    : 0;
}

function formatNumber(
  value: number
): string {
  return new Intl.NumberFormat(
    undefined,
    {
      minimumFractionDigits:
        1,
      maximumFractionDigits:
        2,
    }
  ).format(
    value
  );
}

function metricUnit(
  metric:
    StatisticsMetric
): string {
  return metric ===
      "dailyKm" ||
    metric ===
      "totalKm"
    ? "km"
    : "h";
}

export default function LocoStatisticsTable({
  locos,
  t,
}: Props) {
  const [
    revision,
    setRevision,
  ] =
    useState(0);

  const [
    metric,
    setMetric,
  ] =
    useState<StatisticsMetric>(
      "dailyKm"
    );

  useEffect(
    () => {
      return subscribeLocoCounterRuntime(
        () => {
          setRevision(
            value =>
              value +
              1
          );
        }
      );
    },
    []
  );

  const rows =
    useMemo<StatisticsRow[]>(
      () => {
        void revision;

        return [
          ...locos,
        ]
          .sort(
            (
              left,
              right
            ) =>
              left.address -
              right.address
          )
          .map(
            loco => {
              const runtime =
                getLocoCounterSnapshot(
                  loco.address
                );

              return {
                id:
                  loco.id,
                address:
                  loco.address,
                name:
                  loco.name ||
                  t(
                    "loco.unnamed"
                  ),
                ...(loco.image
                  ? {
                      image:
                        loco.image,
                    }
                  : {}),
                dailyKm:
                  safeNumber(
                    runtime?.dailyKm
                  ),
                totalKm:
                  safeNumber(
                    runtime?.totalKm ??
                      loco.odometerKm
                  ),
                dailyHours:
                  safeNumber(
                    runtime?.dailyHours
                  ),
                totalHours:
                  safeNumber(
                    runtime?.totalHours ??
                      loco.operatingHours
                  ),
              };
            }
          );
      },
      [
        locos,
        revision,
        t,
      ]
    );

  const totals =
    useMemo(
      () => {
        return rows.reduce(
          (
            result,
            row
          ) => ({
            dailyKm:
              result.dailyKm +
              row.dailyKm,
            totalKm:
              result.totalKm +
              row.totalKm,
            dailyHours:
              result.dailyHours +
              row.dailyHours,
            totalHours:
              result.totalHours +
              row.totalHours,
          }),
          {
            dailyKm: 0,
            totalKm: 0,
            dailyHours: 0,
            totalHours: 0,
          }
        );
      },
      [
        rows,
      ]
    );

  const chartRows =
    useMemo(
      () => {
        return [
          ...rows,
        ].sort(
          (
            left,
            right
          ) =>
            right[
              metric
            ] -
            left[
              metric
            ]
        );
      },
      [
        rows,
        metric,
      ]
    );

  const chartMax =
    Math.max(
      0,
      ...chartRows.map(
        row =>
          row[
            metric
          ]
      )
    );

  if (
    rows.length ===
      0
  ) {
    return (
      <Text
        c="dimmed"
        ta="center"
        py="xl"
      >
        {t(
          "locodialog.statistics_empty"
        )}
      </Text>
    );
  }

  const summaryCards = [
    {
      label:
        t(
          "locodialog.statistics_daily_km"
        ),
      value:
        formatNumber(
          totals.dailyKm
        ),
      unit: "km",
    },
    {
      label:
        t(
          "locodialog.statistics_total_km"
        ),
      value:
        formatNumber(
          totals.totalKm
        ),
      unit: "km",
    },
    {
      label:
        t(
          "locodialog.statistics_daily_hours"
        ),
      value:
        formatNumber(
          totals.dailyHours
        ),
      unit: "h",
    },
    {
      label:
        t(
          "locodialog.statistics_total_hours"
        ),
      value:
        formatNumber(
          totals.totalHours
        ),
      unit: "h",
    },
  ];

  return (
    <ScrollArea
      h="100%"
      type="auto"
    >
      <Stack gap="md" pr="xs">
        <SimpleGrid
          cols={{
            base: 2,
            md: 4,
          }}
          spacing="sm"
        >
          {summaryCards.map(
            card => (
              <Card
                key={
                  card.label
                }
                withBorder
                radius="sm"
                p="sm"
              >
                <Text
                  size="xs"
                  c="dimmed"
                  fw={700}
                >
                  {card.label}
                </Text>

                <Group
                  gap={5}
                  align="baseline"
                  mt={4}
                >
                  <Text
                    fw={800}
                    size="xl"
                  >
                    {card.value}
                  </Text>

                  <Text
                    size="sm"
                    c="dimmed"
                    fw={700}
                  >
                    {card.unit}
                  </Text>
                </Group>
              </Card>
            )
          )}
        </SimpleGrid>

        <Card
          withBorder
          radius="sm"
          p="sm"
        >
          <Group
            justify="space-between"
            align="center"
            mb="md"
            wrap="wrap"
          >
            <Text fw={800}>
              {t(
                "locodialog.statistics_chart_title"
              )}
            </Text>

            <SegmentedControl
              size="xs"
              value={
                metric
              }
              onChange={
                value =>
                  setMetric(
                    value as
                      StatisticsMetric
                  )
              }
              data={[
                {
                  value:
                    "dailyKm",
                  label:
                    t(
                      "locodialog.statistics_daily_km"
                    ),
                },
                {
                  value:
                    "totalKm",
                  label:
                    t(
                      "locodialog.statistics_total_km"
                    ),
                },
                {
                  value:
                    "dailyHours",
                  label:
                    t(
                      "locodialog.statistics_daily_hours"
                    ),
                },
                {
                  value:
                    "totalHours",
                  label:
                    t(
                      "locodialog.statistics_total_hours"
                    ),
                },
              ]}
            />
          </Group>

          <Stack gap="xs">
            {chartRows.map(
              row => {
                const value =
                  row[
                    metric
                  ];

                const percent =
                  chartMax >
                    0
                    ? Math.max(
                        0,
                        Math.min(
                          100,
                          (
                            value /
                            chartMax
                          ) *
                            100
                        )
                      )
                    : 0;

                return (
                  <Group
                    key={
                      row.id
                    }
                    gap="sm"
                    wrap="nowrap"
                    align="center"
                  >
                    <LocoImage
                      locoId={
                        row.id
                      }
                      image={
                        row.image
                      }
                      name={
                        row.name
                      }
                      width={64}
                      height={30}
                    />

                    <Stack
                      gap={3}
                      style={{
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <Group
                        justify="space-between"
                        gap="sm"
                        wrap="nowrap"
                      >
                        <Text
                          size="sm"
                          fw={700}
                          truncate
                        >
                          #{row.address}{" "}
                          {row.name}
                        </Text>

                        <Text
                          size="sm"
                          fw={800}
                          ff="monospace"
                        >
                          {formatNumber(
                            value
                          )}{" "}
                          {metricUnit(
                            metric
                          )}
                        </Text>
                      </Group>

                      <Progress
                        value={
                          percent
                        }
                        size="md"
                        radius="sm"
                        animated={
                          value >
                          0
                        }
                      />
                    </Stack>
                  </Group>
                );
              }
            )}
          </Stack>
        </Card>

        <Table
          striped
          highlightOnHover
          withTableBorder
          withColumnBorders
          stickyHeader
          verticalSpacing="xs"
          horizontalSpacing="sm"
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>
                {t(
                  "locodialog.statistics_image"
                )}
              </Table.Th>

              <Table.Th>
                {t(
                  "locodialog.statistics_address"
                )}
              </Table.Th>

              <Table.Th>
                {t(
                  "locodialog.statistics_loco"
                )}
              </Table.Th>

              <Table.Th ta="right">
                {t(
                  "locodialog.statistics_daily_km"
                )}
              </Table.Th>

              <Table.Th ta="right">
                {t(
                  "locodialog.statistics_total_km"
                )}
              </Table.Th>

              <Table.Th ta="right">
                {t(
                  "locodialog.statistics_daily_hours"
                )}
              </Table.Th>

              <Table.Th ta="right">
                {t(
                  "locodialog.statistics_total_hours"
                )}
              </Table.Th>
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {rows.map(
              row => (
                <Table.Tr
                  key={
                    row.id
                  }
                >
                  <Table.Td>
                    <LocoImage
                      locoId={
                        row.id
                      }
                      image={
                        row.image
                      }
                      name={
                        row.name
                      }
                      width={72}
                      height={32}
                    />
                  </Table.Td>

                  <Table.Td>
                    <Text
                      ff="monospace"
                      fw={700}
                    >
                      #{row.address}
                    </Text>
                  </Table.Td>

                  <Table.Td>
                    <Text
                      fw={600}
                    >
                      {row.name}
                    </Text>
                  </Table.Td>

                  <Table.Td ta="right">
                    {formatNumber(
                      row.dailyKm
                    )}
                  </Table.Td>

                  <Table.Td ta="right">
                    {formatNumber(
                      row.totalKm
                    )}
                  </Table.Td>

                  <Table.Td ta="right">
                    {formatNumber(
                      row.dailyHours
                    )}
                  </Table.Td>

                  <Table.Td ta="right">
                    {formatNumber(
                      row.totalHours
                    )}
                  </Table.Td>
                </Table.Tr>
              )
            )}
          </Table.Tbody>

          <Table.Tfoot>
            <Table.Tr>
              <Table.Th />
              <Table.Th
                colSpan={2}
              >
                <Group
                  gap="xs"
                >
                  <Text fw={800}>
                    {t(
                      "locodialog.statistics_total"
                    )}
                  </Text>

                  <Text
                    size="xs"
                    c="dimmed"
                  >
                    ({rows.length})
                  </Text>
                </Group>
              </Table.Th>

              <Table.Th ta="right">
                {formatNumber(
                  totals.dailyKm
                )}
              </Table.Th>

              <Table.Th ta="right">
                {formatNumber(
                  totals.totalKm
                )}
              </Table.Th>

              <Table.Th ta="right">
                {formatNumber(
                  totals.dailyHours
                )}
              </Table.Th>

              <Table.Th ta="right">
                {formatNumber(
                  totals.totalHours
                )}
              </Table.Th>
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      </Stack>
    </ScrollArea>
  );
}
