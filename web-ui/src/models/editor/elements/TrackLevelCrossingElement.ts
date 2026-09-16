import i18next from "i18next";
import { ELEMENT_TYPES } from "../../../domain/layout/elementTypes";
import type { TrackLevelCrossingElementDto } from "../../../domain/layout/layoutDto";
import type {
  SignalOutputConfiguration,
  SignalOutputState,
} from "../../../domain/layout/signalOutput";
import {
  cloneSignalOutputConfiguration,
  newSignalOutputStateId,
} from "../../../domain/layout/signalOutput";
import { drawTextWithRoundedBackground } from "../../../graphics";
import { generateId } from "../../../helpers";
import type {
  DrawOptions,
  ITrackLevelCrossingElement,
  ITrackSignalElement,
} from "../types/EditorTypes";
import type { IEditableProperty } from "./PropertyDescriptor";
import { TrackSignalElement } from "./TrackSignalElement";
import { TrackStraightElement } from "./TrackStraightElement";

function isHorizontalRotation(rotation: number): boolean {
  return rotation === 0 || rotation === 180;
}

function isVerticalRotation(rotation: number): boolean {
  return rotation === 90 || rotation === 270;
}

type LevelCrossingJson = TrackLevelCrossingElementDto & {
  signalOutput?: SignalOutputConfiguration;
  currentStateIndex?: number;
};

function createDefaultLevelCrossingOutput(
  address = 1,
): SignalOutputConfiguration {
  return {
    protocol: "dcc",
    address: Math.max(1, Math.trunc(address)),
    outputCount: 1,
    lampCount: 2,
    displayAsSingleLamp: false,
    states: [
      {
        id: newSignalOutputStateId(),
        label: "Closed",
        aspect: 0,
        lamps: [
          { color: "#fa5252", active: true },
          { color: "#fa5252", active: true },
        ],
        dccOutputs: ["G"],
      },
      {
        id: newSignalOutputStateId(),
        label: "Open",
        aspect: 16,
        lamps: [
          { color: "#ffffff", active: true },
          { color: "#868e96", active: false },
        ],
        dccOutputs: ["R"],
      },
    ],
  };
}

function createLegacyLevelCrossingOutput(
  data: TrackLevelCrossingElementDto,
): SignalOutputConfiguration {
  const address = Math.max(
    1,
    Math.trunc(Number(data.basicAccessoryAddress ?? 1)),
  );

  const closedValue = Boolean(
    data.basicAccessoryClosedValue ?? true,
  );

  return {
    protocol: "dcc",
    address,
    outputCount: 1,
    lampCount: 2,
    displayAsSingleLamp: false,
    states: [
      {
        id: `legacy-level-crossing-${data.id}-closed`,
        label: "Closed",
        aspect: 0,
        lamps: [
          { color: "#fa5252", active: true },
          { color: "#fa5252", active: true },
        ],
        dccOutputs: [closedValue ? "G" : "R"],
      },
      {
        id: `legacy-level-crossing-${data.id}-open`,
        label: "Open",
        aspect: 16,
        lamps: [
          { color: "#ffffff", active: true },
          { color: "#868e96", active: false },
        ],
        dccOutputs: [closedValue ? "R" : "G"],
      },
    ],
  };
}

function isOpenState(state: SignalOutputState | undefined): boolean {
  if (!state) return false;

  const label = state.label.trim().toLowerCase();

  if (
    label.includes("open") ||
    label.includes("green") ||
    label.includes("white") ||
    label.includes("clear") ||
    label.includes("szabad") ||
    label.includes("nyit")
  ) {
    return true;
  }

  if (
    label.includes("closed") ||
    label.includes("close") ||
    label.includes("red") ||
    label.includes("stop") ||
    label.includes("zár") ||
    label.includes("zar")
  ) {
    return false;
  }

  return false;
}

export class TrackLevelCrossingElement extends TrackSignalElement {
  barrierType: TrackLevelCrossingElementDto["barrierType"] = "half";
  lightsEnabled = true;
  blinkingEnabled = true;
  roadColor = "#6c757d";

  /**
   * Legacy compatibility only. New layouts use signalOutput.
   */
  basicAccessoryClosedValue = true;

