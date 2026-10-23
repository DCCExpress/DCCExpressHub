import { Badge, Button, Card, Group, Stack, Text } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import type { TrainDriverStatePayload } from "@domain/wsTypes";
import { wsClient } from "../../services/wsClient";
import { getMovementTaskStates, subscribeMovementTaskStates } from "../../services/movementEngine";
import { getSequentialMovementStates, subscribeSequentialMovementStates } from "../../services/sequentialMovementStates";
import { resolveLocoTaskStatus, formatLocoTaskStatus } from "../../services/locoTaskStatus";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  Direction,
  Loco,
  LocoReservation,
} from "@domain/types";
import { resolveLocoCounterSettings } from "@domain/locoCounterSettings";
import MechanicalCounter from "../../components/MechanicalCounter";
import type {
  LocoPanelCounterDisplaySettings,
} from "../../services/locoPanelCounterDisplaySettings";
import {
  getLocoCounterSnapshot,
  subscribeLocoCounterRuntime,
  type LocoCounterSnapshot,
} from "../../services/locoCounterRuntime";
import LocoImage from "../../components/loco/LocoImage";
import LocoDirectionControls from "./LocoDirectionControls";
import LocoEmergencyButton from "./LocoEmergencyButton";
import LocoTargetBlockDialog from "./LocoTargetBlockDialog";
import LocoSpeedControls from "./LocoSpeedControls";

type LocoControlCardProps = {
  loco: Loco;
  speed: number;
  direction: Direction;
  alive: boolean;
  emergencyStop: boolean;
  reservation?: LocoReservation | null;
  controlsDisabled?: boolean;
  onOpenPicker: () => void;
  onSpeedChange: (speed: number) => void;
  onSpeedChangeEnd: (speed: number) => void;
  onSpeedPercentChange: (percent: number) => void;
  onForward: () => void;
  onReverse: () => void;
  onStop: () => void;
  onEmergencyToggle: () => void;
  counterDisplaySettings:
    LocoPanelCounterDisplaySettings;
};

