import i18next from "i18next";
import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import type {
  LampElementDto,
  LampVariantDto,
} from "@domain/layout/layoutDto";
import { BaseElement } from "../core/BaseElement";
import type { DrawOptions } from "../types/EditorTypes";
import type { IEditableProperty } from "./PropertyDescriptor";

const LAMP_VARIANTS: Array<{ value: LampVariantDto; labelKey: string }> = [
  { value: "classic", labelKey: "ui.classic" },
  { value: "modern", labelKey: "ui.modern" },
  { value: "double", labelKey: "ui.double" },
];

export class LampElement extends BaseElement {
  override type: typeof ELEMENT_TYPES.LAMP = ELEMENT_TYPES.LAMP;
  variant: LampVariantDto = "classic";

  constructor(x: number, y: number) {
    super(x, y);
    this.layerName = "buildings";
    this.rotationStep = 45;
    this.name = "Lamp";
  }

  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;

    this.beginDraw(ctx, options);
    ctx.translate(this.centerX, this.centerY);
    ctx.rotate((this.rotation * Math.PI) / 180);

    ctx.fillStyle = "rgba(0,0,0,0.20)";
    ctx.beginPath();
    ctx.ellipse(3, 4, 8, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    const drawHead = (x: number, y: number, radius: number) => {
      ctx.fillStyle = "#2f3235";
      ctx.beginPath();
      ctx.arc(x, y, radius + 2.2, 0, Math.PI * 2);
      ctx.fill();

      const glow = ctx.createRadialGradient(x - 1, y - 1, 0.5, x, y, radius);
      glow.addColorStop(0, "#fff6c8");
      glow.addColorStop(0.45, "#f2d378");
      glow.addColorStop(1, "#9d8240");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    };

    ctx.fillStyle = "#393d40";
    ctx.beginPath();
    ctx.arc(0, 0, this.variant === "modern" ? 4.2 : 5.2, 0, Math.PI * 2);
    ctx.fill();

    if (this.variant === "double") {
      drawHead(-5.5, 0, 3.1);
      drawHead(5.5, 0, 3.1);
    } else if (this.variant === "modern") {
      ctx.fillStyle = "#d9dde0";
      ctx.fillRect(-5, -2.5, 10, 5);
      ctx.fillStyle = "#fff2a8";
      ctx.fillRect(-3.8, -1.4, 7.6, 2.8);
    } else {
      drawHead(0, 0, 3.8);
    }

    this.endDraw(ctx);
    this.drawSelection(ctx);
  }

  override toJSON(): LampElementDto {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.LAMP,
      variant: this.variant,
    };
  }

  static fromJSON(data: LampElementDto): LampElement {
    const element = new LampElement(data.x, data.y);
    element.id = data.id;
    element.name = data.name;
    element.layerName = data.layerName || "buildings";
    element.w = data.w ?? 1;
    element.h = data.h ?? 1;
    element.rotation = data.rotation;
    element.rotationStep = data.rotationStep;
    element.bg = data.bg;
    element.fg = data.fg;
    element.variant = data.variant ?? "classic";
    return element;
  }

  override clone(): LampElement {
    const copy = new LampElement(this.x, this.y);
    copy.name = this.name;
    copy.w = this.w;
    copy.h = this.h;
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.variant = this.variant;
    return copy;
  }

  override getEditableProperties(): IEditableProperty[] {
    return [
      ...super.getEditableProperties(),
      {
        label: i18next.t("ui.variant"),
        key: "variant",
        type: "select",
        options: LAMP_VARIANTS.map(item => ({
          value: item.value,
          label: i18next.t(item.labelKey),
        })),
      },
    ];
  }
}
