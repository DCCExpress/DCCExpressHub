
import type {
  TFunction,
} from "i18next";

import {
  showNotification,
} from "@mantine/notifications";

import type {
  BaseElementView,
} from "../../models/editor/core/BaseElementView";

import {
  ClickableBaseElementView,
} from "../../models/editor/core/ClickableBaseElementView";

import {
  isTurnoutElement,
  type LayoutView,
} from "../../models/editor/core/LayoutView";

import {
  ButtonScriptElementView,
} from "../../models/editor/elements/ButtonScriptElementView";

import {
  ExtendedRouteButtonElementView,
} from "../../models/editor/elements/ExtendedRouteButtonElementView";

import {
  RouteButtonElementView,
} from "../../models/editor/elements/RouteButtonElementView";

import {
  TrackLevelCrossingElementView,
} from "../../models/editor/elements/TrackLevelCrossingElementView";

import {
  TrackSensorElementView,
} from "../../models/editor/elements/TrackSensorElementView";

import {
  runClientScript,
} from "../../services/clientScriptRunner";

import {
  wsApi,
} from "../../services/wsApi";

import {
  executeExtendedRouteButton,
  executeRouteButton,
  type RouteBusySetter,
} from "./trackCanvasRouteActions";

export type TrackCanvasClickableActionContext = {
  layout: LayoutView;
  t: TFunction;
  commandCenterLocked: boolean;
  setBusy?: RouteBusySetter | undefined;
};

function getPhysicalValueForLogicalBarrierState(
  crossing: TrackLevelCrossingElementView,
  logicalClosed: boolean
): boolean {
  return logicalClosed
    ? crossing.basicAccessoryClosedValue
    : !crossing.basicAccessoryClosedValue;
}

function executeLevelCrossingToggle(
  crossing: TrackLevelCrossingElementView
): void {
  if (crossing.basicAccessoryAddress <= 0) {
    return;
  }

  const nextClosed =
    !crossing.barrierClosed;

  wsApi.setBasicAccessory(
    crossing.basicAccessoryAddress,
    getPhysicalValueForLogicalBarrierState(
      crossing,
      nextClosed
    )
  );
}

function executeSensorToggle(
  sensor: TrackSensorElementView
): void {
  if (sensor.address <= 0) {
    return;
  }

  wsApi.setSensor(
    sensor.address,
    !sensor.on
  );
}

async function executeScriptButton(
  element: ButtonScriptElementView,
  commandCenterLocked: boolean
): Promise<void> {
  if (commandCenterLocked) {
    showNotification({
      color: "orange",
      title: "Command center is locked",
      message:
        "Unlock the command center before running a Script Button.",
    });
    return;
  }

  if (!element.script.trim()) {
    showNotification({
      color: "yellow",
      title: "Empty Script Button",
      message:
        element.name ||
        `Script Button #${element.id}`,
    });
    return;
  }

  try {
    await runClientScript(
      element.script,
      {
        id: element.id,
        name: element.name,
        type: element.type,
      }
    );
  } catch (error) {
    showNotification({
      color: "red",
      title:
        "Script Button failed",
      message:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
}

export function handleTrackCanvasClickableDown(
  hitElement: BaseElementView | null,
  event: MouseEvent | PointerEvent,
  context: TrackCanvasClickableActionContext
): boolean {
  if (!hitElement) {
    return false;
  }

  if (
    hitElement instanceof
    ButtonScriptElementView
  ) {
    void executeScriptButton(
      hitElement,
      context.commandCenterLocked
    );

    return true;
  }

  if (hitElement instanceof TrackSensorElementView) {
    executeSensorToggle(hitElement);
    return true;
  }

  if (hitElement instanceof TrackLevelCrossingElementView) {
    executeLevelCrossingToggle(hitElement);
    return true;
  }

  if (
    !(hitElement instanceof ClickableBaseElementView) &&
    !isTurnoutElement(hitElement)
  ) {
    return false;
  }

  if (hitElement instanceof RouteButtonElementView) {
    void executeRouteButton(
      hitElement,
      context.layout,
      {
        t: context.t,
        commandCenterLocked: context.commandCenterLocked,
        setBusy: context.setBusy,
      }
    );

    return true;
  }

  if (hitElement instanceof ExtendedRouteButtonElementView) {
    void executeExtendedRouteButton(
      hitElement,
      {
        t: context.t,
        commandCenterLocked: context.commandCenterLocked,
        setBusy: context.setBusy,
      }
    );

    return true;
  }

  hitElement.mouseDown(event as any);
  return true;
}

export function handleTrackCanvasClickableUp(
  hitElement: BaseElementView | null,
  event: MouseEvent | PointerEvent
): boolean {
  if (!hitElement) {
    return false;
  }

  if (
    hitElement instanceof ButtonScriptElementView ||
    hitElement instanceof TrackSensorElementView ||
    hitElement instanceof TrackLevelCrossingElementView
  ) {
    return true;
  }

  if (
    !(hitElement instanceof ClickableBaseElementView) &&
    !isTurnoutElement(hitElement)
  ) {
    return false;
  }

  hitElement.mouseUp(event as any);
  return true;
}
