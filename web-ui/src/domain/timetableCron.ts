const MINUTES_PER_DAY = 24 * 60;
const MINUTE_MS = 60 * 1000;

export type TimetableCronOccurrence = {
  absoluteMinute: number;
  minuteOfDay: number;
  dayOffset: number;
  hour: number;
  minute: number;
};

type ParsedCron = {
  minutes: Set<number>;
  hours: Set<number>;
};

function validCronNumber(
  raw: string,
  min: number,
  max: number
): boolean {
  if (!/^\d+$/.test(raw)) {
    return false;
  }

  const value = Number(raw);
  return value >= min && value <= max;
}

function expandCronPart(
  rawPart: string,
  min: number,
  max: number
): number[] | null {
  const part = rawPart.trim();

  if (!part) {
    return null;
  }

  const slash = part.split("/");

  if (slash.length > 2) {
    return null;
  }

  const base = slash[0] ?? "";
  const stepRaw = slash[1];
  let step = 1;

  if (stepRaw !== undefined) {
    if (!/^\d+$/.test(stepRaw)) {
      return null;
    }

    step = Number(stepRaw);

    if (step < 1) {
      return null;
    }
  }

  let start: number;
  let end: number;

  if (base === "*") {
    start = min;
    end = max;
  } else {
    const range = base.split("-");
    const rangeStart = range[0] ?? "";

    if (range.length === 1) {
      if (!validCronNumber(rangeStart, min, max)) {
        return null;
      }

      start = Number(rangeStart);
      end = stepRaw === undefined ? start : max;
    } else if (range.length === 2) {
      const rangeEnd = range[1] ?? "";

      if (
        !validCronNumber(rangeStart, min, max) ||
        !validCronNumber(rangeEnd, min, max)
      ) {
        return null;
      }

      start = Number(rangeStart);
      end = Number(rangeEnd);

      if (start > end) {
        return null;
      }
    } else {
      return null;
    }
  }

  const values: number[] = [];

  for (let value = start; value <= end; value += step) {
    values.push(value);
  }

  return values;
}

function expandCronField(
  field: string,
  min: number,
  max: number
): Set<number> | null {
  const values = new Set<number>();
  const parts = field.split(",");

  for (const part of parts) {
    const expanded = expandCronPart(part, min, max);

    if (!expanded) {
      return null;
    }

    for (const value of expanded) {
      values.add(value);
    }
  }

  return values.size > 0 ? values : null;
}

function parseTimetableCron(
  cron: string
): ParsedCron | null {
  const fields = cron.trim().split(/\s+/);

  if (fields.length !== 2) {
    return null;
  }

  const minuteField = fields[0] ?? "";
  const hourField = fields[1] ?? "";

  const minutes = expandCronField(minuteField, 0, 59);
  const hours = expandCronField(hourField, 0, 23);

  if (!minutes || !hours) {
    return null;
  }

  return { minutes, hours };
}

export function isValidTimetableCron(
  cron: string
): boolean {
  return parseTimetableCron(cron) !== null;
}

export function timetableCronMatches(
  cron: string,
  hour: number,
  minute: number
): boolean {
  const parsed = parseTimetableCron(cron);

  if (!parsed) {
    return false;
  }

  return parsed.hours.has(hour) && parsed.minutes.has(minute);
}

/**
 * Expands a two-field railway cron into concrete HH:MM occurrences in a rolling
 * FastClock window. The current partially elapsed minute is intentionally not
 * returned; the first candidate is the next FastClock minute.
 */
export function enumerateTimetableCronOccurrences(
  cron: string,
  fastClockTimeMs: number,
  windowMinutes = 60
): TimetableCronOccurrence[] {
  const parsed = parseTimetableCron(cron);

  if (!parsed || windowMinutes <= 0) {
    return [];
  }

  const dayMs = MINUTES_PER_DAY * MINUTE_MS;
  const normalizedMs = ((fastClockTimeMs % dayMs) + dayMs) % dayMs;
  const currentMinuteOfDay = Math.floor(normalizedMs / MINUTE_MS);
  const firstAbsoluteMinute = currentMinuteOfDay + 1;
  const result: TimetableCronOccurrence[] = [];

  for (let offset = 0; offset < windowMinutes; offset += 1) {
    const absoluteMinute = firstAbsoluteMinute + offset;
    const dayOffset = Math.floor(absoluteMinute / MINUTES_PER_DAY);
    const minuteOfDay =
      ((absoluteMinute % MINUTES_PER_DAY) + MINUTES_PER_DAY) %
      MINUTES_PER_DAY;
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;

    if (parsed.hours.has(hour) && parsed.minutes.has(minute)) {
      result.push({
        absoluteMinute,
        minuteOfDay,
        dayOffset,
        hour,
        minute,
      });
    }
  }

  return result;
}
