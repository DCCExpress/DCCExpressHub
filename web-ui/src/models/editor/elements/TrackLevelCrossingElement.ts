import { ELEMENT_TYPES } from "../../../domain/layout/elementTypes";
import type { TrackLevelCrossingElementDto } from "../../../domain/layout/layoutDto";
import { drawTextWithRoundedBackground } from "../../../graphics";
import { generateId } from "../../../helpers";
import { TrackElement } from "../core/TrackElement";
import type { DrawOptions, ITrackLevelCrossingElement } from "../types/EditorTypes";
import type { IEditableProperty } from "./PropertyDescriptor";
import { TrackStraightElement } from "./TrackStraightElement";
function isHorizontalRotation(rotation: number): boolean {
  return rotation === 0 || rotation === 180;
}
function isVerticalRotation(rotation: number): boolean {
  return rotation === 90 || rotation === 270;
}
export class TrackLevelCrossingElement extends TrackElement {
  basicAccessoryAddress = 0;
  basicAccessoryClosedValue = true;
  barrierType: TrackLevelCrossingElementDto["barrierType"] = "half";
  barrierClosed = false;
  lightsEnabled = true;
  blinkingEnabled = true;
  roadColor = "#6c757d";
  blinkOn = true;
  override type: typeof ELEMENT_TYPES.TRACK_LEVEL_CROSSING = ELEMENT_TYPES.TRACK_LEVEL_CROSSING;
  constructor(x: number, y: number) {
    super(x, y);
    this.type = ELEMENT_TYPES.TRACK_LEVEL_CROSSING;
    this.name = "Level crossing";
    this.rotationStep = 45;
    this.length = 200;
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
    ctx.fillRect(-roadWidth / 2, -this.height / 2, roadWidth, this.height);
    ctx.strokeRect(-roadWidth / 2, -this.height / 2, roadWidth, this.height);
    ctx.strokeStyle = "#f8f9fa";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, -this.height / 2 + 5);
    ctx.lineTo(0, this.height / 2 - 5);
    ctx.stroke();
    ctx.restore();
  }
  private drawBarrier(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
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
  private drawLight(ctx: CanvasRenderingContext2D, x: number, y: number, active: boolean): void {
    if (!this.lightsEnabled) return;
    const shouldBlink = this.blinkingEnabled;
    const lampActive = shouldBlink ? active : true;
    const lightColor = this.barrierClosed
      ? lampActive
        ? "#ff0000"
        : "#120000"
      : lampActive
        ? "#ffffff"
        : "#050505";
    const highlightColor = this.barrierClosed
      ? lampActive
        ? "#ff6b6b"
        : "#050000"
      : lampActive
        ? "#ffffff"
        : "#050505";
    const housingRadius = 7;
    const ringRadius = 5.8;
    const lensRadius = 3;
    ctx.save();
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(x, y, housingRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = "#f8f9fa";
    ctx.stroke();
    ctx.fillStyle = lightColor;
    ctx.beginPath();
    ctx.arc(x - 2.5, y, lensRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = highlightColor;
    ctx.beginPath();
    ctx.arc(x + 2.5, y, lensRadius, 0, Math.PI * 2);
    ctx.fill();
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
        this.drawBarrier(ctx, this.centerX - 18, this.centerY - 18, Math.PI / 2 + leftAngle);
        this.drawBarrier(ctx, this.centerX + 18, this.centerY + 18, -Math.PI / 2 + rightAngle);
      } else {
        this.drawBarrier(ctx, this.centerX - 18, this.centerY - 18, leftAngle);
        this.drawBarrier(ctx, this.centerX + 18, this.centerY + 18, rightAngle);
      }
      if (this.barrierType === "full") {
        if (isVerticalRotation(this.rotation)) {
          this.drawBarrier(ctx, this.centerX + 18, this.centerY - 18, Math.PI / 2 + leftAngle);
          this.drawBarrier(ctx, this.centerX - 18, this.centerY + 18, -Math.PI / 2 + rightAngle);
        } else {
          this.drawBarrier(ctx, this.centerX - 18, this.centerY + 18, leftAngle);
          this.drawBarrier(ctx, this.centerX + 18, this.centerY - 18, rightAngle);
        }
      }
    }
    // this.drawLight(ctx, this.centerX + 18, this.centerY - 18, this.blinkOn);
    // this.drawLight(ctx, this.centerX + 18, this.centerY + 18, !this.blinkOn);
    this.drawLight(ctx, this.centerX - 18, this.centerY - 18, this.blinkOn);
    this.drawLight(ctx, this.centerX + 18, this.centerY + 18, !this.blinkOn);
    this.endDraw(ctx);
  }
  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;
    this.beginDraw(ctx, options);
    if (!this.enabled) {
      ctx.globalAlpha = this.alpha;
    }
    this.drawRoad(ctx);
    const straightPreview = new TrackStraightElement(this.x, this.y);
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
    if (options?.showOccupancySensorAddress) {
      drawTextWithRoundedBackground(
        ctx,
        this.posLeft,
        this.posBottom - 10,
        "#" + this.address.toString(),
      );
    }
    this.endDraw(ctx);
    this.drawSelection(ctx);
  }
  static fromJSON(data: ITrackLevelCrossingElement): TrackLevelCrossingElement {
    const element = new TrackLevelCrossingElement(data.x, data.y);
    element.id = data.id;
    element.name = data.name;
    element.layerName = data.layerName;
    element.rotation = data.rotation;
    element.rotationStep = data.rotationStep;
    element.address = data.address;
    element.length = data.length;
    element.bg = data.bg;
    element.fg = data.fg;
    element.roadColor = data.roadColor;
    element.barrierType = data.barrierType;
    element.lightsEnabled = data.lightsEnabled;
    element.blinkingEnabled = data.blinkingEnabled;
    element.basicAccessoryAddress = data.basicAccessoryAddress;
    element.basicAccessoryClosedValue = data.basicAccessoryClosedValue;
    return element;
  }
  override toJSON(): ITrackLevelCrossingElement {
    return {
      ...super.toJSON(),
      barrierClosed: this.barrierClosed,
      type: ELEMENT_TYPES.TRACK_LEVEL_CROSSING,
      roadColor: this.roadColor,
      barrierType: this.barrierType,
      lightsEnabled: this.lightsEnabled,
      blinkingEnabled: this.blinkingEnabled,
      basicAccessoryAddress: this.basicAccessoryAddress,
      basicAccessoryClosedValue: this.basicAccessoryClosedValue,
    };
  }
  override clone(): TrackLevelCrossingElement {
    const copy = new TrackLevelCrossingElement(this.x, this.y);
    copy.id = generateId();
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.address = this.address;
    copy.length = this.length;
    copy.roadColor = this.roadColor;
    copy.barrierType = this.barrierType;
    copy.lightsEnabled = this.lightsEnabled;
    copy.blinkingEnabled = this.blinkingEnabled;
    copy.basicAccessoryAddress = this.basicAccessoryAddress;
    copy.basicAccessoryClosedValue = this.basicAccessoryClosedValue;
    copy.barrierClosed = this.barrierClosed;
    return copy;
  }
  override getEditableProperties(): IEditableProperty[] {
    return [
      ...super.getEditableProperties(),
      {
        label: "Road color",
        key: "roadColor",
        type: "colorpicker",
        readonly: false,
        validate: () => true,
      },
      {
        label: "Barrier type",
        key: "barrierType",
        type: "select",
        readonly: false,
        validate: () => true,
        options: [
          { value: "none", label: "None" },
          { value: "half", label: "Half" },
          { value: "full", label: "Full" },
        ],
      },
      {
        label: "Lights enabled",
        key: "lightsEnabled",
        type: "boolean",
        readonly: false,
        validate: () => true,
      },
      {
        label: "Blinking enabled",
        key: "blinkingEnabled",
        type: "boolean",
        readonly: false,
        validate: () => true,
      },
      {
        label: "Basic accessory address",
        key: "basicAccessoryAddress",
        type: "number",
        readonly: false,
        validate: () => true,
      },
      {
        label: "Basic accessory closed value",
        key: "basicAccessoryClosedValue",
        type: "boolean",
        readonly: false,
        validate: () => true,
      },
    ];
  }
}
