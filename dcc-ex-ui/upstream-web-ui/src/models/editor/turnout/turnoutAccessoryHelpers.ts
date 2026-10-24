export type TurnoutOutputMode =
  | "accessory"
  | "extended";

type TurnoutAspectValues = {
  turnoutClosedAspect?: number;
  turnoutOpenedAspect?: number;
};

type DoubleTurnoutAspectValues = {
  turnout1ClosedAspect?: number;
  turnout1OpenedAspect?: number;
  turnout2ClosedAspect?: number;
  turnout2OpenedAspect?: number;
};

export const DEFAULT_TURNOUT_CLOSED_ASPECT = 0;
export const DEFAULT_TURNOUT_OPENED_ASPECT = 1;

export function normalizeTurnoutOutputMode(
  value: unknown
): TurnoutOutputMode {
  return value === "extended"
    ? "extended"
    : "accessory";
}

export function normalizeTurnoutAspect(
  value: unknown,
  fallback: number
): number {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(
    0,
    Math.min(
      255,
      Math.trunc(numeric)
    )
  );
}

export function getTurnoutClosedAspect(
  element: unknown
): number {
  return normalizeTurnoutAspect(
    (element as TurnoutAspectValues)
      .turnoutClosedAspect,
    DEFAULT_TURNOUT_CLOSED_ASPECT
  );
}

export function getTurnoutOpenedAspect(
  element: unknown
): number {
  return normalizeTurnoutAspect(
    (element as TurnoutAspectValues)
      .turnoutOpenedAspect,
    DEFAULT_TURNOUT_OPENED_ASPECT
  );
}

export function getDoubleTurnoutAspect(
  element: unknown,
  turnoutIndex: 1 | 2,
  logicalClosed: boolean
): number {
  const values =
    element as DoubleTurnoutAspectValues;

  if (turnoutIndex === 1) {
    return normalizeTurnoutAspect(
      logicalClosed
        ? values.turnout1ClosedAspect
        : values.turnout1OpenedAspect,
      logicalClosed
        ? DEFAULT_TURNOUT_CLOSED_ASPECT
        : DEFAULT_TURNOUT_OPENED_ASPECT
    );
  }

  return normalizeTurnoutAspect(
    logicalClosed
      ? values.turnout2ClosedAspect
      : values.turnout2OpenedAspect,
    logicalClosed
      ? DEFAULT_TURNOUT_CLOSED_ASPECT
      : DEFAULT_TURNOUT_OPENED_ASPECT
  );
}
