import {
  Group,
  ScrollArea,
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
  dailyKm: number;
  totalKm: number;
  dailyHours: number;
  totalHours: number;
};

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

function formatKm(
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

function formatHours(
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

export default function LocoStatisticsTable({
  locos,
  t,
}: Props) {
  const [
    revision,
    setRevision,
  ] =
    useState(0);

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

  return (
    <ScrollArea
      h="100%"
      type="auto"
    >
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
                  {formatKm(
                    row.dailyKm
                  )}
                </Table.Td>

                <Table.Td ta="right">
                  {formatKm(
                    row.totalKm
                  )}
                </Table.Td>

                <Table.Td ta="right">
                  {formatHours(
                    row.dailyHours
                  )}
                </Table.Td>

                <Table.Td ta="right">
                  {formatHours(
                    row.totalHours
                  )}
                </Table.Td>
              </Table.Tr>
            )
          )}
        </Table.Tbody>

        <Table.Tfoot>
          <Table.Tr>
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
              {formatKm(
                totals.dailyKm
              )}
            </Table.Th>

            <Table.Th ta="right">
              {formatKm(
                totals.totalKm
              )}
            </Table.Th>

            <Table.Th ta="right">
              {formatHours(
                totals.dailyHours
              )}
            </Table.Th>

            <Table.Th ta="right">
              {formatHours(
                totals.totalHours
              )}
            </Table.Th>
          </Table.Tr>
        </Table.Tfoot>
      </Table>
    </ScrollArea>
  );
}
