import {
  NumberInput,
  SimpleGrid,
  Stack,
  Switch,
  Text,
} from "@mantine/core";

import AppModal from "../../components/common/AppModal";

import type {
  LocoPanelCounterDisplaySettings,
} from "../../services/locoPanelCounterDisplaySettings";

type Props = {
  opened: boolean;
  settings:
    LocoPanelCounterDisplaySettings;
  onClose: () => void;
  onChange: (
    patch:
      Partial<LocoPanelCounterDisplaySettings>
  ) => void;
  t: (
    key: string
  ) => string;
};

export default function LocoPanelSettingsDialog({
  opened,
  settings,
  onClose,
  onChange,
  t,
}: Props) {
  return (
    <AppModal
      opened={
        opened
      }
      onClose={
        onClose
      }
      title={t(
        "locopanel.counter_settings_title"
      )}
      centered
      draggable
      headerHeight={40}
      size="md"
    >
      <Stack gap="md">
        <Stack gap="xs">
          <Text fw={700}>
            {t(
              "locopanel.counter_visibility"
            )}
          </Text>

          <Switch
            label={t(
              "locopanel.show_km"
            )}
            checked={
              settings.showKm
            }
            onChange={
              event =>
                onChange({
                  showKm:
                    event
                      .currentTarget
                      .checked,
                })
            }
          />

          <Switch
            label={t(
              "locopanel.show_worktime"
            )}
            checked={
              settings.showWorktime
            }
            onChange={
              event =>
                onChange({
                  showWorktime:
                    event
                      .currentTarget
                      .checked,
                })
            }
          />

          <Switch
            label={t(
              "locopanel.counter_daily_mode"
            )}
            description={t(
              "locopanel.counter_daily_mode_description"
            )}
            checked={
              settings.daily
            }
            onChange={
              event =>
                onChange({
                  daily:
                    event
                      .currentTarget
                      .checked,
                })
            }
          />
        </Stack>

        <Stack gap="xs">
          <Text fw={700}>
            {t(
              "locopanel.counter_display"
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
                "locopanel.counter_digits"
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
                  onChange({
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
                "locopanel.counter_digit_height"
              )}
              value={
                settings.digitHeight
              }
              min={18}
              max={48}
              suffix=" px"
              allowDecimal={
                false
              }
              onChange={
                value =>
                  onChange({
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
                "locopanel.counter_km_decimals"
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
                  onChange({
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
                "locopanel.counter_worktime_decimals"
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
                  onChange({
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
              "locopanel.counter_accent_fraction"
            )}
            checked={
              settings.accentFraction
            }
            onChange={
              event =>
                onChange({
                  accentFraction:
                    event
                      .currentTarget
                      .checked,
                })
            }
          />
        </Stack>

      </Stack>
    </AppModal>
  );
}
