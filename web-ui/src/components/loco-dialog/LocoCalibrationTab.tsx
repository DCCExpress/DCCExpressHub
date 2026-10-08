import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  ScrollArea,
  TextInput,
  Stack,
  Table,
  Tabs,
  Text,
} from "@mantine/core";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  useTranslation,
} from "react-i18next";

import type {
  Loco,
  LocoCalibrationProfile,
} from "@domain/types";

import type {
  SerializedLayoutDto,
} from "@domain/layout/layoutDto";

import {
  createEmptyMovementDocument,
  type MovementRouteRef,
} from "@domain/movement";

import {
  buildMovementRouteCandidates,
  type MovementRouteCandidate,
} from "@/services/movementRouteCatalog";

import {
  abortCalibration,
  emergencyStopCalibration,
  getCalibrationState,
  startCalibration,
  stopCalibration,
  type CalibrationRuntimeState,
} from "@/services/calibrationApi";

import AppModal from "@/components/common/AppModal";
import PrecisionBrakingPanel from "./PrecisionBrakingPanel";

type Props = {
  loco: Loco;
  onPatch: (
    patch: Partial<Loco>
  ) => void;
};

function candidateLabel(
  candidate:
    MovementRouteCandidate
): string {
  const arrow =
    candidate.locoDirection ===
      "forward"
      ? "→"
      : candidate.locoDirection ===
          "reverse"
        ? "←"
        : "↔";

  return candidate.blockPath
    .map(
      block =>
        block.name
    )
    .join(
      ` ${arrow} `
    );
}

function routeRefForCandidate(
  candidate: MovementRouteCandidate
): MovementRouteRef | null {
  if (
    candidate.locoDirection !== "forward" &&
    candidate.locoDirection !== "reverse"
  ) {
    return null;
  }

  const blockIds =
    candidate.blockPath.map(
      block => block.id
    );

  return {
    fromBlockId:
      candidate.fromBlockId,
    toBlockId:
      candidate.toBlockId,
    direction:
      candidate.locoDirection,
    viaBlockIds:
      blockIds.slice(1, -1),
  };
}

function reverseRouteRef(
  routeRef: MovementRouteRef
): MovementRouteRef {
  return {
    fromBlockId:
      routeRef.toBlockId,
    toBlockId:
      routeRef.fromBlockId,
    direction:
      routeRef.direction === "forward"
        ? "reverse"
        : "forward",
    viaBlockIds:
      [...routeRef.viaBlockIds].reverse(),
  };
}

function candidateMatchesRouteRef(
  candidate: MovementRouteCandidate,
  routeRef: MovementRouteRef
): boolean {
  const candidateRef =
    routeRefForCandidate(
      candidate
    );

  return (
    candidateRef !== null &&
    candidateRef.fromBlockId === routeRef.fromBlockId &&
    candidateRef.toBlockId === routeRef.toBlockId &&
    candidateRef.direction === routeRef.direction &&
    candidateRef.viaBlockIds.length === routeRef.viaBlockIds.length &&
    candidateRef.viaBlockIds.every(
      (value, index) =>
        value === routeRef.viaBlockIds[index]
    )
  );
}

function reverseFor(
  selected: MovementRouteCandidate,
  candidates: MovementRouteCandidate[]
): MovementRouteCandidate | null {
  const selectedRef =
    routeRefForCandidate(
      selected
    );

  if (!selectedRef) {
    return null;
  }

  const reverseRef =
    reverseRouteRef(
      selectedRef
    );

  const matches =
    candidates.filter(
      candidate =>
        candidateMatchesRouteRef(
          candidate,
          reverseRef
        )
    );

  return matches.length === 1
    ? matches[0]!
    : null;
}

function emptyRuntime():
  CalibrationRuntimeState {
  return {
    status:
      "idle",
    locoId:
      null,
    locoAddress:
      null,
    routeRef:
      null,
    routeLabel:
      null,
    routeLengthMm:
      0,
    maxSpeed:
      126,
    speedStep:
      10,
    currentSpeed:
      null,
    currentDirection:
      null,
    info:
      null,
    error:
      null,
    results:
      [],
  };
}

