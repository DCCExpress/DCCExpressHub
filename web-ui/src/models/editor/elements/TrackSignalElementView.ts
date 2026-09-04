import {
  beginElementDraw,
  degreesToRadians,
  drawElementBounds,
  drawElementIconPath,
  drawElementMarked,
  drawElementNeighbors,
  drawElementOccupied,
  drawElementSelection,
  endElementDraw,
  getBaseEditableProperties,
  getBaseHelp,
  getCenterX,
  getCenterY,
  getGridSizeX,
  getGridSizeY,
  getHeight,
  getPosBottom,
  getPosLeft,
  getPosRight,
  getPosTop,
  getPositionX,
  getPositionY,
  getWidth,
  noopFromJSON,
  noopMouseHandler,
} from "../core/view/support/BaseElementViewSupport";

import {
  drawTrackSectionInfo,
  getTrackStateColor,
  getTrackTravelDirectionArrow,
} from "../core/view/support/TrackElementViewSupport";

import {
  TrackSignalElement as CommonTrackSignalElement,
  SignalStates,
} from "@domain/layout/elements/TrackSignalElement";

import {
  ELEMENT_TYPES,
} from "@domain/layout/elementTypes";

import {
  drawTextWithRoundedBackground,
} from "../../../graphics";

import {
  generateId,
} from "../../../helpers";

import {
  wsApi,
} from "../../../services/wsApi";

import type {
  SignalOutputState,
} from "@/domain/layout/signalOutput";

import {
  cloneSignalOutputConfiguration,
} from "@/domain/layout/signalOutput";

import type {
  DrawOptions,
  ITrackSignalElement,
} from "../types/EditorTypes";

import type {
  IEditableProperty,
} from "./PropertyDescriptor";

export { SignalStates };

