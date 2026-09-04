import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import type { LayoutElementId } from "@domain/layout/layoutDto";
import { INVALID_LAYOUT_ELEMENT_ID } from "@domain/layout/layoutDto";
import { ClickableBaseElementView } from "../core/ClickableBaseElementView";
import {
  DrawOptions,
  IExtendedRouteButtonElement,
} from "../types/EditorTypes";
import { IEditableProperty } from "./PropertyDescriptor";

export class ExtendedRouteButtonElementView
  extends ClickableBaseElementView
  implements IExtendedRouteButtonElement {
  override type: typeof ELEMENT_TYPES.BUTTON_ROUTE_EXTENDED = ELEMENT_TYPES.BUTTON_ROUTE_EXTENDED;

  label: string = "AUTO ROUTE";
  fromBlockId: LayoutElementId = INVALID_LAYOUT_ELEMENT_ID;
  toBlockId: LayoutElementId = INVALID_LAYOUT_ELEMENT_ID;
  fromSection: string = "";
  toSection: string = "";
  active: boolean = false;

  constructor(x: number, y: number) {
    super(x, y);
    this.type = ELEMENT_TYPES.BUTTON_ROUTE_EXTENDED;
    this.layerName = "buildings";
    this.w = 1;
    this.h = 1;
    this.rotationStep = 0;
  }

  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;
    this.beginDraw(ctx, options);

    const x = this.posLeft + 2;
    const y = this.posTop + 2;
    const w = this.width - 4;
    const h = this.height - 4;
    const bg = this.active ? "#2f9e44" : "#343a40";
    const border = this.active ? "#69db7c" : "#74c0fc";
    const routeColor = this.active ? "#d3f9d8" : "#e7f5ff";
    const nodeColor = this.active ? "#b2f2bb" : "#94d82d";
    const centerY = this.centerY - 3;
    const leftNodeX = this.centerX - 9;
    const rightNodeX = this.centerX + 9;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = border;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(leftNodeX + 5, centerY);
    ctx.lineTo(rightNodeX - 5, centerY);
    ctx.strokeStyle = routeColor;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.stroke();

    for (const nodeX of [leftNodeX, rightNodeX]) {
      ctx.beginPath();
      ctx.arc(nodeX, centerY, 5, 0, Math.PI * 2);
      ctx.fillStyle = nodeColor;
      ctx.fill();
      ctx.strokeStyle = "#1a1b1e";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 8px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(this.label.trim().length > 0 ? this.label : "AUTO", this.centerX, this.centerY + 10);
    ctx.restore();

    this.endDraw(ctx);
    super.drawSelection(ctx);
  }

  override mouseDown(_ev: MouseEvent): void {}

  override toJSON(): IExtendedRouteButtonElement {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.BUTTON_ROUTE_EXTENDED,
      label: this.label,
      fromBlockId: this.fromBlockId,
      toBlockId: this.toBlockId,
    };
  }

  static fromJSON(data: IExtendedRouteButtonElement): ExtendedRouteButtonElementView {
    const e = new ExtendedRouteButtonElementView(data.x, data.y);
    e.id = data.id;
    e.name = data.name;
    e.rotation = data.rotation;
    e.bg = data.bg;
    e.fg = data.fg;
    e.label = data.label ?? "AUTO ROUTE";
    e.fromBlockId = data.fromBlockId ?? INVALID_LAYOUT_ELEMENT_ID;
    e.toBlockId = data.toBlockId ?? INVALID_LAYOUT_ELEMENT_ID;
    e.fromSection = (data as any).fromSection ?? "";
    e.toSection = (data as any).toSection ?? "";
    return e;
  }

  override clone(): ExtendedRouteButtonElementView {
    const copy = new ExtendedRouteButtonElementView(this.x, this.y);
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.selected = this.selected;
    copy.label = this.label;
    copy.fromBlockId = this.fromBlockId;
    copy.toBlockId = this.toBlockId;
    copy.fromSection = this.fromSection;
    copy.toSection = this.toSection;
    return copy;
  }

  override getEditableProperties(): IEditableProperty[] {
    return [
      ...super.getEditableProperties(),
      { label: "Label", key: "label", type: "string", readonly: false },
      { label: "From block", key: "fromBlockId", type: "routeBlockSelect", readonly: false },
      { label: "To block", key: "toBlockId", type: "routeBlockSelect", readonly: false },
    ];
  }

  override getHelp(): string {
    return `
      <h3 style="margin-top:0;">Extended route button</h3>
      <p>This button represents an automatically calculated route between two railway blocks.</p>
      <p>Block references use stable numeric layout IDs.</p>
    `;
  }
}
