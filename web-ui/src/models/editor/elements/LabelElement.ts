import i18next from "i18next";
import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import { drawTextWithRoundedBackground } from "../../../graphics";
import { generateId } from "../../../helpers";
import { BaseElement } from "../core/BaseElement";
import { DrawOptions, ILabelElement } from "../types/EditorTypes";
import { IEditableProperty } from "./PropertyDescriptor";
export class LabelElement extends BaseElement implements ILabelElement {
  override type = ELEMENT_TYPES.LABEL;
  override layerName = "buildings";
  text: string = "Label";
  fontSize: number = 12;
  color: string = "#ffffff";
  alignment: "left" | "center" | "right" = "center";
  offsetY: number = 0;
  offsetX: number = 0;
  constructor(x: number, y: number) {
    super(x, y);
    this.rotationStep = 45;
    //this.trackType = data.trackType;
    //this.length = data.length ?? 80;
  }
  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;
    this.beginDraw(ctx, options);
    if (!this.enabled) {
      ctx.globalAlpha = this.alpha;
    }
    ctx.font = this.fontSize + "px Arial";
    // Offsets are relative to the element's geometric center. The helper
    // centers both the background and the text around this anchor.
    const x = this.centerX + this.offsetX;
    const y = this.centerY + this.offsetY;
    drawTextWithRoundedBackground(ctx, x, y, this.text, this.color, this.bg, 2, 4);
    this.endDraw(ctx);
    super.drawSelection(ctx);
  }
  override toJSON(): ILabelElement {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.LABEL,
      text: this.text,
      fontSize: this.fontSize,
      color: this.color,
      alignment: this.alignment,
      offsetY: this.offsetY,
      offsetX: this.offsetX,
    };
  }
  static fromJSON(data: ILabelElement): LabelElement {
    const e = new LabelElement(data.x, data.y);
    e.id = data.id;
    e.text = data.text;
    e.fontSize = data.fontSize;
    e.color = data.color ?? "#ffffff";
    e.alignment = data.alignment;
    e.offsetY = data.offsetY ?? 0;
    e.offsetX = data.offsetX ?? 0;
    e.rotation = data.rotation;
    e.bg = data.bg;
    e.fg = data.fg;
    return e;
  }
  override clone(): LabelElement {
    const copy = new LabelElement(this.x, this.y);
    copy.id = generateId();
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.selected = this.selected;
    copy.text = this.text;
    copy.fontSize = this.fontSize;
    copy.color = this.color;
    copy.alignment = this.alignment;
    copy.offsetY = this.offsetY;
    copy.offsetX = this.offsetX;
    copy.bg = this.bg;
    copy.fg = this.fg;
    return copy;
  }
  override getEditableProperties(): IEditableProperty[] {
    return [
      // { label: "Név", key: "name", type: "string" },
      // { label: "Forgatás", key: "rotation", type: "number" },
      ...super.getEditableProperties(),
      { label: i18next.t("ui.text"), key: "text", type: "string", readonly: false },
      { label: i18next.t("ui.color"), key: "color", type: "colorpicker", readonly: false },
      { label: i18next.t("ui.background"), key: "bg", type: "colorpicker", readonly: false },
      { label: i18next.t("ui.fontSize"), key: "fontSize", type: "number", readonly: false },
      { label: i18next.t("ui.offsetY"), key: "offsetY", type: "number", readonly: false },
      { label: i18next.t("ui.offsetX"), key: "offsetX", type: "number", readonly: false },
    ];
  }
  override getHelp(): string {
    return `
  `;
  }
}