export class TrackSignalElementView
  extends CommonTrackSignalElement
  implements ITrackSignalElement {

  get stateColor(): string {
    return getTrackStateColor(this);
  }

  drawSectionInfo(
    ctx: CanvasRenderingContext2D,
    options?: DrawOptions
  ): void {
    drawTrackSectionInfo(this, ctx, options);
  }

  getTravelDirectionArrow(): string {
    return getTrackTravelDirectionArrow(this);
  }

  selected = false;
  marked = false;
  enabled = true;
  alpha = 0.5;
  debug = false;

  get GridSizeX(): number {
    return getGridSizeX();
  }

  get GridSizeY(): number {
    return getGridSizeY();
  }

  get PositionX(): number {
    return getPositionX(this);
  }

  get PositionY(): number {
    return getPositionY(this);
  }

  get posLeft(): number {
    return getPosLeft(this);
  }

  get posRight(): number {
    return getPosRight(this);
  }

  get posTop(): number {
    return getPosTop(this);
  }

  get posBottom(): number {
    return getPosBottom(this);
  }

  get centerX(): number {
    return getCenterX(this);
  }

  get centerY(): number {
    return getCenterY(this);
  }

  get width(): number {
    return getWidth(this);
  }

  get height(): number {
    return getHeight(this);
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

  type:
    typeof ELEMENT_TYPES.TRACK_SIGNAL2 =
      ELEMENT_TYPES.TRACK_SIGNAL2;

  constructor(x: number, y: number) {
    super(x, y);
  }

  beginDraw(
    ctx: CanvasRenderingContext2D,
    options?: DrawOptions
  ): void {
    beginElementDraw(this, ctx, options);
  }

  endDraw(ctx: CanvasRenderingContext2D): void {
    endElementDraw(this, ctx);
  }

  drawIconPath(
    ctx: CanvasRenderingContext2D,
    path: string,
    x: number,
    y: number,
    size: number,
    color = "black",
    strokeWidth = 2
  ): void {
    drawElementIconPath(
      ctx,
      path,
      x,
      y,
      size,
      color,
      strokeWidth
    );
  }

  drawMarked(ctx: CanvasRenderingContext2D): void {
    drawElementMarked(this, ctx);
  }

  drawOccupied(ctx: CanvasRenderingContext2D): void {
    drawElementOccupied(this, ctx);
  }

  drawSelection(ctx: CanvasRenderingContext2D): void {
    drawElementSelection(this, ctx);
  }

  drawEnabled(_ctx: CanvasRenderingContext2D): void {
    return;
  }

  mouseUp(ev: MouseEvent): void {
    noopMouseHandler(ev);
  }

  fromJSON(data: ITrackSignalElement): void {
    noopFromJSON(data);
  }

  degreesToRadians(degrees: number): number {
    return degreesToRadians(degrees);
  }

  drawBounds(ctx: CanvasRenderingContext2D): void {
    drawElementBounds(this, ctx);
  }

  drawNeighbors(ctx: CanvasRenderingContext2D): void {
    drawElementNeighbors(this, ctx);
  }

  getHelp(): string {
    return getBaseHelp();
  }

  get canRotate(): boolean {
    return true;
  }

  get hasProperties(): boolean {
    return true;
  }

  mouseDown(_event: MouseEvent): void {
    if (this.stateCount <= 0) {
      return;
    }

    const nextIndex =
      (this.currentStateIndex + 1) % this.stateCount;

    const state = this.signalOutput.states[nextIndex];

    if (state) {
      this.sendState(state);
    }
  }

  sendState(state: SignalOutputState): void {
    if (this.signalOutput.protocol === "dccext") {
      wsApi.setSignalAspect(
        this.signalOutput.address,
        state.aspect
      );

      this.setCurrentStateById(state.id);
      return;
    }

    state.dccOutputs
      .slice(0, this.signalOutput.outputCount)
      .forEach((direction, index) => {
        wsApi.setBasicAccessory(
          this.signalOutput.address + index,
          direction === "G"
        );
      });

    this.setCurrentStateById(state.id);
  }

  private sendNamedState(label: string): void {
    const state = this.signalOutput.states.find(
      item =>
        item.label.trim().toLowerCase() ===
        label.toLowerCase()
    );

    if (state) {
      this.sendState(state);
    }
  }

  sendGreen(): void {
    this.sendNamedState("Green");
  }

  sendRed(): void {
    this.sendNamedState("Red");
  }

  sendYellow(): void {
    this.sendNamedState("Yellow");
  }

  sendWhite(): void {
    this.sendNamedState("White");
  }

  sendRedIfNotRed(): void {
    if (!this.isRed) {
      this.sendRed();
    }
  }

  sendGreenIfNotGreen(): void {
    if (!this.isGreen) {
      this.sendGreen();
    }
  }

  sendYellowIfNotYellow(): void {
    if (!this.isYellow) {
      this.sendYellow();
    }
  }

  sendWhiteIfNotWhite(): void {
    if (!this.isWhite) {
      this.sendWhite();
    }
  }

  private drawCircle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    color: string
  ): void {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "black";
    ctx.stroke();
  }

  draw(
    ctx: CanvasRenderingContext2D,
    options?: DrawOptions
  ): void {
    this.drawSignal(ctx);

    if (options?.showSignalAddress) {
      drawTextWithRoundedBackground(
        ctx,
        this.posLeft,
        this.posBottom - 10,
        "#" + this.signalOutput.address.toString()
      );
    }

    this.beginDraw(ctx);
    this.endDraw(ctx);
    this.drawSelection(ctx);
  }

  /**
   * Preserves the current Lite signal graphics:
   * - black rounded signal head
   * - white inner outline
   * - horizontal support/stem
   * - right-side post
   *
   * Only lamp count and lamp colors are now driven by signalOutput.
   */
  drawSignal(ctx: CanvasRenderingContext2D): void {
    this.beginDraw(ctx);

    ctx.translate(this.centerX, this.centerY);
    ctx.rotate(this.rotation * Math.PI / 180);
    ctx.translate(-this.centerX, -this.centerY);

    let x = this.posLeft + 6;
    const y = this.centerY - 12;
    const radius = this.width / 13;
    const diameter = 2 * radius;
    const height = diameter + 4;

    const configuredLampCount =
      Math.max(1, this.signalOutput.lampCount);

    const lampCount =
      this.signalOutput.displayAsSingleLamp
        ? 1
        : configuredLampCount;

    const frameLampCount =
      lampCount < 2
        ? 2
        : lampCount;

    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "black";
    ctx.fillStyle = "black";
    ctx.roundRect(
      x - 4,
      y - radius - 2,
      frameLampCount * diameter + 5,
      2 * radius + 4,
      height
    );
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "white";
    ctx.fillStyle = "black";
    ctx.roundRect(
      x - 3,
      y - radius - 1,
      frameLampCount * diameter + 3,
      2 * radius + 2,
      height
    );

    ctx.fillRect(
      x,
      y - radius / 2,
      this.width - 10,
      radius
    );

    ctx.fillRect(
      this.posRight - 4,
      y - radius / 2 - 3,
      2,
      radius + 6
    );

    ctx.fill();
    ctx.stroke();

    x += lampCount === 1 ? 3 : 1;

    const state = this.currentState;

    if (lampCount === 1) {
      const activeLamp =
        state?.lamps.find(lamp => lamp.active);

      this.drawCircle(
        ctx,
        x,
        y,
        radius,
        activeLamp?.color ?? "gray"
      );
    } else {
      for (
        let index = 0;
        index < configuredLampCount;
        index++
      ) {
        const lamp = state?.lamps[index];

        this.drawCircle(
          ctx,
          x + index * diameter,
          y,
          radius,
          this.lightsAll
            ? (lamp?.color ?? "gray")
            : lamp?.active
              ? (lamp.color ?? "gray")
              : "gray"
        );
      }
    }

    this.endDraw(ctx);
  }

  drawAddress(_ctx: CanvasRenderingContext2D): void {
    // Compatibility placeholder.
  }

  toJSON(): ITrackSignalElement {
    return {
      ...super.toJSON(),
    } as ITrackSignalElement;
  }

  static fromJSON(
    data: ITrackSignalElement
  ): TrackSignalElementView {
    const common =
      CommonTrackSignalElement.fromJSON(data);

    const element =
      new TrackSignalElementView(data.x, data.y);

    element.id = common.id;
    element.name = common.name;
    element.layerName = common.layerName;
    element.rotation = common.rotation;
    element.rotationStep = common.rotationStep;
    element.bg = common.bg;
    element.fg = common.fg;
    element.length = common.length;
    element.address = common.address;
    element.signalOutput =
      cloneSignalOutputConfiguration(
        common.signalOutput
      );
    element.currentStateIndex =
      common.currentStateIndex;

    return element;
  }

  clone(): TrackSignalElementView {
    const copy =
      TrackSignalElementView.fromJSON(this.toJSON());

    copy.id = generateId();
    copy.selected = this.selected;

    return copy;
  }

  getEditableProperties(): IEditableProperty[] {
    return [
      ...getBaseEditableProperties(),
      {
        label: "Signal",
        key: "signalOutput",
        type: "signal2",
        readonly: true,
      },
    ];
  }
}
