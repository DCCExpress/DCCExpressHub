import i18next from "i18next";
import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import type {
  TreeElementDto,
  TreeVariantDto,
} from "@domain/layout/layoutDto";
import { BaseElement } from "../core/BaseElement";
import type { DrawOptions } from "../types/EditorTypes";
import type { IEditableProperty } from "./PropertyDescriptor";

const TREE_VARIANTS: Array<{ value: TreeVariantDto; labelKey: string }> = [
  { value: "round", labelKey: "ui.round" },
  { value: "broad", labelKey: "ui.broadCrown" },
  { value: "conifer", labelKey: "ui.conifer" },
];

export class TreeElement extends BaseElement {
  override type: typeof ELEMENT_TYPES.TREE = ELEMENT_TYPES.TREE;
  variant: TreeVariantDto = "round";
  branchCount = 5;

  constructor(x: number, y: number) {
    super(x, y);
    this.layerName = "buildings";
    this.rotationStep = 45;
    this.name = "Tree";
  }

  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;

    this.beginDraw(ctx, options);
    ctx.translate(this.centerX, this.centerY);
    ctx.rotate((this.rotation * Math.PI) / 180);

    const crownRadius = Math.max(10, Math.min(this.width, this.height) * 0.36);
    const lobeCount = Math.max(3, Math.min(10, Math.round(this.branchCount)));

    ctx.fillStyle = "rgba(0,0,0,0.20)";
    ctx.beginPath();
    ctx.ellipse(4, 5, crownRadius * 1.08, crownRadius * 0.86, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#6b4e35";
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(2.5, crownRadius * 0.14), 0, Math.PI * 2);
    ctx.fill();

    if (this.variant === "conifer") {
      for (let ring = 0; ring < 3; ring += 1) {
        const radius = crownRadius * (1 - ring * 0.22);
        const gradient = ctx.createRadialGradient(
          -radius * 0.24,
          -radius * 0.3,
          radius * 0.08,
          0,
          0,
          radius
        );
        gradient.addColorStop(0, "#5b9567");
        gradient.addColorStop(0.4, "#326845");
        gradient.addColorStop(1, "#183c2b");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, ring * 1.5, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const spread = this.variant === "broad" ? 0.88 : 0.7;
      for (let index = 0; index < lobeCount; index += 1) {
        const angle = (index / lobeCount) * Math.PI * 2;
        const offset = crownRadius * spread;
        const x = Math.cos(angle) * offset * 0.58;
        const y = Math.sin(angle) * offset * (this.variant === "broad" ? 0.42 : 0.56);
        const radius =
          crownRadius *
          (this.variant === "broad" ? 0.62 : 0.58) *
          (0.9 + (index % 3) * 0.05);

        const gradient = ctx.createRadialGradient(
          x - radius * 0.25,
          y - radius * 0.3,
          radius * 0.08,
          x,
          y,
          radius
        );
        gradient.addColorStop(0, "#75a966");
        gradient.addColorStop(0.38, index % 2 === 0 ? "#4f8a50" : "#427c47");
        gradient.addColorStop(1, "#245733");

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    this.endDraw(ctx);
    this.drawSelection(ctx);
  }

  override toJSON(): TreeElementDto {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.TREE,
      variant: this.variant,
      branchCount: this.branchCount,
    };
  }

  static fromJSON(data: TreeElementDto): TreeElement {
    const element = new TreeElement(data.x, data.y);
    element.id = data.id;
    element.name = data.name;
    element.layerName = data.layerName || "buildings";
    element.w = data.w ?? 1;
    element.h = data.h ?? 1;
    element.rotation = data.rotation;
    element.rotationStep = data.rotationStep;
    element.bg = data.bg;
    element.fg = data.fg;
    element.variant = data.variant ?? "round";
    element.branchCount = data.branchCount ?? 5;
    return element;
  }

  override clone(): TreeElement {
    const copy = new TreeElement(this.x, this.y);
    copy.name = this.name;
    copy.w = this.w;
    copy.h = this.h;
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.variant = this.variant;
    copy.branchCount = this.branchCount;
    return copy;
  }

  override getEditableProperties(): IEditableProperty[] {
    return [
      ...super.getEditableProperties(),
      {
        label: i18next.t("ui.variant"),
        key: "variant",
        type: "select",
        options: TREE_VARIANTS.map(item => ({
          value: item.value,
          label: i18next.t(item.labelKey),
        })),
      },
      {
        label: i18next.t("ui.branchCount"),
        key: "branchCount",
        type: "number",
        min: 3,
        max: 10,
      },
    ];
  }
}
