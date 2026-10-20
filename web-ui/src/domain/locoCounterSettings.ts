import type {
  LocoCounterSettings,
} from "./domainTypes";

export const DEFAULT_LOCO_COUNTER_SETTINGS:
  LocoCounterSettings = {
    maxScaleSpeedKmh: 120,
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
    maxScaleSpeedKmh:
      clampInteger(
        settings?.maxScaleSpeedKmh,
        DEFAULT_LOCO_COUNTER_SETTINGS.maxScaleSpeedKmh,
        1,
        400
      ),
  };
}
