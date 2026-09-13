import { isTurnoutElement, type LayoutView } from "../models/editor/core/LayoutView";
import type { RouteButtonElement } from "../models/editor/elements/RouteButtonElement";
import TrackTurnoutDoubleElement from "../models/editor/elements/TrackTurnoutDoubleElement";
import { TrackTurnoutThreeWayElement } from "../models/editor/elements/TrackTurnoutThreeWayElement";
import { getTurnoutClosedAspect, getTurnoutOpenedAspect } from "../models/editor/turnout/turnoutAccessoryHelpers";
import { sleep } from "../helpers";
import { sendTurnoutOutput } from "./layoutOutput";
import { wsApi } from "./wsApi";
import { resolveRouteSecondClosed } from "../models/editor/turnout/routeTurnoutState";

type ExecuteLegacyRouteButtonParams = {
  routeButton: RouteButtonElement;
  layout: LayoutView;
  commandCenterLocked: boolean;
  busyText?: string;
  setBusy?: (busy: boolean, text?: string) => void;
  onCommandCenterBusy?: () => void;
  onInvalidate?: () => void;
};

// Prevent a second click before the command center's lock event arrives.
let routeExecutionInProgress = false;

/** Shared by the canvas button and the property editor's Test route action. */
export async function executeLegacyRouteButton({
  routeButton, layout, commandCenterLocked, busyText, setBusy,
  onCommandCenterBusy, onInvalidate,
}: ExecuteLegacyRouteButtonParams): Promise<boolean> {
  if (commandCenterLocked || routeExecutionInProgress) {
    onCommandCenterBusy?.();
    return false;
  }
  if (routeButton.routeTurnouts.length === 0) return false;

  // Snapshot the configuration before sending; incomplete references must not
  // silently produce a partially set route or guess a second motor position.
  const turnouts = routeButton.routeTurnouts.map(reference => {
    const element = layout.getElementById(reference.turnoutId);
    const secondClosed = element instanceof TrackTurnoutDoubleElement || element instanceof TrackTurnoutThreeWayElement
      ? resolveRouteSecondClosed(element, reference)
      : reference.secondClosed;
    return { ...reference, element, secondClosed };
  });
  if (turnouts.some(({ element, secondClosed }) => {
    if (element instanceof TrackTurnoutDoubleElement || element instanceof TrackTurnoutThreeWayElement) {
      return typeof secondClosed !== "boolean";
    }
    return !isTurnoutElement(element);
  })) return false;

  const refresh = () => {
    layout.checkRoutes();
    onInvalidate?.();
  };

  if (!wsApi.routeLock()) return false;
  routeExecutionInProgress = true;
  try {
    setBusy?.(true, busyText);
    for (const { element, closed, secondClosed } of turnouts) {
      if (element instanceof TrackTurnoutDoubleElement || element instanceof TrackTurnoutThreeWayElement) {
        const firstSent = sendTurnoutOutput(element.outputMode, element.turnout1Address, closed, {
          closedValue: element.turnout1ClosedValue,
        });
        if (!firstSent) return false;
        element.turnout1Closed = closed;

        const secondSent = sendTurnoutOutput(element.outputMode, element.turnout2Address, secondClosed!, {
          closedValue: element.turnout2ClosedValue,
        });
        if (!secondSent) return false;
        element.turnout2Closed = secondClosed!;
      } else if (isTurnoutElement(element)) {
        const sent = sendTurnoutOutput(element.outputMode, element.turnoutAddress, closed, {
          closedValue: element.turnoutClosedValue,
          closedAspect: getTurnoutClosedAspect(element),
          openedAspect: getTurnoutOpenedAspect(element),
        });
        if (!sent) return false;
        element.turnoutClosed = closed;
      }

      // Indicate only the state actually sent so far. Subsequent hardware
      // feedback remains authoritative and rechecks every matching route.
      refresh();
      await sleep(250);
    }
    return true;
  } finally {
    routeExecutionInProgress = false;
    wsApi.routeUnlock();
    setBusy?.(false);
    refresh();
  }
}
