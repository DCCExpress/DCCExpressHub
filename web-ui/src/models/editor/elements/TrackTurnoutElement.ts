import type {
  TrackTurnoutElementDto,
  TurnoutOutputModeDto,
} from "../../../domain/layout/layoutDto";
import { Point } from "../../../domain/Rect";
import { drawTextWithRoundedBackground } from "../../../graphics";
import { TURNOUT_OUTPUT_MODE_OPTIONS, sendTurnoutOutput } from "../../../services/layoutOutput";
import { TrackElement } from "../core/TrackElement";
import {
  getTurnoutClosedAspect,
  getTurnoutOpenedAspect,
  normalizeTurnoutAspect,
  normalizeTurnoutOutputMode,
} from "../turnout/turnoutAccessoryHelpers";
import type { DrawOptions } from "../types/EditorTypes";
import type { IEditableProperty } from "./PropertyDescriptor";
export abstract class TrackTurnoutElement extends TrackElement {
  outputMode: TurnoutOutputModeDto = "accessory";
  turnoutAddress: number = 0;
  turnoutClosedValue: boolean = false;
  turnoutClosed: boolean = false;
  constructor(x: number, y: number) {
    super(x, y);
    this.rotationStep = 45;
  }
  get isClosed(): boolean {
    return this.turnoutClosed === this.turnoutClosedValue;
  }
  abstract getConnections(): {
    entry: Point;
    straight: Point;
    div: Point;
  };
  turnoutLockedColor: string | CanvasGradient | CanvasPattern = "red";
  turnoutUnLockedColor: string | CanvasGradient | CanvasPattern = "white";
  abstract drawTurnout(ctx: CanvasRenderingContext2D, closed: boolean): void;
  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) {
      return;
    }
    this.beginDraw(ctx, options);
    this.drawTurnout(ctx, this.isClosed);
    this.endDraw(ctx);
    this.beginDraw(ctx, options);
    if (options?.showTurnoutAddress) {
      drawTextWithRoundedBackground(
        ctx,
        this.posLeft,
        this.posBottom - 10,
        "T#" + this.turnoutAddress.toString(),
      );
    }
    if (options?.showOccupancySensorAddress) {
      drawTextWithRoundedBackground(
        ctx,
        this.posLeft,
        this.posBottom + 2,
        "S#" + this.address.toString(),
      );
    }
    this.drawSectionInfo(ctx, options);
    this.endDraw(ctx);
    this.drawSelection(ctx);
  }
  toggle(): void {
    const nextPhysicalValue = !this.turnoutClosed;
    this.turnoutClosed = nextPhysicalValue;
    sendTurnoutOutput(String(this.outputMode), this.turnoutAddress, nextPhysicalValue, {
      closedValue: this.turnoutClosedValue,
      closedAspect: getTurnoutClosedAspect(this),
      openedAspect: getTurnoutOpenedAspect(this),
    });
  }
  override mouseDown(_ev: MouseEvent): void {
    this.toggle();
  }
  override getEditableProperties(): IEditableProperty[] {
    return [
      ...super.getEditableProperties(),
      {
        label: "Output type",
        key: "outputMode",
        type: "select",
        readonly: false,
        options: TURNOUT_OUTPUT_MODE_OPTIONS,
      },
      {
        label: "Accessory address",
        key: "turnoutAddress",
        type: "number",
        readonly: false,
        min: 1,
        max: 2048,
        validate: () => true,
      },
      {
        label: "Turnout positions",
        key: "turnoutClosedValue",
        type: "bittoggle",
        readonly: false,
        validate: () => true,
      },
    ];
  }

  turnoutClosedAspect = 0;
  turnoutOpenedAspect = 1;

  protected readTurnoutConfiguration(data: {
    outputMode?: TurnoutOutputModeDto;
    turnoutClosedAspect?: number;
    turnoutOpenedAspect?: number;
  }): void {
    this.outputMode = normalizeTurnoutOutputMode(data.outputMode);
    this.turnoutClosedAspect = normalizeTurnoutAspect(data.turnoutClosedAspect, 0);
    this.turnoutOpenedAspect = normalizeTurnoutAspect(data.turnoutOpenedAspect, 1);
  }

  override toJSON(): TrackTurnoutElementDto {
    return {
      ...super.toJSON(),
      turnoutAddress: this.turnoutAddress,
      turnoutClosedValue: this.turnoutClosedValue,
      outputMode: normalizeTurnoutOutputMode(this.outputMode),
      turnoutClosedAspect: getTurnoutClosedAspect(this),
      turnoutOpenedAspect: getTurnoutOpenedAspect(this),
    };
  }
}
