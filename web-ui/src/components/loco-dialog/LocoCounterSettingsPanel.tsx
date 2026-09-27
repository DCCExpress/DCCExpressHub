import {
  Card,
  Group,
  NumberInput,
  SimpleGrid,
  Stack,
  Switch,
  Text,
} from "@mantine/core";

import type {
  Loco,
  LocoCounterSettings,
} from "@domain/types";

import {
  resolveLocoCounterSettings,
} from "@domain/locoCounterSettings";

import MechanicalCounter from "../MechanicalCounter";

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

      <Card
        withBorder
        radius="sm"
        p="sm"
      >
        <Text
          size="xs"
          c="dimmed"
          mb="xs"
        >
          {t(
            "locodialog.counters_preview"
          )}
        </Text>

        <Stack
          gap={6}
          align="center"
        >
          <MechanicalCounter
            label="KM"
            value={
              loco.odometerKm ??
              0
            }
            digits={
              settings.digits
            }
            decimals={
              settings.distanceDecimals
            }
            digitHeight={
              settings.digitHeight
            }
            unit="km"
            accentFraction={
              settings.accentFraction
            }
          />

          <MechanicalCounter
            label="H"
            value={
              loco.operatingHours ??
              0
            }
            digits={
              settings.digits
            }
            decimals={
              settings.operatingHoursDecimals
            }
            digitHeight={
              settings.digitHeight
            }
            unit="h"
            accentFraction={
              settings.accentFraction
            }
          />
        </Stack>
      </Card>

      <Switch
        label={t(
          "locodialog.counters_enabled"
        )}
        checked={
          settings.enabled
        }
        onChange={
          event =>
            patchSettings({
              enabled:
                event
                  .currentTarget
                  .checked,
            })
        }
      />

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
            "locodialog.counter_digits"
          )}
          value={
            settings.digits
          }
          min={3}
          max={9}
          allowDecimal={
            false
          }
          onChange={
            value =>
              patchSettings({
                digits:
                  Number(
                    value
                  ) ||
                  3,
              })
          }
        />

        <NumberInput
          label={t(
            "locodialog.counter_digit_height"
          )}
          value={
            settings.digitHeight
          }
          min={18}
          max={48}
          allowDecimal={
            false
          }
          onChange={
            value =>
              patchSettings({
                digitHeight:
                  Number(
                    value
                  ) ||
                  18,
              })
          }
        />

        <NumberInput
          label={t(
            "locodialog.counter_distance_decimals"
          )}
          value={
            settings.distanceDecimals
          }
          min={0}
          max={2}
          allowDecimal={
            false
          }
          onChange={
            value =>
              patchSettings({
                distanceDecimals:
                  Number(
                    value
                  ) ||
                  0,
              })
          }
        />

        <NumberInput
          label={t(
            "locodialog.counter_hours_decimals"
          )}
          value={
            settings.operatingHoursDecimals
          }
          min={0}
          max={2}
          allowDecimal={
            false
          }
          onChange={
            value =>
              patchSettings({
                operatingHoursDecimals:
                  Number(
                    value
                  ) ||
                  0,
              })
          }
        />
      </SimpleGrid>

      <Switch
        label={t(
          "locodialog.counter_accent_fraction"
        )}
        checked={
          settings.accentFraction
        }
        onChange={
          event =>
            patchSettings({
              accentFraction:
                event
                  .currentTarget
                  .checked,
            })
        }
      />
    </Stack>
  );
}
