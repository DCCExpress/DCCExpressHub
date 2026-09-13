import type { RotationStepDto } from "@domain/layout/layoutDto";
import { TrackElement } from "../core/TrackElement";
import type { DrawOptions } from "../types/EditorTypes";

/** Shared motor feedback and draw lifecycle for double and three-way turnouts. */
export abstract class TrackMultiMotorTurnoutElement extends TrackElement {
  override rotationStep: RotationStepDto = 45;
  turnout1Address = 0;
  turnout2Address = 0;
  turnout1ClosedValue = true;
  turnout2ClosedValue = true;
  turnout1Closed = false;
  turnout2Closed = false;
  turnoutLocked: string | CanvasGradient | CanvasPattern = "red";
  turnoutUnLocked: string | CanvasGradient | CanvasPattern = "white";

  protected abstract drawTrack(ctx: CanvasRenderingContext2D): void;
  protected abstract drawAddressLabels(ctx: CanvasRenderingContext2D): void;

  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;
    this.beginDraw(ctx, options);
    this.drawTrack(ctx);
    this.endDraw(ctx);

    this.beginDraw(ctx);
    if (options?.showTurnoutAddress) this.drawAddressLabels(ctx);
    this.drawSectionInfo(ctx, options);
    this.endDraw(ctx);
    this.drawSelection(ctx);
  }
}
