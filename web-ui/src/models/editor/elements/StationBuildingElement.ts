import i18next from "i18next";
import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import type {
  StationBuildingElementDto,
  StationBuildingVariantDto,
} from "@domain/layout/layoutDto";
import { BaseElement } from "../core/BaseElement";
import type { DrawOptions } from "../types/EditorTypes";
import type { IEditableProperty } from "./PropertyDescriptor";

const BUILDING_VARIANTS: Array<{
  value: StationBuildingVariantDto;
  labelKey: string;
}> = [
  { value: "classic", labelKey: "ui.classic" },
  { value: "rural", labelKey: "ui.rural" },
  { value: "modern", labelKey: "ui.modern" },
];

export class StationBuildingElement extends BaseElement {
  override type: typeof ELEMENT_TYPES.STATION_BUILDING =
    ELEMENT_TYPES.STATION_BUILDING;
  variant: StationBuildingVariantDto = "classic";

  constructor(x: number, y: number) {
    super(x, y);
    this.layerName = "buildings";
    this.rotationStep = 90;
    this.w = 4;
    this.h = 2;
    this.name = "Station building";
  }

  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;

    this.beginDraw(ctx, options);

    ctx.translate(this.centerX, this.centerY);
    ctx.rotate((this.rotation * Math.PI) / 180);

    const width =
      this.rotation % 180 === 0
        ? this.width
        : this.height;
    const height =
      this.rotation % 180 === 0
        ? this.height
        : this.width;

    const x = -width / 2;
    const y = -height / 2;

    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.roundRect(x + 5, y + 5, width, height, 5);
    ctx.fill();

    const wallGradient = ctx.createLinearGradient(x, y, x, y + height);
    wallGradient.addColorStop(
      0,
      this.variant === "modern" ? "#d9dde0" : "#ddccb0"
    );
    wallGradient.addColorStop(
      1,
      this.variant === "modern" ? "#aeb5bb" : "#c2ad8c"
    );
    ctx.fillStyle = wallGradient;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 5);
    ctx.fill();
    ctx.strokeStyle = "#65584a";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    const margin = this.variant === "rural" ? 7 : 9;
    const roofX = x + margin;
    const roofY = y + margin;
    const roofW = width - margin * 2;
    const roofH = height - margin * 2;

    if (this.variant === "modern") {
      const roof = ctx.createLinearGradient(roofX, roofY, roofX, roofY + roofH);
      roof.addColorStop(0, "#737b82");
      roof.addColorStop(1, "#555c62");
      ctx.fillStyle = roof;
      ctx.beginPath();
      ctx.roundRect(roofX, roofY, roofW, roofH, 3);
      ctx.fill();

      ctx.fillStyle = "#7693a4";
      const glassH = Math.max(5, roofH * 0.18);
      ctx.fillRect(roofX + 8, roofY + roofH - glassH - 6, roofW - 16, glassH);
    } else {
      const roof = ctx.createLinearGradient(roofX, roofY, roofX, roofY + roofH);
      roof.addColorStop(0, this.variant === "rural" ? "#8b654d" : "#b96354");
      roof.addColorStop(1, this.variant === "rural" ? "#6c4c3a" : "#8e443b");
      ctx.fillStyle = roof;
      ctx.beginPath();
      ctx.roundRect(roofX, roofY, roofW, roofH, 3);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.17)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(roofX + roofW / 2, roofY + 2);
      ctx.lineTo(roofX + roofW / 2, roofY + roofH - 2);
      ctx.stroke();
    }

    ctx.fillStyle = "#425260";
    const windowCount = this.variant === "rural" ? 3 : 5;
    for (let index = 0; index < windowCount; index += 1) {
      const wx =
        x +
        15 +
        index * ((width - 30) / Math.max(1, windowCount - 1));
      ctx.fillRect(wx - 3, y + height - 11, 6, 5);
    }

    ctx.fillStyle = "#4c3829";
    ctx.fillRect(-6, y + height - 12, 12, 10);

    this.endDraw(ctx);
    this.drawSelection(ctx);
  }

  override toJSON(): StationBuildingElementDto {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.STATION_BUILDING,
      variant: this.variant,
    };
  }

  static fromJSON(
    data: StationBuildingElementDto
  ): StationBuildingElement {
    const element = new StationBuildingElement(data.x, data.y);
    element.id = data.id;
    element.name = data.name;
    element.layerName = data.layerName || "buildings";
    element.w = data.w ?? 4;
    element.h = data.h ?? 2;
    element.rotation = data.rotation;
    element.rotationStep = data.rotationStep;
    element.bg = data.bg;
    element.fg = data.fg;
    element.variant = data.variant ?? "classic";
    return element;
  }

  override clone(): StationBuildingElement {
    const copy = new StationBuildingElement(this.x, this.y);
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
        options: BUILDING_VARIANTS.map(item => ({
          value: item.value,
          label: i18next.t(item.labelKey),
        })),
      },
    ];
  }
}
