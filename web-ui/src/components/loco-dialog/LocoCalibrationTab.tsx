import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  ScrollArea,
  Stack,
  Table,
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

function sameNumbers(
  left: readonly number[],
  right: readonly number[]
): boolean {
  return (
    left.length ===
      right.length &&
    left.every(
      (
        value,
        index
      ) =>
        value ===
        right[
          index
        ]
    )
  );
}

function sameStrings(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length ===
      right.length &&
    left.every(
      (
        value,
        index
      ) =>
        value ===
        right[
          index
        ]
    )
  );
}

function reverseFor(
  selected:
    MovementRouteCandidate,
  candidates:
    MovementRouteCandidate[]
): MovementRouteCandidate | null {
  const reverseBlocks =
    selected.blockPath
      .map(
        block =>
          block.id
      )
      .reverse();

  const reverseNodes =
    [
      ...selected.nodePath,
    ].reverse();

  const exact =
    candidates.find(
      candidate =>
        candidate.fromBlockId ===
          selected.toBlockId &&
        candidate.toBlockId ===
          selected.fromBlockId &&
        sameNumbers(
          candidate.blockPath.map(
            block =>
              block.id
          ),
          reverseBlocks
        ) &&
        sameStrings(
          candidate.nodePath,
          reverseNodes
        )
    );

  if (exact) {
    return exact;
  }

  const endpointMatches =
    candidates.filter(
      candidate =>
        candidate.fromBlockId ===
          selected.toBlockId &&
        candidate.toBlockId ===
          selected.fromBlockId
    );

  return endpointMatches.length ===
    1
    ? endpointMatches[0]!
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
    routeKey:
      null,
    reverseRouteKey:
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
    useState<string | null>(
      null
    );

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
      loco.id &&
    runtime.results.length >
      0
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
        !runtime.routeKey ||
        !runtime.reverseRouteKey
      ) {
        return;
      }

      const signature =
        JSON.stringify({
          routeKey:
            runtime.routeKey,
          reverseRouteKey:
            runtime.reverseRouteKey,
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
        routeKey:
          runtime.routeKey,
        reverseRouteKey:
          runtime.reverseRouteKey,
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
      preferredRouteKey?: string
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

        const savedKey =
          preferredRouteKey ??
          selectedRoute?.key ??
          loco.calibration
            ?.routeKey ??
          "";

        if (savedKey) {
          const saved =
            loaded.find(
              candidate =>
                candidate.key ===
                savedKey
            ) ??
            null;

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
          ?.routeKey
      );
    },
    [
      loco.id,
    ]
  );

  const openRoutePicker =
    (): void => {
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

  return (
    <>
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
                            routeKey:
                              selectedRoute.key,
                            reverseRouteKey:
                              reverseRoute.key,
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
                  disabled={
                    !activeForThisLoco
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
                        runtime.currentDirection.toUpperCase()
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
            </Stack>
          </Card>
        </Stack>
      </ScrollArea>

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
                title="Route selection"
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
                    Direction
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
                    : candidates.map(
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
