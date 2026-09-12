import {
  TrackStates,
  type TrackElement as CommonTrackElement,
} from "@domain/layout/model/TrackElement";
import {
  drawTextWithRoundedBackground,
} from "../../../../../graphics";
import type {
  DrawOptions,
} from "../../../types/EditorTypes";
import type {
  BaseElementViewSupportTarget,
} from "./BaseElementViewSupport";
import {
  wsClient,
} from "@/services/wsClient";

export const TrackColors = {
  free: "#e6e6e6",
  selected: "yellow",
  route: "yellow",
  occupied: "red",
  routeOccupied: "#ff3333",
  busy: "orange",
  transit: "#fd2020",
};

export type TrackElementViewSupportTarget =
  CommonTrackElement &
  BaseElementViewSupportTarget;

// Central occupancy cache fed by the existing Hub sensorChanged /
// sensorSnapshot WebSocket protocol.
//
// Every normal track element already has an occupancy `address` property.
// Keeping the cache here means all track shapes -- including turnouts -- use
// the same S88 occupancy state and color priority.
const occupancyByAddress =
  new Map<number, boolean>();

function normalizeOccupancyAddress(value: unknown): number {
  const address = Math.trunc(Number(value ?? 0));
  return Number.isInteger(address) && address > 0 ? address : 0;
}

wsClient.on(
  "sensorChanged",
  data => {
    const address = normalizeOccupancyAddress(data.address);

    if (address > 0) {
      occupancyByAddress.set(
        address,
        Boolean(data.on)
      );
    }
  }
);

wsClient.on(
  "sensorSnapshot",
  data => {
    for (
      const [
        baseAddress,
        activeBits,
        knownBits,
      ] of data.groups
    ) {
      for (
        let offset = 0;
        offset < 16;
        ++offset
      ) {
        const bit =
          1 << offset;

        if (
          (knownBits & bit) ===
          0
        ) {
          continue;
        }

        occupancyByAddress.set(
          baseAddress +
            offset,
          (activeBits & bit) !==
            0
        );
      }
    }
  }
);

export function isTrackOccupied(
  element: TrackElementViewSupportTarget
): boolean {
  const occupancyAddress =
    normalizeOccupancyAddress(
      element.address
    );

  const sensorOccupied =
    occupancyAddress > 0 &&
    occupancyByAddress.get(
      occupancyAddress
    ) === true;

  return (
    sensorOccupied ||
    element.occupied === true ||
    element.state ===
      TrackStates.occupied
  );
}

export function getTrackStateColor(
  element: TrackElementViewSupportTarget
): string {
  const occupied =
    isTrackOccupied(element);

  /**
   * Visual priority:
   *
   * route + occupied -> orange-red
   * occupied         -> red
   * transit          -> transit red
   * busy/reserved    -> orange
   * route            -> yellow
   * selected         -> yellow
   * free             -> light gray
   *
   * All normal track elements and turnouts call this same function.
   */
  if (
    occupied &&
    element.isRoute
  ) {
    return TrackColors.routeOccupied;
  }

  if (occupied) {
    return TrackColors.occupied;
  }

  if (element.isTransit) {
    return TrackColors.transit;
  }

  if (element.isBusy) {
    return TrackColors.busy;
  }

  if (element.isRoute) {
    return TrackColors.route;
  }

  if (
    element.state ===
    TrackStates.selected
  ) {
    return TrackColors.selected;
  }

  return TrackColors.free;
}

export function drawTrackSectionInfo(
  element: TrackElementViewSupportTarget,
  ctx: CanvasRenderingContext2D,
  options?: DrawOptions
): void {
  if (
    !options?.showSection ||
    element.section <= 0
  ) {
    return;
  }

  ctx.save();

  drawTextWithRoundedBackground(
    ctx,
    element.centerX,
    element.centerY + 12,
    "S" +
      element.section.toString(),
    "white",
    "black"
  );

  drawTextWithRoundedBackground(
    ctx,
    element.centerX,
    element.centerY,
    getTrackTravelDirectionArrow(
      element
    ),
    "white",
    "black",
    2,
    2
  );

  ctx.restore();
}

export function getTrackTravelDirectionArrow(
  element: TrackElementViewSupportTarget
): string {
  if (
    element.travelDirection ===
    "unknown"
  ) {
    return "?";
  }

  const target =
    element.travelDirection ===
    "forward"
      ? element.getNextItemXy()
      : element.getPrevItemXy();

  const dx =
    target.x -
    element.pos.x;

  const dy =
    target.y -
    element.pos.y;

  if (dx > 0 && dy === 0) return "→";
  if (dx > 0 && dy > 0) return "↘";
  if (dx === 0 && dy > 0) return "↓";
  if (dx < 0 && dy > 0) return "↙";
  if (dx < 0 && dy === 0) return "←";
  if (dx < 0 && dy < 0) return "↖";
  if (dx === 0 && dy < 0) return "↑";
  if (dx > 0 && dy < 0) return "↗";

  return "?";
}