export default function LocoControlCard({
  loco,
  speed,
  direction,
  alive,
  emergencyStop,
  reservation = null,
  controlsDisabled = false,
  onOpenPicker,
  onSpeedChange,
  onSpeedChangeEnd,
  onSpeedPercentChange,
  onForward,
  onReverse,
  onStop,
  onEmergencyToggle,
  counterDisplaySettings,
}: LocoControlCardProps) {
  const { t } = useTranslation();
  // Keep the former dialog implementation available, but enter canvas
  // destination selection when the throttle's Drive to Block is clicked.
  const [targetDialogOpened, setTargetDialogOpened] = useState(false);
  const [drivers, setDrivers] = useState<TrainDriverStatePayload[]>([]);
  const [movementTasks, setMovementTasks] = useState(getMovementTaskStates);
  const [sequences, setSequences] = useState(getSequentialMovementStates);
  useEffect(() => subscribeMovementTaskStates(() => setMovementTasks(getMovementTaskStates())), []);
  useEffect(() => subscribeSequentialMovementStates(() => setSequences(getSequentialMovementStates())), []);
  useEffect(() => {
    const messages = wsClient.subscribeMessages(message => {
      if (message.type === "trainDriverStateChanged") {
        const driver = message.data as TrainDriverStatePayload;
        setDrivers(previous => [...previous.filter(item => item.taskId !== driver.taskId), driver]);
      } else if (message.type === "trainDriverResponse" &&
                 message.data.action === "snapshot" && message.data.ok &&
                 Array.isArray(message.data.states)) {
        setDrivers(message.data.states);
      }
    });
    const connection = wsClient.subscribeStatus(status => {
      if (status !== "connected") {
        setDrivers([]);
        return;
      }
      wsClient.send({ type: "trainDriverCommand", data: {
        requestId: `loco-driver-snapshot-${Date.now()}`, action: "snapshot",
      } });
    });
    return () => { messages(); connection(); };
  }, []);
  const driver = drivers.find(item => item.locoAddress === loco.address &&
    ["created", "running", "waiting", "paused", "stopping"].includes(item.status));
  const taskStatus = resolveLocoTaskStatus(loco.address, movementTasks, sequences, drivers);
  const movement = taskStatus?.movement;
  const driverAction = (action: "stop" | "resume" | "abort") => {
    if (!driver) return;
    wsClient.send({ type: "trainDriverCommand", data: {
      requestId: `driver-${action}-${Date.now()}`, action, taskId: driver.taskId,
    } });
  };
  const [
    counterSnapshot,
    setCounterSnapshot,
  ] =
    useState<LocoCounterSnapshot | null>(
      () =>
        getLocoCounterSnapshot(
          loco.address
        )
    );

  useEffect(
    () => {
      const update =
        () => {
          setCounterSnapshot(
            getLocoCounterSnapshot(
              loco.address
            )
          );
        };

      update();

      return subscribeLocoCounterRuntime(
        update
      );
    },
    [
      loco.address,
    ]
  );

  const liveCounter =
    counterSnapshot?.address ===
      loco.address
      ? counterSnapshot
      : null;

  const totalKm =
    liveCounter?.totalKm ??
    loco.odometerKm ??
    0;

  const dailyKm =
    liveCounter?.dailyKm ??
    0;

  const totalHours =
    liveCounter?.totalHours ??
    loco.operatingHours ??
    0;

  const dailyHours =
    liveCounter?.dailyHours ??
    0;

  const speedCalibration =
    resolveLocoCounterSettings(
      loco.counterSettings
    );

  const targetSpeedKmh =
    useMemo(
      () => {
        const maxSpeedStep =
          Math.max(
            1,
            loco.maxSpeed ||
              100
          );

        const ratio =
          Math.max(
            0,
            Math.min(
              1,
              speed /
                maxSpeedStep
            )
          );

        return Math.round(
          ratio *
            speedCalibration.maxScaleSpeedKmh
        );
      },
      [
        loco.maxSpeed,
        speed,
        speedCalibration.maxScaleSpeedKmh,
      ]
    );

  const [
    displayedSpeedKmh,
    setDisplayedSpeedKmh,
  ] =
    useState(
      targetSpeedKmh
    );

  const displayedSpeedRef =
    useRef(
      targetSpeedKmh
    );

  useEffect(
    () => {
      displayedSpeedRef.current =
        displayedSpeedKmh;
    },
    [
      displayedSpeedKmh,
    ]
  );

  useEffect(
    () => {
      const startValue =
        displayedSpeedRef.current;

      if (
        startValue ===
        targetSpeedKmh
      ) {
        return;
      }

      const difference =
        Math.abs(
          targetSpeedKmh -
            startValue
        );

      const duration =
        Math.max(
          220,
          Math.min(
            650,
            220 +
              difference *
                3.5
          )
        );

      const startedAt =
        performance.now();

      let frame = 0;

      const animateSpeed =
        (
          now: number
        ) => {
          const progress =
            Math.max(
              0,
              Math.min(
                1,
                (
                  now -
                  startedAt
                ) /
                  duration
              )
            );

          const eased =
            1 -
            Math.pow(
              1 -
                progress,
              3
            );

          const nextValue =
            Math.round(
              startValue +
                (
                  targetSpeedKmh -
                  startValue
                ) *
                  eased
            );

          displayedSpeedRef.current =
            nextValue;

          setDisplayedSpeedKmh(
            nextValue
          );

          if (
            progress <
            1
          ) {
            frame =
              window.requestAnimationFrame(
                animateSpeed
              );
          }
        };

      frame =
        window.requestAnimationFrame(
          animateSpeed
        );

      return () => {
        window.cancelAnimationFrame(
          frame
        );
      };
    },
    [
      targetSpeedKmh,
    ]
  );

  return (
    <Card withBorder radius="sm" p="8">
      <Stack align="center" gap={0}>
        <LocoImage
          locoId={loco.id}
          image={loco.image}
          name={loco.name}
          width={400}
          height={60}
          clickable
          onClick={onOpenPicker}
        />
      </Stack>

      <Stack gap="xs" align="center">
        <Text fw={700} ta="center">
          #{loco.address}{" "}
          {loco.name || t("loco.unnamed")}
        </Text>

        {/* {(reservation) && (
          <Badge
            color="orange"
            variant="light"
            radius="sm"
            maw="100%"
            style={{
              textTransform: "none",
              whiteSpace: "normal",
              textAlign: "center",
            }}
          >
            Foglalt: {reservation.ownerName ?? reservation.ownerId}
          </Badge>
        )} */}

        <div
          style={{
            minHeight:
              44,
            display:
              "flex",
            alignItems:
              "center",
            justifyContent:
              "center",
          }}
        >
          <MechanicalCounter
            value={
              displayedSpeedKmh
            }
            digits={3}
            decimals={0}
            digitHeight={30}
            unit="km/h"
            accentFraction={
              false
            }
          />
        </div>

        {(
          counterDisplaySettings.showKm ||
          counterDisplaySettings.showWorktime
        ) && (
          <Group
            gap={6}
            justify="center"
            wrap="wrap"
            w="100%"
            className="loco-mechanical-counters"
          >
            {counterDisplaySettings.showKm && (
              <MechanicalCounter
                value={
                  counterDisplaySettings.daily
                    ? dailyKm
                    : totalKm
                }
                digits={
                  counterDisplaySettings.digits
                }
                decimals={
                  counterDisplaySettings.distanceDecimals
                }
                digitHeight={
                  counterDisplaySettings.digitHeight
                }
                unit="km"
                accentFraction={
                  counterDisplaySettings.accentFraction
                }
              />
            )}

            {counterDisplaySettings.showWorktime && (
              <MechanicalCounter
                value={
                  counterDisplaySettings.daily
                    ? dailyHours
                    : totalHours
                }
                digits={
                  counterDisplaySettings.digits
                }
                decimals={
                  counterDisplaySettings.operatingHoursDecimals
                }
                digitHeight={
                  counterDisplaySettings.digitHeight
                }
                unit="h"
                accentFraction={
                  counterDisplaySettings.accentFraction
                }
              />
            )}
          </Group>
        )}

        {!alive && (
          <Badge color="red" variant="light">
            {t("common.offline")}
          </Badge>
        )}

        <LocoSpeedControls
          speed={speed}
          maxSpeed={loco.maxSpeed || 100}
          disabled={controlsDisabled}
          onSpeedChange={onSpeedChange}
          onSpeedChangeEnd={onSpeedChangeEnd}
          onSpeedPercentChange={
            onSpeedPercentChange
          }
        />

        <LocoDirectionControls
          speed={speed}
          direction={direction}
          disabled={controlsDisabled}
          onForward={onForward}
          onReverse={onReverse}
          onStop={onStop}
        />

        {taskStatus && (
          <Stack gap={2} w="100%">
            <Group justify="space-between" wrap="nowrap">
              <Text size="xs" fw={600} truncate>{taskStatus.sequence?.name || driver?.name || movement?.state.movementName || "Movement"}</Text>
              <Badge size="xs" color={taskStatus.sequence?.status === "waiting" || driver?.status === "paused" ? "yellow" : "blue"}>
                {taskStatus.sequence?.status || driver?.status || movement?.state.status}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" lineClamp={2}>
              {formatLocoTaskStatus(taskStatus)}
            </Text>
          </Stack>
        )}
        {driver && <Group w="100%" wrap="nowrap" gap="xs" style={{ height: 42 }}>
          {(
            driver.status === "paused" ? (
              <>
                <Button h={40} style={{ flex: 1 }} color="green" variant="light" disabled={controlsDisabled} onClick={() => driverAction("resume")}>Resume</Button>
                <Button h={40} style={{ flex: 1 }} color="red" variant="light" leftSection={<IconX size={17} />} onClick={() => driverAction("abort")}>Abort</Button>
              </>
            ) : (
              <>
                <Button h={40} style={{ flex: 1 }} color="yellow" variant="light" disabled={controlsDisabled || driver.status === "stopping"} onClick={() => driverAction("stop")}>Stop</Button>
                <Button h={40} style={{ flex: 1 }} color="red" variant="light" leftSection={<IconX size={17} />} onClick={() => driverAction("abort")}>Abort</Button>
              </>
            )
          )}
        </Group>}
        <LocoTargetBlockDialog loco={loco} opened={targetDialogOpened} onClose={() => setTargetDialogOpened(false)} />

        <LocoEmergencyButton
          emergencyStop={emergencyStop}
          onToggle={onEmergencyToggle}
        />
      </Stack>
    </Card>
  );
}