  constructor(x: number, y: number) {
    super(x, y);

    // TrackSignalElement is intentionally reused as the signal-output/state
    // implementation. Runtime type is changed without widening the base class'
    // literal TS field just to keep the existing signal class untouched.
    (this as unknown as { type: string }).type =
      ELEMENT_TYPES.TRACK_LEVEL_CROSSING;

    this.name = "Level crossing";
    this.layerName = "track";
    this.rotation = 0;
    this.rotationStep = 45;
    this.length = 200;

    // For a level crossing TrackElement.address remains the occupancy sensor
    // address. The signal/accessory output address lives exclusively in
    // signalOutput.address.
    this.address = 0;
    this.signalOutput = createDefaultLevelCrossingOutput(1);
    this.currentStateIndex = 1;
  }

  get basicAccessoryAddress(): number {
    return this.signalOutput.protocol === "dcc"
      ? this.signalOutput.address
      : 0;
  }

  set basicAccessoryAddress(value: number) {
    const address = Math.trunc(Number(value));

    if (!Number.isInteger(address) || address <= 0) {
      return;
    }

    this.signalOutput = {
      ...this.signalOutput,
      protocol: "dcc",
      address,
      outputCount: Math.max(1, this.signalOutput.outputCount),
    };
  }

  get barrierClosed(): boolean {
    return !isOpenState(this.currentState);
  }

  set barrierClosed(closed: boolean) {
    const wantedOpen = !closed;

    const index = this.signalOutput.states.findIndex(
      state => isOpenState(state) === wantedOpen,
    );

    if (index >= 0) {
      this.setCurrentStateIndex(index);
    }
  }

  /**
   * Do everything the signal base class does, except never overwrite the
   * occupancy sensor address stored in TrackElement.address.
   */
  override setSignalOutput(config: SignalOutputConfiguration): void {
    const occupancyAddress = this.address;
    super.setSignalOutput(config);
    this.address = occupancyAddress;
  }

