import { useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import i18next from "i18next";

import AppModal from "@/components/common/AppModal";
import { wsClient } from "@/services/wsClient";
import type { SafetyEmergencyStopPayload } from "@/domain/wsTypes";

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <Group
      justify="space-between"
      gap="xs"
      wrap="nowrap"
    >
      <Text
        size="sm"
        c="dimmed"
      >
        {label}
      </Text>

      <Text
        size="sm"
        fw={700}
        ta="right"
      >
        {value}
      </Text>
    </Group>
  );
}

export default function SafetyEmergencyStopDialog() {
  useTranslation();

  const [
    trip,
    setTrip,
  ] =
    useState<
      SafetyEmergencyStopPayload |
      null
    >(null);

  useEffect(
    () =>
      wsClient.on(
        "safetyEmergencyStop",
        data => {
          setTrip(data);
        }
      ),
    []
  );

  const reasonLabel =
    trip?.code ===
      "target_occupancy_mismatch"
      ? i18next.t(
          "ui.safetyTargetOccupancyMismatch"
        )
      : i18next.t(
          "ui.safetyUnknownOccupancy"
        );

  const close =
    (): void => {
      setTrip(null);
    };

  return (
    <AppModal
      opened={trip !== null}
      onClose={close}
      title={i18next.t(
        "ui.safetyEmergencyStopTitle"
      )}
      size="md"
      centered
      draggable
      closeOnClickOutside={false}
    >
      {trip && (
        <Stack gap="sm">
          <Alert
            color="red"
            icon={
              <IconAlertTriangle
                size={22}
              />
            }
            title={i18next.t(
              "ui.automaticSafetyEmergencyStop"
            )}
          >
            {reasonLabel}
          </Alert>

          <DetailRow
            label={i18next.t(
              "ui.safetyReason"
            )}
            value={trip.reason}
          />

          <DetailRow
            label={i18next.t("ui.block")}
            value={
              trip.blockName
                ? `${trip.blockName} (#${trip.blockId})`
                : `#${trip.blockId}`
            }
          />

          <DetailRow
            label={i18next.t("ui.sensor")}
            value={
              `#${trip.sensorAddress}`
            }
          />

          {trip.expectedLocoAddress !==
            null && (
            <DetailRow
              label={i18next.t(
                "ui.expectedLocomotive"
              )}
              value={
                `#${trip.expectedLocoAddress}`
              }
            />
          )}

          <DetailRow
            label={i18next.t(
              "ui.activeLocomotives"
            )}
            value={
              trip
                .activeLocoAddresses
                .length > 0
                ? trip
                    .activeLocoAddresses
                    .map(
                      address =>
                        `#${address}`
                    )
                    .join(", ")
                : "—"
            }
          />

          <DetailRow
            label={i18next.t(
              "ui.affectedMovements"
            )}
            value={
              trip.movementNames.length >
                0
                ? trip.movementNames.join(
                    ", "
                  )
                : "—"
            }
          />

          <Group
            justify="space-between"
            align="center"
          >
            <Text
              size="sm"
              c="dimmed"
            >
              {i18next.t(
                "ui.emergencyStopState"
              )}
            </Text>

            <Badge
              color={
                trip.emergencyStopActive
                  ? "red"
                  : "yellow"
              }
              variant={
                trip.emergencyStopActive
                  ? "filled"
                  : "light"
              }
            >
              {trip.emergencyStopActive
                ? i18next.t(
                    "ui.emergencyStopActive"
                  )
                : i18next.t(
                    "ui.emergencyStopCouldNotBeConfirmed"
                  )}
            </Badge>
          </Group>

          <Text
            size="xs"
            c="dimmed"
          >
            {i18next.t(
              "ui.safetyEmergencyStopHint"
            )}
          </Text>

          <Button
            color="red"
            onClick={close}
          >
            {i18next.t(
              "ui.acknowledge"
            )}
          </Button>
        </Stack>
      )}
    </AppModal>
  );
}
