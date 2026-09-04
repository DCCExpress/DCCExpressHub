import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import type {
  LayoutElementId,
  RouteTurnoutItemDto,
} from "@domain/layout/layoutDto";
import { drawPolarLine, getPolarXy } from "../../../graphics";
import { ClickableBaseElementView } from "../core/ClickableBaseElementView";
import { DrawOptions, IRouteButtonElement } from "../types/EditorTypes";
import { IEditableProperty } from "./PropertyDescriptor";

export type RouteTurnoutItem = RouteTurnoutItemDto;

export class RouteButtonElementView extends ClickableBaseElementView implements IRouteButtonElement {
  override type: typeof ELEMENT_TYPES.BUTTON_ROUTE = ELEMENT_TYPES.BUTTON_ROUTE;
  label: string = "Route";
  colorOn: string = "lime";
  active: boolean = false;
  routeTurnouts: RouteTurnoutItem[] = [];

  constructor(x: number, y: number) {
    super(x, y);
    this.type = ELEMENT_TYPES.BUTTON_ROUTE;
    this.rotationStep = 45;
    this.layerName = "buildings";
  }

  addOrUpdateTurnout(turnoutId: LayoutElementId, closed: boolean): void {
    const existing = this.routeTurnouts.find(x => x.turnoutId === turnoutId);
    if (existing) {
      existing.closed = closed;
      return;
    }
    this.routeTurnouts.push({ turnoutId, closed });
  }

  removeTurnout(turnoutId: LayoutElementId): void {
    this.routeTurnouts = this.routeTurnouts.filter(x => x.turnoutId !== turnoutId);
  }

  drawArrowsSplit2(ctx: CanvasRenderingContext2D, x: number, y: number, size: number = 24): void {
    ctx.save();
    ctx.translate(x, y);
    const scale = size / 24;
    ctx.scale(scale, scale);
    ctx.strokeStyle = ctx.strokeStyle || "black";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(21, 17);
    ctx.lineTo(15.6, 17);
    ctx.moveTo(15.6, 17);
    ctx.bezierCurveTo(14, 17, 13, 16.5, 12, 15.5);
    ctx.bezierCurveTo(11.5, 15, 11.2, 14.5, 11, 14);
    ctx.moveTo(11, 14);
    ctx.bezierCurveTo(10, 12.5, 9, 12, 7, 12);
    ctx.lineTo(3, 12);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(21, 7);
    ctx.lineTo(15.6, 7);
    ctx.moveTo(15.6, 7);
    ctx.bezierCurveTo(14, 7, 13, 7.5, 12, 8.5);
    ctx.bezierCurveTo(11.5, 9, 11.2, 9.5, 11, 10);
    ctx.moveTo(11, 10);
    ctx.bezierCurveTo(10, 11.5, 9, 12, 7, 12);
    ctx.lineTo(3, 12);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(18, 10);
    ctx.lineTo(21, 7);
    ctx.lineTo(18, 4);
    ctx.moveTo(18, 20);
    ctx.lineTo(21, 17);
    ctx.lineTo(18, 14);
    ctx.stroke();
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;
    this.beginDraw(ctx, options);
    const fg = this.active ? "yellow" : "white";
    const bg = this.active ? "lime" : "#404040";
    const r = Math.min(this.width, this.height) / 2 - 2;
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "black";
    ctx.fillStyle = bg;
    ctx.arc(this.centerX, this.centerY, r - 1, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    drawPolarLine(ctx, this.centerX, this.centerY, r - 6, 225, "white", 5);
    ctx.beginPath();
    ctx.lineWidth = 5;
    ctx.strokeStyle = fg;
    const p1 = getPolarXy(this.centerX, this.centerY, r - 6, 315);
    const p2 = getPolarXy(this.centerX, this.centerY, r - 6, 90);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(this.centerX, this.centerY);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
    this.endDraw(ctx);
    super.drawSelection(ctx);
  }

  override mouseDown(_ev: MouseEvent): void {}

  override toJSON(): IRouteButtonElement {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.BUTTON_ROUTE,
      label: this.label,
      colorOn: this.colorOn,
      routeTurnouts: this.routeTurnouts ?? [],
    };
  }

  static fromJSON(data: IRouteButtonElement): RouteButtonElementView {
    const e = new RouteButtonElementView(data.x, data.y);
    e.id = data.id;
    e.name = data.name;
    e.rotation = data.rotation;
    e.bg = data.bg;
    e.fg = data.fg;
    e.colorOn = data.colorOn;
    e.label = data.label;
    e.routeTurnouts = Array.isArray(data.routeTurnouts)
      ? data.routeTurnouts
          .filter(item => Number.isInteger(item?.turnoutId) && item.turnoutId > 0)
          .map(item => ({ turnoutId: item.turnoutId, closed: Boolean(item.closed) }))
      : [];
    return e;
  }

  override clone(): RouteButtonElementView {
    const copy = new RouteButtonElementView(this.x, this.y);
    // ID intentionally remains 0. Layout.addElement() owns ID allocation.
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.selected = this.selected;
    copy.label = this.label;
    copy.colorOn = this.colorOn;
    copy.routeTurnouts = this.routeTurnouts.map(item => ({ ...item }));
    return copy;
  }

  override getEditableProperties(): IEditableProperty[] {
    return [
      ...super.getEditableProperties(),
      { label: "Turnouts", key: "routeTurnouts", type: "turnoutSelection", readonly: false, validate: () => true },
    ];
  }

  getHelp(): string {
    return `
      <h3 style="margin-top:0;">Route button</h3>
      <p>Sets a predefined list of turnout states.</p>
      <p>Turnout references are stored by stable layout element ID, not by DCC address.</p>
    `;
  }
}