  private drawRoad(ctx: CanvasRenderingContext2D): void {
    const roadWidth = Math.max(16, this.GridSizeX * 0.38);

    ctx.save();
    ctx.translate(this.centerX, this.centerY);

    if (isHorizontalRotation(this.rotation)) {
      ctx.rotate(Math.PI / 2);
    } else if (this.rotation === 45 || this.rotation === 225) {
      ctx.rotate(-Math.PI / 4);
    } else if (this.rotation === 135 || this.rotation === 315) {
      ctx.rotate(Math.PI / 4);
    }

    ctx.fillStyle = this.roadColor;
    ctx.strokeStyle = "#343a40";
    ctx.lineWidth = 1;
    ctx.fillRect(
      -roadWidth / 2,
      -this.height / 2,
      roadWidth,
      this.height,
    );
    ctx.strokeRect(
      -roadWidth / 2,
      -this.height / 2,
      roadWidth,
      this.height,
    );

    ctx.strokeStyle = "#f8f9fa";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, -this.height / 2 + 5);
    ctx.lineTo(0, this.height / 2 - 5);
    ctx.stroke();
    ctx.restore();
  }

  private drawBarrier(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.fillStyle = "#111111";
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 5;
    ctx.strokeStyle = "#f8f9fa";
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(24, 0);
    ctx.stroke();

    ctx.lineWidth = 3;
    ctx.strokeStyle = "#fa5252";
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(4, 0);
    ctx.lineTo(24, 0);
    ctx.stroke();
    ctx.restore();
  }

  private drawLight(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
  ): void {
    if (!this.lightsEnabled) return;

    // Hungarian level-crossing head: red - white - red.
    // Open/clear -> centre white lamp.
    // Closed/stop -> the two outer red lamps.
    const open = isOpenState(this.currentState);
    const housingWidth = 19;
    const housingHeight = 10;
    const lensRadius = 2.7;
    const lensOffset = 5.5;

    ctx.save();

    ctx.fillStyle = "#000000";
    ctx.strokeStyle = "#f8f9fa";
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.roundRect(
      x - housingWidth / 2,
      y - housingHeight / 2,
      housingWidth,
      housingHeight,
      3,
    );
    ctx.fill();
    ctx.stroke();

    const drawLens = (
      lensX: number,
      active: boolean,
      onColor: string,
      offColor: string,
    ) => {
      ctx.fillStyle = active ? onColor : offColor;
      ctx.beginPath();
      ctx.arc(lensX, y, lensRadius, 0, Math.PI * 2);
      ctx.fill();
    };

    // Canvas redraw is driven by LiteLayoutPage while at least one
    // level crossing has blinking enabled. Keep the phase calculation here
    // so every crossing is synchronized and no runtime state is mutated
    // merely for animation.
    const blinkPhase =
      Math.floor(Date.now() / 450) % 2 === 0;

    const leftRedActive =
      !open &&
      (!this.blinkingEnabled || blinkPhase);

    const rightRedActive =
      !open &&
      (!this.blinkingEnabled || !blinkPhase);

    const whiteActive =
      open &&
      (!this.blinkingEnabled || blinkPhase);

    drawLens(
      x - lensOffset,
      leftRedActive,
      "#ff0000",
      "#240000",
    );
    drawLens(
      x,
      whiteActive,
      "#ffffff",
      "#202020",
    );
    drawLens(
      x + lensOffset,
      rightRedActive,
      "#ff0000",
      "#240000",
    );

    ctx.restore();
  }

  private copyTrackRuntimeStateTo(target: TrackStraightElement): void {
    target.state = this.state;
    target.section = this.section;
    target.isRoute = this.isRoute;
    target.isBusy = this.isBusy;
    target.isTransit = this.isTransit;
    target.travelDirection = this.travelDirection;
  }

  private drawCrossingDetails(ctx: CanvasRenderingContext2D): void {
    this.beginDraw(ctx);
    ctx.translate(this.centerX, this.centerY);
    ctx.rotate((this.rotation * Math.PI) / 180);
    ctx.translate(-this.centerX, -this.centerY);

    const closed = this.barrierClosed;

    if (this.barrierType !== "none") {
      const leftAngle = closed ? 0 : -Math.PI / 3;
      const rightAngle = closed ? Math.PI : Math.PI + Math.PI / 3;

      if (isVerticalRotation(this.rotation)) {
        this.drawBarrier(
          ctx,
          this.centerX - 18,
          this.centerY - 18,
          Math.PI / 2 + leftAngle,
        );
        this.drawBarrier(
          ctx,
          this.centerX + 18,
          this.centerY + 18,
          -Math.PI / 2 + rightAngle,
        );
      } else {
        this.drawBarrier(
          ctx,
          this.centerX - 18,
          this.centerY - 18,
          leftAngle,
        );
        this.drawBarrier(
          ctx,
          this.centerX + 18,
          this.centerY + 18,
          rightAngle,
        );
      }

      if (this.barrierType === "full") {
        if (isVerticalRotation(this.rotation)) {
          this.drawBarrier(
            ctx,
            this.centerX + 18,
            this.centerY - 18,
            Math.PI / 2 + leftAngle,
          );
          this.drawBarrier(
            ctx,
            this.centerX - 18,
            this.centerY + 18,
            -Math.PI / 2 + rightAngle,
          );
        } else {
          this.drawBarrier(
            ctx,
            this.centerX - 18,
            this.centerY + 18,
            leftAngle,
          );
          this.drawBarrier(
            ctx,
            this.centerX + 18,
            this.centerY - 18,
            rightAngle,
          );
        }
      }
    }

    this.drawLight(
      ctx,
      this.centerX - 18,
      this.centerY - 18,
    );
    this.drawLight(
      ctx,
      this.centerX + 18,
      this.centerY + 18,
    );

    this.endDraw(ctx);
  }

  override draw(
    ctx: CanvasRenderingContext2D,
    options?: DrawOptions,
  ): void {
    if (!this.visible) return;

    this.beginDraw(ctx, options);

    if (!this.enabled) {
      ctx.globalAlpha = this.alpha;
    }

    this.drawRoad(ctx);

    const straightPreview = new TrackStraightElement(
      this.x,
      this.y,
    );

    straightPreview.id = this.id;
    straightPreview.name = this.name;
    straightPreview.layerName = this.layerName;
    straightPreview.rotation = this.rotation;
    straightPreview.rotationStep = this.rotationStep;
    straightPreview.address = this.address;
    straightPreview.length = this.length;
    straightPreview.bg = this.bg;
    straightPreview.fg = this.fg;
    straightPreview.selected = false;
    straightPreview.enabled = this.enabled;
    straightPreview.marked = this.marked;
    this.copyTrackRuntimeStateTo(straightPreview);
    straightPreview.draw(ctx, options);

    this.drawCrossingDetails(ctx);
    this.drawSectionInfo(ctx, options);

    if (options?.showOccupancySensorAddress && this.address > 0) {
      drawTextWithRoundedBackground(
        ctx,
        this.posLeft,
        this.posBottom - 10,
        `#${this.address}`,
      );
    }

    if (options?.showSignalAddress) {
      drawTextWithRoundedBackground(
        ctx,
        this.posRight,
        this.posBottom - 10,
        `S#${this.signalOutput.address}`,
      );
    }

    this.endDraw(ctx);
    this.drawSelection(ctx);
  }

  static fromLevelCrossingJSON(
    raw: ITrackLevelCrossingElement,
  ): TrackLevelCrossingElement {
    const data = raw as LevelCrossingJson;
    const element = new TrackLevelCrossingElement(
      data.x,
      data.y,
    );

    element.id = data.id;
    element.name = data.name;
    element.layerName = data.layerName;
    element.rotation = data.rotation;
    element.rotationStep = data.rotationStep;
    element.address = data.address ?? 0;
    element.length = data.length;
    element.bg = data.bg;
    element.fg = data.fg;
    element.roadColor = data.roadColor ?? element.roadColor;
    element.barrierType = data.barrierType ?? element.barrierType;
    element.lightsEnabled = data.lightsEnabled ?? true;
    element.blinkingEnabled = data.blinkingEnabled ?? true;
    element.basicAccessoryClosedValue =
      data.basicAccessoryClosedValue ?? true;

    const config = data.signalOutput
      ? cloneSignalOutputConfiguration(data.signalOutput)
      : (
          (data.basicAccessoryAddress ?? 0) > 0
            ? createLegacyLevelCrossingOutput(data)
            : createDefaultLevelCrossingOutput(1)
        );

    element.setSignalOutput(config);

    if (typeof data.currentStateIndex === "number") {
      element.setCurrentStateIndex(data.currentStateIndex);
    } else if (data.barrierClosed !== undefined) {
      element.barrierClosed = Boolean(data.barrierClosed);
    } else {
      element.setCurrentStateIndex(
        Math.min(1, element.signalOutput.states.length - 1),
      );
    }

    return element;
  }

  override toJSON(): ITrackSignalElement {
    const signalJson = super.toJSON();

    return {
      ...signalJson,
      type: ELEMENT_TYPES.TRACK_LEVEL_CROSSING,
      // Restore TrackElement.address as occupancy input; TrackSignalElement's
      // serializer intentionally writes the signal output address here.
      address: this.address,
      length: this.length,
      roadColor: this.roadColor,
      barrierType: this.barrierType,
      lightsEnabled: this.lightsEnabled,
      blinkingEnabled: this.blinkingEnabled,
      signalOutput: cloneSignalOutputConfiguration(this.signalOutput),
      currentStateIndex: this.currentStateIndex,
      // Legacy compatibility fields. They are no longer authoritative.
      basicAccessoryAddress: this.basicAccessoryAddress,
      basicAccessoryClosedValue: this.basicAccessoryClosedValue,
      barrierClosed: this.barrierClosed,
    } as unknown as ITrackSignalElement;
  }

  override clone(): TrackLevelCrossingElement {
    const copy = TrackLevelCrossingElement.fromLevelCrossingJSON(
      this.toJSON() as unknown as ITrackLevelCrossingElement,
    );

    copy.id = generateId();
    copy.selected = this.selected;
    return copy;
  }

  override getEditableProperties(): IEditableProperty[] {
    const inheritedProperties =
      super.getEditableProperties().map((property) =>
        property.type === "signal2"
          ? {
              ...property,
              label: i18next.t("ui.levelCrossing"),
            }
          : property
      );

    return [
      ...inheritedProperties,
      {
        label: i18next.t("ui.roadColor"),
        key: "roadColor",
        type: "colorpicker",
        readonly: false,
        validate: () => true,
      },
      {
        label: i18next.t("ui.barrierType"),
        key: "barrierType",
        type: "select",
        readonly: false,
        validate: () => true,
        options: [
          { value: "none", label: i18next.t("ui.none") },
          { value: "half", label: i18next.t("ui.half") },
          { value: "full", label: i18next.t("ui.full") },
        ],
      },
      {
        label: i18next.t("ui.lightsEnabled"),
        key: "lightsEnabled",
        type: "boolean",
        readonly: false,
        validate: () => true,
      },
      {
        label: i18next.t("ui.blinkingEnabled"),
        key: "blinkingEnabled",
        type: "boolean",
        readonly: false,
        validate: () => true,
      },
    ];
  }

  protected override get hasOccupancySensorProperty(): boolean {
    return true;
  }
}
