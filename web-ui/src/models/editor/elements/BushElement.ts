import i18next from "i18next";
import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import type {
  BushElementDto,
  BushVariantDto,
} from "@domain/layout/layoutDto";
import { BaseElement } from "../core/BaseElement";
import type { DrawOptions } from "../types/EditorTypes";
import type { IEditableProperty } from "./PropertyDescriptor";

const BUSH_VARIANTS: Array<{ value: BushVariantDto; labelKey: string }> = [
  { value: "compact", labelKey: "ui.compact" },
  { value: "wide", labelKey: "ui.wide" },
  { value: "flowering", labelKey: "ui.flowering" },
];

export class BushElement extends BaseElement {
  override type: typeof ELEMENT_TYPES.BUSH = ELEMENT_TYPES.BUSH;
  variant: BushVariantDto = "compact";
  clusterCount = 6;

  constructor(x: number, y: number) {
    super(x, y);
    this.layerName = "buildings";
    this.rotationStep = 45;
    this.name = "Bush";
  }

  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;

    this.beginDraw(ctx, options);
    ctx.translate(this.centerX, this.centerY);
    ctx.rotate((this.rotation * Math.PI) / 180);

    const count = Math.max(3, Math.min(12, Math.round(this.clusterCount)));
    const baseRadius = Math.max(5.5, Math.min(this.width, this.height) * 0.15);
    const spreadX = this.variant === "wide" ? this.width * 0.28 : this.width * 0.2;
    const spreadY = this.height * 0.18;

    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(3, 4, spreadX + baseRadius, spreadY + baseRadius * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();

    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const x = Math.cos(angle) * spreadX * (0.55 + (index % 2) * 0.16);
      const y = Math.sin(angle) * spreadY * (0.62 + (index % 3) * 0.11);
      const radius = baseRadius * (0.82 + (index % 3) * 0.12);

      const gradient = ctx.createRadialGradient(
        x - radius * 0.24,
        y - radius * 0.3,
        1,
        x,
        y,
        radius
      );
      gradient.addColorStop(0, "#79a96c");
      gradient.addColorStop(0.42, index % 2 === 0 ? "#527d49" : "#446f40");
      gradient.addColorStop(1, "#2a5331");

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      if (this.variant === "flowering" && index % 2 === 0) {
        ctx.fillStyle = index % 4 === 0 ? "#f2c1cf" : "#f3e0a2";
        ctx.beginPath();
        ctx.arc(x + radius * 0.22, y - radius * 0.2, Math.max(1.4, radius * 0.13), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    this.endDraw(ctx);
    this.drawSelection(ctx);
  }

  override toJSON(): BushElementDto {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.BUSH,
      variant: this.variant,
      clusterCount: this.clusterCount,
    };
  }

  static fromJSON(data: BushElementDto): BushElement {
    const element = new BushElement(data.x, data.y);
    element.id = data.id;
    element.name = data.name;
    element.layerName = data.layerName || "buildings";
    element.w = data.w ?? 1;
    element.h = data.h ?? 1;
    element.rotation = data.rotation;
    element.rotationStep = data.rotationStep;
    element.bg = data.bg;
    element.fg = data.fg;
    element.variant = data.variant ?? "compact";
    element.clusterCount = data.clusterCount ?? 6;
    return element;
  }

  override clone(): BushElement {
    const copy = new BushElement(this.x, this.y);
    copy.name = this.name;
    copy.w = this.w;
    copy.h = this.h;
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.variant = this.variant;
    copy.clusterCount = this.clusterCount;
    return copy;
  }

  override getEditableProperties(): IEditableProperty[] {
    return [
      ...super.getEditableProperties(),
      {
        label: i18next.t("ui.variant"),
        key: "variant",
        type: "select",
        options: BUSH_VARIANTS.map(item => ({
          value: item.value,
          label: i18next.t(item.labelKey),
        })),
      },
      {
        label: i18next.t("ui.clusterCount"),
        key: "clusterCount",
        type: "number",
        min: 3,
        max: 12,
      },
    ];
  }
}
