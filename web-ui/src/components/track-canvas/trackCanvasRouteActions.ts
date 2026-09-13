
import type {
  TFunction,
} from "i18next";

import {
  showErrorMessage,
  showOkMessage,
  showWarningMessage,
  sleep,
} from "../../helpers";

import {
  isTurnoutElement,
  type LayoutView,
} from "../../models/editor/core/LayoutView";

import type {
  ExtendedRouteButtonElementView,
} from "../../models/editor/elements/ExtendedRouteButtonElementView";

import type {
  RouteButtonElementView,
} from "../../models/editor/elements/RouteButtonElementView";

import TrackTurnoutDoubleElementView from "../../models/editor/elements/TrackTurnoutDoubleElementView";
import {
  TrackTurnoutThreeWayElementView,
} from "../../models/editor/elements/TrackTurnoutThreeWayElementView";

import {
  routeGraphStore,
} from "../../services/routeGraphStore";

import {
  sendTurnoutOutput,
} from "../../services/layoutOutput";
import {
  wsApi,
} from "../../services/wsApi";

export type RouteBusySetter = (
  busy: boolean,
  text?: string
) => void;

export type TrackCanvasRouteActionContext = {
  t: TFunction;
  commandCenterLocked: boolean;
  setBusy?: RouteBusySetter | undefined;
  onInvalidate?: (() => void) | undefined;
};

export async function executeRouteButton(
  routeButton: RouteButtonElementView,
  layout: LayoutView,
  context: TrackCanvasRouteActionContext
): Promise<void> {
  const {
    t,
    commandCenterLocked,
    setBusy,
    onInvalidate,
  } = context;

  if (commandCenterLocked) {
    showWarningMessage(
      t("common.error"),
      t("routesPanel.commandCenterBusy")
    );

    return;
  }

  const elements =
    layout.getAllElements();

  wsApi.routeLock();
  setBusy?.(
    true,
    t("routesPanel.routeIsBeingSet")
  );

  await sleep(1000);

  try {
    for (const routeTurnout of routeButton.routeTurnouts) {
      const element = elements.find(
        candidate => candidate.id === routeTurnout.turnoutId
      );

      if (
        element instanceof TrackTurnoutDoubleElementView ||
        element instanceof TrackTurnoutThreeWayElementView
      ) {
        const first = routeTurnout.closed;
        const second = routeTurnout.secondClosed ?? element.turnout2Closed;

        element.turnout1Closed = first;
        element.turnout2Closed = second;

        sendTurnoutOutput(
          element.outputMode,
          element.turnout1Address,
          first,
          { closedValue: element.turnout1ClosedValue }
        );

        sendTurnoutOutput(
          element.outputMode,
          element.turnout2Address,
          second,
          { closedValue: element.turnout2ClosedValue }
        );

        await sleep(1000);
        continue;
      }

      if (!isTurnoutElement(element)) {
        continue;
      }

      element.turnoutClosed = routeTurnout.closed;
      sendTurnoutOutput(
        element.outputMode,
        element.turnoutAddress,
        routeTurnout.closed
      );

      await sleep(1000);
    }
    // Route execution updates the client-side turnout runtime state directly.
    // Recalculate RouteButton active state and route highlighting immediately,
    // instead of waiting for a later turnout-state feedback event.
    layout.checkRoutes();
    onInvalidate?.();
  } finally {
    wsApi.routeUnlock();
    setBusy?.(false);
  }
}

export async function executeExtendedRouteButton(
  routeButton: ExtendedRouteButtonElementView,
  context: TrackCanvasRouteActionContext
): Promise<void> {
  const { t, commandCenterLocked } =
    context;

  if (!routeButton.fromBlockId || !routeButton.toBlockId) {
    showWarningMessage(
      t("common.error"),
      t("routesPanel.automaticRouteMissingBlocks")
    );

    return;
  }

  try {
    const graph =
      await routeGraphStore.ensureLoaded();

    if (!graph) {
      showWarningMessage(
        t("common.error"),
        t("routesPanel.noServerGraph")
      );

      return;
    }

    const fromBlock =
      graph.findBlockById(routeButton.fromBlockId);

    const toBlock =
      graph.findBlockById(routeButton.toBlockId);

    if (!fromBlock || !toBlock) {
      showWarningMessage(
        t("common.error"),
        t("routesPanel.configuredBlocksMissing")
      );

      return;
    }

    if (routeButton.active) {
      wsApi.releaseRouteReservation(
        fromBlock.name,
        toBlock.name
      );

      showOkMessage(
        t("routesPanel.releaseRequest"),
        t("routesPanel.releaseRequested", {
          from: fromBlock.label,
          to: toBlock.label,
        })
      );

      return;
    }

    if (commandCenterLocked) {
      showWarningMessage(
        t("common.error"),
        t("routesPanel.commandCenterBusy")
      );

      return;
    }

    wsApi.reserveRoute(
      fromBlock.name,
      toBlock.name
    );

    showOkMessage(
      t("routesPanel.routeRequest"),
      t("routesPanel.reservationRequested", {
        from: fromBlock.label,
        to: toBlock.label,
      })
    );
  } catch (error) {
    showErrorMessage(
      t("common.error"),
      error instanceof Error
        ? error.message
        : t("routesPanel.automaticRouteFailed")
    );
  }
}
