import type {
  LocoCounterSettings,
} from "./domainTypes";

export const DEFAULT_LOCO_COUNTER_SETTINGS:
  LocoCounterSettings = {
    enabled: true,
    digits: 6,
    digitHeight: 28,
    distanceDecimals: 1,
    operatingHoursDecimals: 1,
    accentFraction: true,
  };

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const numeric =
    Number(
      value
    );

  if (
    !Number.isFinite(
      numeric
    )
  ) {
    return fallback;
  }

  return Math.max(
    min,
    Math.min(
      max,
      Math.round(
        numeric
      )
    )
  );
}

export function resolveLocoCounterSettings(
  settings:
    Partial<LocoCounterSettings> |
    null |
    undefined
): LocoCounterSettings {
  return {
    enabled:
      settings?.enabled ??
      DEFAULT_LOCO_COUNTER_SETTINGS.enabled,
    digits:
      clampInteger(
        settings?.digits,
        DEFAULT_LOCO_COUNTER_SETTINGS.digits,
        3,
        9
      ),
    digitHeight:
      clampInteger(
        settings?.digitHeight,
        DEFAULT_LOCO_COUNTER_SETTINGS.digitHeight,
        18,
        48
      ),
    distanceDecimals:
      clampInteger(
        settings?.distanceDecimals,
        DEFAULT_LOCO_COUNTER_SETTINGS.distanceDecimals,
        0,
        2
      ),
    operatingHoursDecimals:
      clampInteger(
        settings?.operatingHoursDecimals,
        DEFAULT_LOCO_COUNTER_SETTINGS.operatingHoursDecimals,
        0,
        2
      ),
    accentFraction:
      settings?.accentFraction ??
      DEFAULT_LOCO_COUNTER_SETTINGS.accentFraction,
  };
}
