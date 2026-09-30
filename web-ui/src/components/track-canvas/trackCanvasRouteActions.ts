
import type {
  TFunction,
} from "i18next";

import {
  showErrorMessage,
  showOkMessage,
  showWarningMessage,
} from "../../helpers";

import {
  type LayoutView,
} from "../../models/editor/core/LayoutView";

import type {
  ExtendedRouteButtonElement,
} from "../../models/editor/elements/ExtendedRouteButtonElement";

import type {
  RouteButtonElement,
} from "../../models/editor/elements/RouteButtonElement";

import {
  routeGraphStore,
} from "../../services/routeGraphStore";

import { executeLegacyRouteButton } from "../../services/routeButtonExecutor";
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
  routeButton: RouteButtonElement,
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

  const completed = await executeLegacyRouteButton({
    routeButton,
    layout,
    commandCenterLocked,
    busyText: t("routesPanel.routeIsBeingSet"),
    ...(setBusy ? { setBusy } : {}),
    ...(onInvalidate ? { onInvalidate } : {}),
  });
  if (!completed) {
    showWarningMessage(t("common.error"), t("routesPanel.automaticRouteFailed"));
  }
}

export async function executeExtendedRouteButton(
  routeButton: ExtendedRouteButtonElement,
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
      layout.getElementById(
        routeButton.fromBlockId
      );

    const toBlock =
      layout.getElementById(
        routeButton.toBlockId
      );

    if (
      !fromBlock ||
      !toBlock ||
      fromBlock.type !==
        "trackblock" ||
      toBlock.type !==
        "trackblock"
    ) {
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
          from: fromBlock.name || String(fromBlock.id),
          to: toBlock.name || String(toBlock.id),
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
        from: fromBlock.name || String(fromBlock.id),
        to: toBlock.name || String(toBlock.id),
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
