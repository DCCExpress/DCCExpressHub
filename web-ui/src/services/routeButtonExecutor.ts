import {
  isTurnoutElement,
  type LayoutView,
} from "../models/editor/core/LayoutView";

import type {
  RouteButtonElementView,
} from "../models/editor/elements/RouteButtonElementView";

import TrackTurnoutDoubleElementView from "../models/editor/elements/TrackTurnoutDoubleElementView";
import {
  TrackTurnoutThreeWayElementView,
} from "../models/editor/elements/TrackTurnoutThreeWayElementView";

import {
  getTurnoutClosedAspect,
  getTurnoutOpenedAspect,
} from "../models/editor/turnout/turnoutAccessoryHelpers";

import {
  sleep,
} from "../helpers";

import {
  sendTurnoutOutput,
} from "./layoutOutput";
import {
  wsApi,
} from "./wsApi";

type ExecuteLegacyRouteButtonParams = {
  routeButton: RouteButtonElementView;
  layout: LayoutView;
  commandCenterLocked: boolean;
  busyText?: string;
  setBusy?: (busy: boolean, text?: string) => void;
  onCommandCenterBusy?: () => void;
};

export async function executeLegacyRouteButton({
  routeButton,
  layout,
  commandCenterLocked,
  busyText,
  setBusy,
  onCommandCenterBusy,
}: ExecuteLegacyRouteButtonParams): Promise<boolean> {
  if (commandCenterLocked) {
    onCommandCenterBusy?.();
    return false;
  }

  if (routeButton.routeTurnouts.length === 0) {
    return false;
  }

  const elements = layout.getAllElements();

  wsApi.routeLock();
  setBusy?.(true, busyText);

  await sleep(1000);

  try {
    for (const routeTurnout of routeButton.routeTurnouts) {
      const turnout = elements.find(
        element => element.id === routeTurnout.turnoutId
      );

      if (
        turnout instanceof TrackTurnoutDoubleElementView ||
        turnout instanceof TrackTurnoutThreeWayElementView
      ) {
        const first = routeTurnout.closed;
        const second = routeTurnout.secondClosed ?? turnout.turnout2Closed;

        turnout.turnout1Closed = first;
        turnout.turnout2Closed = second;

        sendTurnoutOutput(
          String(turnout.outputMode),
          turnout.turnout1Address,
          first,
          { closedValue: turnout.turnout1ClosedValue }
        );

        sendTurnoutOutput(
          String(turnout.outputMode),
          turnout.turnout2Address,
          second,
          { closedValue: turnout.turnout2ClosedValue }
        );

        await sleep(1000);
        continue;
      }

      if (!isTurnoutElement(turnout)) {
        continue;
      }

      turnout.turnoutClosed = routeTurnout.closed;

      sendTurnoutOutput(
        String((turnout as any).outputMode),
        turnout.turnoutAddress,
        routeTurnout.closed,
        {
          closedValue: turnout.turnoutClosedValue,
          closedAspect: getTurnoutClosedAspect(turnout),
          openedAspect: getTurnoutOpenedAspect(turnout),
        }
      );

      await sleep(1000);
    }

    return true;
  } finally {
    wsApi.routeUnlock();
    setBusy?.(false);
  }
}
