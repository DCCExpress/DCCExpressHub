import { Badge, Card, Group, Stack, Text } from "@mantine/core";
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

        <LocoEmergencyButton
          emergencyStop={emergencyStop}
          onToggle={onEmergencyToggle}
        />
      </Stack>
    </Card>
  );
}
