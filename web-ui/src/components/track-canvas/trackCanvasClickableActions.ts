import type { TFunction } from "i18next";
import type { BaseElement } from "../../models/editor/core/BaseElement";
import { ClickableBaseElement } from "../../models/editor/core/ClickableBaseElement";
import { isTurnoutElement, type LayoutView } from "../../models/editor/core/LayoutView";
import { ExtendedRouteButtonElement } from "../../models/editor/elements/ExtendedRouteButtonElement";
import { RouteButtonElement } from "../../models/editor/elements/RouteButtonElement";
import { TrackLevelCrossingElement } from "../../models/editor/elements/TrackLevelCrossingElement";
import { TrackSensorElement } from "../../models/editor/elements/TrackSensorElement";
import { TrackTurnoutThreeWayElement } from "../../models/editor/elements/TrackTurnoutThreeWayElement";
import { wsApi } from "../../services/wsApi";
import { executeExtendedRouteButton, executeRouteButton, type RouteBusySetter } from "./trackCanvasRouteActions";

export type TrackCanvasClickableActionContext = {
  layout: LayoutView;
  t: TFunction;
  commandCenterLocked: boolean;
  setBusy?: RouteBusySetter | undefined;
  invalidate?: (() => void) | undefined;
};

function getPhysicalValueForLogicalBarrierState(
  crossing: TrackLevelCrossingElement,
  logicalClosed: boolean
): boolean {
  return logicalClosed
    ? crossing.basicAccessoryClosedValue
    : !crossing.basicAccessoryClosedValue;
}

function executeLevelCrossingToggle(
  crossing: TrackLevelCrossingElement
): void {
  if (crossing.basicAccessoryAddress <= 0) return;
  const nextClosed = !crossing.barrierClosed;
  wsApi.setBasicAccessory(
    crossing.basicAccessoryAddress,
    getPhysicalValueForLogicalBarrierState(crossing, nextClosed)
  );
}

function executeSensorToggle(sensor: TrackSensorElement): void {
  if (sensor.address <= 0) return;
  wsApi.setSensor(sensor.address, !sensor.on);
}

function isDirectTurnout(element: BaseElement): boolean {
  return (
    isTurnoutElement(element) ||
    element instanceof TrackTurnoutThreeWayElement
  );
}

export function handleTrackCanvasClickableDown(
  hitElement: BaseElement | null,
  event: MouseEvent | PointerEvent,
  context: TrackCanvasClickableActionContext
): boolean {
  if (!hitElement) return false;

  if (hitElement instanceof TrackSensorElement) {
    executeSensorToggle(hitElement);
    return true;
  }

  if (hitElement instanceof TrackLevelCrossingElement) {
    executeLevelCrossingToggle(hitElement);
    return true;
  }

  if (
    !(hitElement instanceof ClickableBaseElement) &&
    !isDirectTurnout(hitElement)
  ) {
    return false;
  }

  if (hitElement instanceof RouteButtonElement) {
    void executeRouteButton(
      hitElement,
      context.layout,
      {
        t: context.t,
        commandCenterLocked:
          context.commandCenterLocked,
        setBusy:
          context.setBusy,
        onInvalidate:
          context.invalidate,
      }
    );

    return true;
  }

  if (hitElement instanceof ExtendedRouteButtonElement) {
    void executeExtendedRouteButton(
      hitElement,
      {
        t: context.t,
        commandCenterLocked:
          context.commandCenterLocked,
        setBusy:
          context.setBusy,
      }
    );

    return true;
  }

  hitElement.mouseDown(event as any);
  return true;
}

export function handleTrackCanvasClickableUp(
  hitElement: BaseElement | null,
  event: MouseEvent | PointerEvent
): boolean {
  if (!hitElement) return false;

  if (
    hitElement instanceof TrackSensorElement ||
    hitElement instanceof TrackLevelCrossingElement
  ) {
    return true;
  }

  if (
    !(hitElement instanceof ClickableBaseElement) &&
    !isDirectTurnout(hitElement)
  ) {
    return false;
  }

  hitElement.mouseUp(event as any);
  return true;
}
