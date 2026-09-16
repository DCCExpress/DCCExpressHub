import i18next from "i18next";
import type { TrackElementDto } from "../../../domain/layout/layoutDto";
import { drawTextWithRoundedBackground } from "../../../graphics";
import { wsClient } from "../../../services/wsClient";
import type { IEditableProperty } from "../elements/PropertyDescriptor";
import type { DrawOptions } from "../types/EditorTypes";
import { BaseElement } from "./BaseElement";

export enum TrackStates {
  free,
  selected,
  occupied,
}

export type TravelDirection = "unknown" | "forward" | "reverse";

export const TrackColors = {
  free: "#e6e6e6",
  selected: "yellow",
  route: "yellow",
  occupied: "red",
  routeOccupied: "#ff3333",
  busy: "orange",
  transit: "#fd2020",
};

// Central occupancy cache fed by the existing Hub sensorChanged /
// sensorSnapshot WebSocket protocol.
//
// Every normal track element already has an occupancy `address` property.
// Keeping the cache here means all track shapes -- including turnouts -- use
// the same S88 occupancy state and color priority.
const occupancyByAddress = new Map<number, boolean>();

function normalizeOccupancyAddress(value: unknown): number {
  const address = Math.trunc(Number(value ?? 0));
  return Number.isInteger(address) && address > 0 ? address : 0;
}

wsClient.on("sensorChanged", (data) => {
  const address = normalizeOccupancyAddress(data.address);

  if (address > 0) {
    occupancyByAddress.set(address, Boolean(data.on));
  }
});

wsClient.on("sensorSnapshot", (data) => {
  for (const [baseAddress, activeBits, knownBits] of data.groups) {
    for (let offset = 0; offset < 16; ++offset) {
      const bit = 1 << offset;

      if ((knownBits & bit) === 0) {
        continue;
      }

      occupancyByAddress.set(baseAddress + offset, (activeBits & bit) !== 0);
    }
  }
});
export abstract class TrackElement extends BaseElement {
  address: number = 0;

  length: number = 200;

  state: TrackStates = TrackStates.free;

  section: number = 0;

  isRoute: boolean = false;

  /** Runtime indices of the traversed connection pairs (crossing lines). */
  routeConnectionIndices: number[] = [];

  travelDirection: TravelDirection = "unknown";

  isBusy: boolean = false;

  /**
   * Csak runtime kliensoldali overlay:
   * true, ha egy aktív train task szerint
   * a mozdony éppen ezen a sín-szakaszon halad.
   */
  isTransit: boolean = false;

  override toJSON(): TrackElementDto {
    return {
      ...super.toJSON(),
      address: this.address,
      length: this.length,
    };
  }
  isTrackOccupied(): boolean {
    const occupancyAddress = normalizeOccupancyAddress(this.address);

    const sensorOccupied =
      occupancyAddress > 0 && occupancyByAddress.get(occupancyAddress) === true;

    return sensorOccupied || this.occupied === true || this.state === TrackStates.occupied;
  }
  getStateColor(isRoute = this.isRoute): string {
    const occupied = this.isTrackOccupied();

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
    if (occupied && isRoute) {
      return TrackColors.routeOccupied;
    }

    if (occupied) {
      return TrackColors.occupied;
    }

    if (this.isTransit) {
      return TrackColors.transit;
    }

    if (this.isBusy) {
      return TrackColors.busy;
    }

    if (isRoute) {
      return TrackColors.route;
    }

    if (this.state === TrackStates.selected) {
      return TrackColors.selected;
    }

    return TrackColors.free;
  }
  get stateColor(): string {
    return this.getStateColor();
  }
  drawSectionInfo(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!options?.showSection || this.section <= 0) {
      return;
    }

    ctx.save();

    drawTextWithRoundedBackground(
      ctx,
      this.centerX,
      this.centerY + 12,
      "S" + this.section.toString(),
      "white",
      "black",
    );

    drawTextWithRoundedBackground(
      ctx,
      this.centerX,
      this.centerY,
      this.getTravelDirectionArrow(),
      "white",
      "black",
      2,
      2,
    );

    ctx.restore();
  }
  getTravelDirectionArrow(): string {
    if (this.travelDirection === "unknown") {
      return "?";
    }

    const target = this.travelDirection === "forward" ? this.getNextItemXy() : this.getPrevItemXy();

    const dx = target.x - this.pos.x;

    const dy = target.y - this.pos.y;

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

  protected get hasOccupancySensorProperty(): boolean {
    return true;
  }

  override getEditableProperties(): IEditableProperty[] {
    const properties = super.getEditableProperties();
    if (!this.hasOccupancySensorProperty) return properties;
    return [
      ...properties,
      {
        label: i18next.t("ui.occupancySensorAddress"),
        key: "address",
        type: "number",
        readonly: false,
        min: 0,
      },
    ];
  }

  get TrackWidth7(): number {
    return 7;
  }

  get TrackWidth3(): number {
    return 3;
  }

  get TrackPrimaryColor(): string {
    return "black";
  }
}