export default function LocoCalibrationTab({
  loco,
  onPatch,
}: Props) {
  const { t } =
    useTranslation();
  const [
    runtime,
    setRuntime,
  ] =
    useState<CalibrationRuntimeState>(
      emptyRuntime()
    );

  const [
    candidates,
    setCandidates,
  ] =
    useState<MovementRouteCandidate[]>(
      []
    );

  const [
    pickerOpened,
    setPickerOpened,
  ] =
    useState(false);

  const [
    loadingRoutes,
    setLoadingRoutes,
  ] =
    useState(false);

  const [
    routeError,
    setRouteError,
  ] =
    useState<string | null>(null);

  const [
    fromFilter,
    setFromFilter,
  ] =
    useState("");

  const [
    toFilter,
    setToFilter,
  ] =
    useState("");

  const [
    selectedRoute,
    setSelectedRoute,
  ] =
    useState<MovementRouteCandidate | null>(
      null
    );

  const [
    reverseRoute,
    setReverseRoute,
  ] =
    useState<MovementRouteCandidate | null>(
      null
    );

  const [
    routeLengthMm,
    setRouteLengthMm,
  ] =
    useState(
      loco.calibration
        ?.routeLengthMm ??
      1000
    );

  const [
    maxSpeed,
    setMaxSpeed,
  ] =
    useState(
      loco.calibration
        ?.maxSpeed ??
      126
    );

  const [
    speedStep,
    setSpeedStep,
  ] =
    useState(
      loco.calibration
        ?.speedStep ??
      10
    );

  const [
    commandBusy,
    setCommandBusy,
  ] =
    useState(false);

  const calibrationSignature =
    useRef("");

  const activeForThisLoco =
    runtime.locoId ===
      loco.id &&
    runtime.status ===
      "running";

  const activeForOtherLoco =
    runtime.status ===
      "running" &&
    runtime.locoId !==
      loco.id;

  const visibleResults =
    runtime.locoId ===
      loco.id
      ? runtime.results
      : loco.calibration
          ?.results ??
        [];

  const refresh =
    async (): Promise<void> => {
      try {
        const next =
          await getCalibrationState();

        setRuntime(
          next
        );
      } catch {
      }
    };

  useEffect(
    () => {
      void refresh();

      const timer =
        window.setInterval(
          () => {
            void refresh();
          },
          500
        );

      return () =>
        window.clearInterval(
          timer
        );
    },
    []
  );

  useEffect(
    () => {
      setRouteLengthMm(
        loco.calibration
          ?.routeLengthMm ??
        1000
      );

      setMaxSpeed(
        loco.calibration
          ?.maxSpeed ??
        126
      );

      setSpeedStep(
        loco.calibration
          ?.speedStep ??
        10
      );
    },
    [
      loco.id,
    ]
  );

  useEffect(
    () => {
      if (
        runtime.locoId !==
          loco.id ||
        runtime.results.length ===
          0 ||
        !runtime.routeRef
      ) {
        return;
      }

      const signature =
        JSON.stringify({
          routeRef:
            runtime.routeRef,
          routeLengthMm:
            runtime.routeLengthMm,
          maxSpeed:
            runtime.maxSpeed,
          speedStep:
            runtime.speedStep,
          results:
            runtime.results,
        });

      if (
        signature ===
        calibrationSignature.current
      ) {
        return;
      }

      calibrationSignature.current =
        signature;

      const profile:
        LocoCalibrationProfile = {
        routeRef:
          runtime.routeRef,
        routeLabel:
          runtime.routeLabel ??
          "",
        routeLengthMm:
          runtime.routeLengthMm,
        maxSpeed:
          runtime.maxSpeed,
        speedStep:
          runtime.speedStep,
        updatedAt:
          new Date()
            .toISOString(),
        results:
          runtime.results.map(
            row => ({
              ...row,
            })
          ),
      };

      onPatch({
        calibration:
          profile,
      });
    },
    [
      runtime,
      loco.id,
      onPatch,
    ]
  );

  const loadRoutes =
    async (
      preferredRouteRef?: MovementRouteRef
    ): Promise<void> => {
      try {
        setLoadingRoutes(
          true
        );

        setRouteError(
          null
        );

        const response =
          await fetch(
            "/api/layout",
            {
              cache:
                "no-store",
            }
          );

        if (!response.ok) {
          throw new Error(
            `Layout could not be loaded (${response.status}).`
          );
        }

        const layout =
          await response.json() as
            SerializedLayoutDto;

        const loaded =
          buildMovementRouteCandidates(
            layout,
            createEmptyMovementDocument()
          );

        setCandidates(
          loaded
        );

        const selectedRef =
          selectedRoute
            ? routeRefForCandidate(
                selectedRoute
              )
            : null;

        const savedRef =
          preferredRouteRef ??
          selectedRef ??
          loco.calibration
            ?.routeRef ??
          null;

        if (savedRef) {
          const matches =
            loaded.filter(
              candidate =>
                candidateMatchesRouteRef(
                  candidate,
                  savedRef
                )
            );

          const saved =
            matches.length === 1
              ? matches[0]!
              : null;

          setSelectedRoute(
            saved
          );

          setReverseRoute(
            saved
              ? reverseFor(
                  saved,
                  loaded
                )
              : null
          );

          if (!saved) {
            setRouteError(
              matches.length > 1
                ? "Calibration route is ambiguous. Select the route again."
                : "Calibration route no longer exists. Select the route again."
            );
          }
        }
      } catch (error) {
        setRouteError(
          error instanceof Error
            ? error.message
            : String(
                error
              )
        );
      } finally {
        setLoadingRoutes(
          false
        );
      }
    };

  useEffect(
    () => {
      setSelectedRoute(
        null
      );

      setReverseRoute(
        null
      );

      setRouteError(
        null
      );

      calibrationSignature.current =
        "";

      void loadRoutes(
        loco.calibration
          ?.routeRef
      );
    },
    [
      loco.id,
    ]
  );

  const openRoutePicker =
    (): void => {
      setFromFilter(
        ""
      );

      setToFilter(
        ""
      );

      setPickerOpened(
        true
      );

      void loadRoutes();
    };

  const chooseRoute =
    (
      candidate:
        MovementRouteCandidate
    ): void => {
      const reverse =
        reverseFor(
          candidate,
          candidates
        );

      setSelectedRoute(
        candidate
      );

      setReverseRoute(
        reverse
      );

      setRouteError(
        reverse
          ? null
          : t("locodialog.calibration.reverseMissingLong")
      );

      if (reverse) {
        setPickerOpened(
          false
        );
      }
    };

  const routeLabel =
    selectedRoute
      ? candidateLabel(
          selectedRoute
        )
      : loco.calibration
          ?.routeLabel ??
        t("locodialog.calibration.noRoute");

  const runCommand =
    async (
      command:
        () =>
          Promise<CalibrationRuntimeState>
    ): Promise<void> => {
      try {
        setCommandBusy(
          true
        );

        const next =
          await command();

        setRuntime(
          next
        );
      } catch (error) {
        setRuntime(
          current => ({
            ...current,
            error:
              error instanceof Error
                ? error.message
                : String(
                    error
                  ),
          })
        );
      } finally {
        setCommandBusy(
          false
        );
      }
    };

  const canStart =
    !activeForOtherLoco &&
    !activeForThisLoco &&
    selectedRoute !==
      null &&
    reverseRoute !==
      null &&
    routeLengthMm >
      0 &&
    maxSpeed >=
      1 &&
    maxSpeed <=
      126 &&
    speedStep >=
      1 &&
    speedStep <=
      126 &&
    speedStep <=
      maxSpeed;

  const filteredCandidates =
    useMemo(
      () => {
        const fromQuery =
          fromFilter.trim().toLocaleLowerCase();
        const toQuery =
          toFilter.trim().toLocaleLowerCase();

        return candidates.filter(
          candidate =>
            (
              !fromQuery ||
              candidate.fromBlockName.toLocaleLowerCase().includes(fromQuery) ||
              String(candidate.fromBlockId).includes(fromQuery)
            ) &&
            (
              !toQuery ||
              candidate.toBlockName.toLocaleLowerCase().includes(toQuery) ||
              String(candidate.toBlockId).includes(toQuery)
            )
        );
      },
      [
        candidates,
        fromFilter,
        toFilter,
      ]
    );

  const summary =
    useMemo(
      () => {
        const grouped =
          new Map<
            number,
            number[]
          >();

        for (
          const row of
          visibleResults
        ) {
          const values =
            grouped.get(
              row.speedStep
            ) ??
            [];

          values.push(
            row.millimetersPerSecond
          );

          grouped.set(
            row.speedStep,
            values
          );
        }

        return [
          ...grouped.entries(),
        ].map(
          ([
            speed,
            values,
          ]) => ({
            speed,
            average:
              values.reduce(
                (
                  sum,
                  value
                ) =>
                  sum +
                  value,
                0
              ) /
              values.length,
          })
        );
      },
      [
        visibleResults,
      ]
    );

  const chartData = useMemo(() => {
    const grouped = new Map<number, { outbound: number[]; return: number[] }>();
    for (const row of visibleResults) {
      const item = grouped.get(row.speedStep) ?? { outbound: [], return: [] };
      item[row.direction === "outbound" ? "outbound" : "return"].push(row.millimetersPerSecond);
      grouped.set(row.speedStep, item);
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => a - b)
      .map(([speed, values]) => ({
        speed,
        outbound: values.outbound.length
          ? values.outbound.reduce((a, b) => a + b, 0) / values.outbound.length
          : null,
        returning: values.return.length
          ? values.return.reduce((a, b) => a + b, 0) / values.return.length
          : null,
      }));
  }, [visibleResults]);

  const chartMaxY = Math.max(
    10,
    ...chartData.flatMap(point => [point.outbound ?? 0, point.returning ?? 0])
  ) * 1.1;
  const chartMaxX = Math.max(1, ...chartData.map(point => point.speed));
  const chartX = (speed: number) => 55 + (speed / chartMaxX) * 710;
  const chartY = (value: number) => 270 - (value / chartMaxY) * 225;

  const hasSpeedProfile = (loco.calibration?.results.length ?? 0) > 0;

  return (
    <>
      <Tabs
        defaultValue="speed"
        keepMounted
        style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        <Tabs.List mb="sm" style={{ flexShrink: 0 }}>
          <Tabs.Tab value="speed">Speed Calibration</Tabs.Tab>
          <Tabs.Tab value="braking">Precision Braking</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="speed" style={{ flex: 1, minHeight: 0 }}>
      <ScrollArea
        h="100%"
        type="auto"
        offsetScrollbars
      >
        <Stack
          gap="md"
          pr="xs"
        >
          {
            activeForOtherLoco && (
              <Alert
                color="orange"
                title={t("locodialog.calibration.busy")}
              >
                {t("locodialog.calibration.busyOther")}
              </Alert>
            )
          }

          {
            runtime.error && (
              <Alert
                color="red"
                title={t("locodialog.calibration.error")}
              >
                {runtime.error}
              </Alert>
            )
          }

          <Card
            withBorder
            p="md"
          >
            <Stack gap="sm">
              <Group
                justify="space-between"
                align="flex-end"
              >
                <Stack gap={3}>
                  <Text
                    fw={700}
                  >
                    {t("locodialog.calibration.route")}
                  </Text>

                  <Text
                    size="sm"
                    c="dimmed"
                  >
                    {routeLabel}
                  </Text>

                  {
                    selectedRoute &&
                    !reverseRoute && (
                      <Text
                        size="xs"
                        c="red"
                      >
                        {t("locodialog.calibration.reverseMissing")}
                      </Text>
                    )
                  }
                </Stack>

                <Button
                  variant="light"
                  onClick={
                    openRoutePicker
                  }
                  disabled={
                    activeForThisLoco
                  }
                >
                  {t("locodialog.calibration.selectRoute")}
                </Button>
              </Group>

              <Group
                grow
                align="flex-end"
              >
                <NumberInput
                  label={t("locodialog.calibration.routeLength")}
                  value={
                    routeLengthMm
                  }
                  min={1}
                  step={10}
                  allowDecimal
                  onChange={
                    value =>
                      setRouteLengthMm(
                        Math.max(
                          1,
                          Number(
                            value
                          ) ||
                          1
                        )
                      )
                  }
                  disabled={
                    activeForThisLoco
                  }
                />

                <NumberInput
                  label={t("locodialog.calibration.maxSpeed")}
                  value={
                    maxSpeed
                  }
                  min={1}
                  max={126}
                  step={1}
                  allowDecimal={false}
                  clampBehavior="strict"
                  onChange={
                    value =>
                      setMaxSpeed(
                        Math.max(
                          1,
                          Math.min(
                            126,
                            Math.round(
                              Number(
                                value
                              ) ||
                              1
                            )
                          )
                        )
                      )
                  }
                  disabled={
                    activeForThisLoco
                  }
                />

                <NumberInput
                  label={t("locodialog.calibration.speedStep")}
                  value={
                    speedStep
                  }
                  min={1}
                  max={126}
                  step={1}
                  allowDecimal={false}
                  clampBehavior="strict"
                  onChange={
                    value =>
                      setSpeedStep(
                        Math.max(
                          1,
                          Math.min(
                            126,
                            Math.round(
                              Number(
                                value
                              ) ||
                              1
                            )
                          )
                        )
                      )
                  }
                  disabled={
                    activeForThisLoco
                  }
                />
              </Group>

              <Group gap="xs">
                <Button
                  onClick={
                    () => {
                      if (
                        !selectedRoute ||
                        !reverseRoute
                      ) {
                        return;
                      }

                      void runCommand(
                        () =>
                          startCalibration({
                            locoId:
                              loco.id,
                            locoAddress:
                              loco.address,
                            routeRef:
                              routeRefForCandidate(
                                selectedRoute
                              )!,
                            routeLabel:
                              candidateLabel(
                                selectedRoute
                              ),
                            routeLengthMm,
                            maxSpeed,
                            speedStep,
                          })
                      );
                    }
                  }
                  disabled={
                    !canStart
                  }
                  loading={
                    commandBusy
                  }
                >
                  {t("locodialog.calibration.start")}
                </Button>

                <Button
                  variant="light"
                  onClick={
                    () =>
                      void runCommand(
                        stopCalibration
                      )
                  }
                  disabled={
                    !activeForThisLoco
                  }
                >
                  {t("locodialog.calibration.stop")}
                </Button>

                <Button
                  color="orange"
                  variant="light"
                  onClick={
                    () =>
                      void runCommand(
                        abortCalibration
                      )
                  }
                  disabled={
                    !activeForThisLoco
                  }
                >
                  {t("locodialog.calibration.abort")}
                </Button>

                <Button
                  color="red"
                  onClick={
                    () =>
                      void runCommand(
                        emergencyStopCalibration
                      )
                  }
                >
                  {t("locodialog.calibration.estop")}
                </Button>
              </Group>

              <Group gap="xs">
                <Badge
                  color={
                    runtime.status ===
                      "running"
                      ? "blue"
                      : runtime.status ===
                          "completed"
                        ? "green"
                        : runtime.status ===
                            "error"
                          ? "red"
                          : "gray"
                  }
                >
                  {
                    runtime.status.toUpperCase()
                  }
                </Badge>

                {
                  activeForThisLoco &&
                  runtime.currentSpeed !==
                    null && (
                    <Badge
                      variant="light"
                    >
                      SPEED {
                        runtime.currentSpeed
                      }
                    </Badge>
                  )
                }

                {
                  activeForThisLoco &&
                  runtime.currentDirection && (
                    <Badge
                      variant="light"
                      color="violet"
                    >
                      {
                        runtime.currentDirection ===
                          "outbound"
                          ? t("locodialog.calibration.outbound").toUpperCase()
                          : t("locodialog.calibration.return").toUpperCase()
                      }
                    </Badge>
                  )
                }

                <Text
                  size="sm"
                  c="dimmed"
                >
                  {
                    runtime.info ??
                    t("locodialog.calibration.ready")
                  }
                </Text>
              </Group>
            </Stack>
          </Card>

          <Card
            withBorder
            p="md"
          >
            <Stack gap="sm">
              <Group
                justify="space-between"
              >
                <Text fw={700}>
                  {t("locodialog.calibration.results")}
                </Text>

                <Text
                  size="xs"
                  c="dimmed"
                >
                  {t(
                    "locodialog.calibration.speedPoints",
                    {
                      count:
                        summary.length,
                    }
                  )}
                </Text>
              </Group>

              <Tabs defaultValue="table" keepMounted={false}>
                <Tabs.List mb="sm">
                  <Tabs.Tab value="table">Table</Tabs.Tab>
                  <Tabs.Tab value="chart">Chart</Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="table">
              <ScrollArea
                type="auto"
                offsetScrollbars
              >
                <Table
                  striped
                  highlightOnHover
                  withTableBorder
                  withColumnBorders
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>
                        {t("locodialog.calibration.speed")}
                      </Table.Th>
                      <Table.Th>
                        {t("locodialog.calibration.direction")}
                      </Table.Th>
                      <Table.Th>
                        {t("locodialog.calibration.time")}
                      </Table.Th>
                      <Table.Th>
                        {t("locodialog.calibration.distance")}
                      </Table.Th>
                      <Table.Th>
                        {t("locodialog.calibration.realSpeed")}
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>

                  <Table.Tbody>
                    {
                      visibleResults.length ===
                        0
                        ? (
                          <Table.Tr>
                            <Table.Td
                              colSpan={5}
                            >
                              <Text
                                ta="center"
                                c="dimmed"
                                size="sm"
                              >
                                {t("locodialog.calibration.noResults")}
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        )
                        : visibleResults.map(
                            (
                              row,
                              index
                            ) => (
                              <Table.Tr
                                key={
                                  `${row.speedStep}-${row.direction}-${index}`
                                }
                              >
                                <Table.Td>
                                  {
                                    row.speedStep
                                  }
                                </Table.Td>
                                <Table.Td>
                                  {
                                    row.direction ===
                                      "outbound"
                                      ? t("locodialog.calibration.outbound")
                                      : t("locodialog.calibration.return")
                                  }
                                </Table.Td>
                                <Table.Td>
                                  {
                                    (
                                      row.elapsedMs /
                                      1000
                                    ).toFixed(
                                      3
                                    )
                                  } s
                                </Table.Td>
                                <Table.Td>
                                  {
                                    runtime.locoId ===
                                      loco.id &&
                                    runtime.routeLengthMm >
                                      0
                                      ? runtime.routeLengthMm
                                      : loco.calibration
                                          ?.routeLengthMm ??
                                        routeLengthMm
                                  } mm
                                </Table.Td>
                                <Table.Td>
                                  {
                                    row.millimetersPerSecond.toFixed(
                                      2
                                    )
                                  } mm/s
                                </Table.Td>
                              </Table.Tr>
                            )
                          )
                    }
                  </Table.Tbody>
                </Table>
              </ScrollArea>
                </Tabs.Panel>
                <Tabs.Panel value="chart">
                  {chartData.length === 0 ? (
                    <Text c="dimmed" size="sm" ta="center" py="xl">
                      {t("locodialog.calibration.noResults")}
                    </Text>
                  ) : (
                    <Stack gap="xs">
                      <svg viewBox="0 0 800 320" role="img" aria-label="Calibration speed curves" style={{ width: "100%", height: "auto" }}>
                        {Array.from({ length: 5 }, (_, index) => {
                          const value = chartMaxY * index / 4;
                          const y = chartY(value);
                          return (
                            <g key={index}>
                              <line x1={55} y1={y} x2={765} y2={y} stroke="currentColor" strokeOpacity={0.14} />
                              <text x={48} y={y + 4} textAnchor="end" fontSize={12} fill="currentColor">{value.toFixed(0)}</text>
                            </g>
                          );
                        })}
                        {Array.from({ length: 6 }, (_, index) => {
                          const value = chartMaxX * index / 5;
                          const x = chartX(value);
                          return (
                            <text key={index} x={x} y={292} textAnchor="middle" fontSize={12} fill="currentColor">{value.toFixed(0)}</text>
                          );
                        })}
                        <line x1={55} y1={270} x2={765} y2={270} stroke="currentColor" strokeOpacity={0.4} />
                        <line x1={55} y1={45} x2={55} y2={270} stroke="currentColor" strokeOpacity={0.4} />
                        <text x={410} y={315} textAnchor="middle" fontSize={13} fill="currentColor">{t("locodialog.calibration.speed")}</text>
                        <text x={15} y={160} textAnchor="middle" fontSize={13} fill="currentColor" transform="rotate(-90 15 160)">mm/s</text>
                        {([
                          { key: "outbound" as const, color: "#228be6", label: t("locodialog.calibration.outbound") },
                          { key: "returning" as const, color: "#f59f00", label: t("locodialog.calibration.return") },
                        ]).map(series => {
                          const points = chartData.filter(point => point[series.key] !== null);
                          return (
                            <g key={series.key}>
                              <polyline
                                points={points.map(point => `${chartX(point.speed)},${chartY(point[series.key]!)}`).join(" ")}
                                fill="none" stroke={series.color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                              />
                              {points.map(point => (
                                <circle key={point.speed} cx={chartX(point.speed)} cy={chartY(point[series.key]!)} r={4} fill={series.color}>
                                  <title>{`${series.label}: ${point.speed} → ${point[series.key]!.toFixed(2)} mm/s`}</title>
                                </circle>
                              ))}
                            </g>
                          );
                        })}
                      </svg>
                      <Group gap="lg" justify="center">
                        <Text size="xs" c="blue">● {t("locodialog.calibration.outbound")}</Text>
                        <Text size="xs" c="orange">● {t("locodialog.calibration.return")}</Text>
                      </Group>
                    </Stack>
                  )}
                </Tabs.Panel>
              </Tabs>
            </Stack>
          </Card>
        </Stack>
      </ScrollArea>
        </Tabs.Panel>
        <Tabs.Panel value="braking" style={{ flex: 1, minHeight: 0 }}>
          <ScrollArea h="100%" type="auto" offsetScrollbars>
            <PrecisionBrakingPanel loco={loco} onPatch={onPatch} />
          </ScrollArea>
        </Tabs.Panel>
      </Tabs>

      <AppModal
        opened={
          pickerOpened
        }
        onClose={
          () =>
            setPickerOpened(
              false
            )
        }
        title={t("locodialog.calibration.selectTitle")}
        size="min(1200px, 94vw)"
        centered
        draggable
        styles={{
          content: {
            height:
              "min(760px, 90dvh)",
            overflow:
              "hidden",
          },
          body: {
            height:
              "calc(100% - 48px)",
            overflow:
              "hidden",
          },
        }}
      >
        <Stack
          h="100%"
          gap="sm"
          style={{
            minHeight:
              0,
          }}
        >
          {
            routeError && (
              <Alert
                color="red"
                title={t("locodialog.calibration.routeSelection")}
              >
                {routeError}
              </Alert>
            )
          }

          <Text
            size="sm"
            c="dimmed"
          >
            {t("locodialog.calibration.selectHint")}
          </Text>

          <Group
            grow
            align="flex-end"
          >
            <TextInput
              label={t("locodialog.calibration.from")}
              value={fromFilter}
              onChange={event =>
                setFromFilter(event.currentTarget.value)
              }
              placeholder={t("locodialog.calibration.from")}
            />

            <TextInput
              label={t("locodialog.calibration.to")}
              value={toFilter}
              onChange={event =>
                setToFilter(event.currentTarget.value)
              }
              placeholder={t("locodialog.calibration.to")}
            />
          </Group>

          <ScrollArea
            style={{
              flex: 1,
              minHeight: 0,
            }}
            type="auto"
            offsetScrollbars
          >
            <Table
              striped
              highlightOnHover
              withTableBorder
              withColumnBorders
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>
                    {t("locodialog.calibration.from")}
                  </Table.Th>
                  <Table.Th>
                    {t("locodialog.calibration.via")}
                  </Table.Th>
                  <Table.Th>
                    {t("locodialog.calibration.to")}
                  </Table.Th>
                  <Table.Th>
                    {t("locodialog.calibration.direction")}
                  </Table.Th>
                  <Table.Th>
                    {t("locodialog.calibration.reverse")}
                  </Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>

              <Table.Tbody>
                {
                  loadingRoutes
                    ? (
                      <Table.Tr>
                        <Table.Td
                          colSpan={6}
                        >
                          {t("locodialog.calibration.loadingRoutes")}
                        </Table.Td>
                      </Table.Tr>
                    )
                    : filteredCandidates.map(
                        candidate => {
                          const reverse =
                            reverseFor(
                              candidate,
                              candidates
                            );

                          return (
                            <Table.Tr
                              key={
                                candidate.key
                              }
                            >
                              <Table.Td>
                                {
                                  candidate.fromBlockName
                                }
                              </Table.Td>
                              <Table.Td>
                                {
                                  candidate.blockPath
                                    .slice(
                                      1,
                                      -1
                                    )
                                    .map(
                                      block =>
                                        block.name
                                    )
                                    .join(
                                      " → "
                                    ) ||
                                  "—"
                                }
                              </Table.Td>
                              <Table.Td>
                                {
                                  candidate.toBlockName
                                }
                              </Table.Td>
                              <Table.Td>
                                {
                                  candidate.locoDirection
                                }
                              </Table.Td>
                              <Table.Td>
                                {
                                  reverse
                                    ? t("locodialog.calibration.reverseOk")
                                    : t("locodialog.calibration.reverseMissingShort")
                                }
                              </Table.Td>
                              <Table.Td>
                                <Button
                                  size="compact-xs"
                                  variant="light"
                                  disabled={
                                    !reverse
                                  }
                                  onClick={
                                    () =>
                                      chooseRoute(
                                        candidate
                                      )
                                  }
                                >
                                  {t("locodialog.calibration.select")}
                                </Button>
                              </Table.Td>
                            </Table.Tr>
                          );
                        }
                      )
                }
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Stack>
      </AppModal>
    </>
  );
}
