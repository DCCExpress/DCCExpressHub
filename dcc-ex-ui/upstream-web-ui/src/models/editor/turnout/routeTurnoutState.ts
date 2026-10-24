type RouteReference = { closed: boolean; secondClosed?: boolean };
type MultiMotorTurnout = {
  getAllowedRoutes(): { turnoutStates: readonly { closed: boolean }[] }[];
};

/** Old route buttons saved only motor 1. Recover motor 2 only when the
 * configured physical position table determines it unambiguously. */
export function resolveRouteSecondClosed(
  turnout: MultiMotorTurnout,
  reference: RouteReference
): boolean | undefined {
  if (typeof reference.secondClosed === "boolean") return reference.secondClosed;
  const candidates = new Set(turnout.getAllowedRoutes()
    .filter(route => route.turnoutStates[0]?.closed === reference.closed)
    .map(route => route.turnoutStates[1]?.closed)
    .filter((value): value is boolean => typeof value === "boolean"));
  return candidates.size === 1 ? candidates.values().next().value : undefined;
}
