import { ELEMENT_TYPES } from "../../../domain/layout/elementTypes";
import { drawTextWithRoundedBackground } from "../../../graphics";
import { generateId } from "../../../helpers";
import { TrackElement } from "../core/TrackElement";
import { DrawOptions, ITrackSensorElement } from "../types/EditorTypes";
import { IEditableProperty } from "./PropertyDescriptor";
export enum SensorTypes {
  circle,
  rect,
}
export class TrackSensorElement extends TrackElement {
  on: boolean = false;
  kind: SensorTypes = SensorTypes.rect;
  colorOn: string = "lime";
  colorOff: string = "green";
  textOn: string = "ON";
  textOff: string = "OFF";
  radius: number = 6;
  override type: typeof ELEMENT_TYPES.TRACK_SENSOR = ELEMENT_TYPES.TRACK_SENSOR;
  constructor(x: number, y: number) {
    super(x, y);
    this.layerName = "sensors";
  }
  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;
    this.beginDraw(ctx, options);
    ctx.fillStyle = this.on ? this.colorOn : "gray";
    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (options?.showSensorAddress) {
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
  override toJSON(): ITrackSensorElement {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.TRACK_SENSOR,
      address: this.address,
      length: this.length,
      kind: this.kind,
      colorOn: this.colorOn,
      colorOff: this.colorOff,
      radius: this.radius,
    };
  }
  static fromJSON(data: ITrackSensorElement): TrackSensorElement {
    const element = new TrackSensorElement(data.x, data.y);
    element.id = data.id;
    element.name = data.name;
    element.layerName = data.layerName;
    element.rotation = data.rotation;
    element.rotationStep = data.rotationStep;
    element.bg = data.bg;
    element.fg = data.fg;
    element.address = data.address;
    element.length = data.length;
    element.kind = data.kind as SensorTypes;
    element.colorOn = data.colorOn;
    element.colorOff = data.colorOff;
    element.radius = data.radius ?? 6;
    return element;
  }
  override clone(): TrackSensorElement {
    const copy = new TrackSensorElement(this.x, this.y);
    copy.id = generateId();
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.selected = this.selected;
    copy.address = this.address;
    copy.length = this.length;
    copy.kind = this.kind;
    copy.colorOn = this.colorOn;
    copy.colorOff = this.colorOff;
    copy.textOn = this.textOn;
    copy.textOff = this.textOff;
    copy.radius = this.radius;
    return copy;
  }
  override getEditableProperties(): IEditableProperty[] {
    return [
      ...super.getEditableProperties(),
      {
        label: "Sensor Address",
        key: "address",
        type: "number",
        readonly: false,
      },
      {
        label: "Color ON",
        key: "colorOn",
        type: "colorpicker",
        readonly: false,
      },
      {
        label: "Radius",
        key: "radius",
        type: "number",
        min: 4,
        max: 12,
        readonly: false,
      },
    ];
  }
  protected override get hasOccupancySensorProperty(): boolean {
    return false;
  }
}
