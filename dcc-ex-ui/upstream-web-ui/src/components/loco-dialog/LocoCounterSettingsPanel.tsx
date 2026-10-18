import {
  NumberInput,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";

import type {
  Loco,
  LocoCounterSettings,
} from "@domain/types";

import {
  resolveLocoCounterSettings,
} from "@domain/locoCounterSettings";

type Props = {
  loco: Loco;
  onPatch: (
    patch:
      Partial<Loco>
  ) => void;
  t: (
    key: string
  ) => string;
};

export default function LocoCounterSettingsPanel({
  loco,
  onPatch,
  t,
}: Props) {
  const settings =
    resolveLocoCounterSettings(
      loco.counterSettings
    );

  const patchSettings = (
    patch:
      Partial<LocoCounterSettings>
  ) => {
    onPatch({
      counterSettings: {
        ...settings,
        ...patch,
      },
    });
  };

  return (
    <Stack gap="sm">
      <Text fw={700}>
        {t(
          "locodialog.counters_title"
        )}
      </Text>

      <SimpleGrid
        cols={{
          base: 1,
          sm: 2,
        }}
        spacing="sm"
      >
        <NumberInput
          label={t(
            "locodialog.odometer_km"
          )}
          value={
            loco.odometerKm ??
            0
          }
          min={0}
          decimalScale={3}
          allowNegative={
            false
          }
          onChange={
            value =>
              onPatch({
                odometerKm:
                  Math.max(
                    0,
                    Number(
                      value
                    ) ||
                      0
                  ),
              })
          }
        />

        <NumberInput
          label={t(
            "locodialog.operating_hours"
          )}
          value={
            loco.operatingHours ??
            0
          }
          min={0}
          decimalScale={3}
          allowNegative={
            false
          }
          onChange={
            value =>
              onPatch({
                operatingHours:
                  Math.max(
                    0,
                    Number(
                      value
                    ) ||
                      0
                  ),
              })
          }
        />

        <NumberInput
          label={t(
            "locodialog.counter_max_scale_speed"
          )}
          value={
            settings.maxScaleSpeedKmh
          }
          min={1}
          max={400}
          suffix=" km/h"
          allowDecimal={
            false
          }
          onChange={
            value =>
              patchSettings({
                maxScaleSpeedKmh:
                  Number(
                    value
                  ) ||
                  1,
              })
          }
        />
      </SimpleGrid>

      <Text
        size="xs"
        c="dimmed"
      >
        {t(
          "locodialog.counter_display_global_hint"
        )}
      </Text>
    </Stack>
  );
}
