export type LocoPanelCounterDisplaySettings = {
  showKm: boolean;
  showWorktime: boolean;
  daily: boolean;
  digits: number;
  digitHeight: number;
  distanceDecimals: number;
  operatingHoursDecimals: number;
  accentFraction: boolean;
};

const STORAGE_KEY =
  "dcc-express.loco-panel.counter-display-settings.v2";

const LEGACY_STORAGE_KEY =
  "dcc-express.loco-panel.counter-display-settings.v1";

export const DEFAULT_LOCO_PANEL_COUNTER_DISPLAY_SETTINGS:
  LocoPanelCounterDisplaySettings = {
    showKm: true,
    showWorktime: true,
    daily: false,
    digits: 6,
    digitHeight: 24,
    distanceDecimals: 1,
    operatingHoursDecimals: 1,
    accentFraction: true,
  };

type Listener =
  (
    settings:
      LocoPanelCounterDisplaySettings
  ) => void;

const listeners =
  new Set<Listener>();

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

function normalize(
  value:
    Partial<LocoPanelCounterDisplaySettings> |
    null |
    undefined
): LocoPanelCounterDisplaySettings {
  return {
    showKm:
      value?.showKm ??
      DEFAULT_LOCO_PANEL_COUNTER_DISPLAY_SETTINGS.showKm,
    showWorktime:
      value?.showWorktime ??
      DEFAULT_LOCO_PANEL_COUNTER_DISPLAY_SETTINGS.showWorktime,
    daily:
      value?.daily ??
      DEFAULT_LOCO_PANEL_COUNTER_DISPLAY_SETTINGS.daily,
    digits:
      clampInteger(
        value?.digits,
        DEFAULT_LOCO_PANEL_COUNTER_DISPLAY_SETTINGS.digits,
        3,
        9
      ),
    digitHeight:
      clampInteger(
        value?.digitHeight,
        DEFAULT_LOCO_PANEL_COUNTER_DISPLAY_SETTINGS.digitHeight,
        18,
        48
      ),
    distanceDecimals:
      clampInteger(
        value?.distanceDecimals,
        DEFAULT_LOCO_PANEL_COUNTER_DISPLAY_SETTINGS.distanceDecimals,
        0,
        2
      ),
    operatingHoursDecimals:
      clampInteger(
        value?.operatingHoursDecimals,
        DEFAULT_LOCO_PANEL_COUNTER_DISPLAY_SETTINGS.operatingHoursDecimals,
        0,
        2
      ),
    accentFraction:
      value?.accentFraction ??
      DEFAULT_LOCO_PANEL_COUNTER_DISPLAY_SETTINGS.accentFraction,
  };
}

function readStored():
  LocoPanelCounterDisplaySettings {
  try {
    const raw =
      window.localStorage.getItem(
        STORAGE_KEY
      );

    if (raw) {
      return normalize(
        JSON.parse(
          raw
        ) as Partial<LocoPanelCounterDisplaySettings>
      );
    }

    const legacyRaw =
      window.localStorage.getItem(
        LEGACY_STORAGE_KEY
      );

    if (legacyRaw) {
      const legacy =
        JSON.parse(
          legacyRaw
        ) as Partial<LocoPanelCounterDisplaySettings>;

      const migrated =
        normalize({
          ...legacy,
          digitHeight:
            Math.max(
              18,
              (
                Number(
                  legacy.digitHeight
                ) ||
                28
              ) -
                4
            ),
        });

      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          migrated
        )
      );

      return migrated;
    }

    return {
      ...DEFAULT_LOCO_PANEL_COUNTER_DISPLAY_SETTINGS,
    };
  } catch {
    return {
      ...DEFAULT_LOCO_PANEL_COUNTER_DISPLAY_SETTINGS,
    };
  }
}

let current =
  typeof window !==
    "undefined"
    ? readStored()
    : {
        ...DEFAULT_LOCO_PANEL_COUNTER_DISPLAY_SETTINGS,
      };

function emit(): void {
  for (
    const listener of
    listeners
  ) {
    listener(
      current
    );
  }
}

export function getLocoPanelCounterDisplaySettings():
  LocoPanelCounterDisplaySettings {
  return current;
}

export function setLocoPanelCounterDisplaySettings(
  patch:
    Partial<LocoPanelCounterDisplaySettings>
): LocoPanelCounterDisplaySettings {
  current =
    normalize({
      ...current,
      ...patch,
    });

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        current
      )
    );
  } catch {
    // Keep the in-memory setting if localStorage is unavailable.
  }

  emit();

  return current;
}

export function subscribeLocoPanelCounterDisplaySettings(
  listener:
    Listener
): () => void {
  listeners.add(
    listener
  );

  return () => {
    listeners.delete(
      listener
    );
  };
}

if (
  typeof window !==
  "undefined"
) {
  window.addEventListener(
    "storage",
    event => {
      if (
        event.key !==
          STORAGE_KEY
      ) {
        return;
      }

      current =
        readStored();

      emit();
    }
  );
}
