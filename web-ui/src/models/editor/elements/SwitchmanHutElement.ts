import i18next from "i18next";
import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import type { SwitchmanHutElementDto } from "@domain/layout/layoutDto";
import { BaseElement } from "../core/BaseElement";
import type { DrawOptions } from "../types/EditorTypes";
import type { IEditableProperty } from "./PropertyDescriptor";

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizeHexColor(value: string, fallback: string): string {
  const raw = value.trim();

  if (/^#[0-9a-f]{6}$/i.test(raw)) {
    return raw.toLowerCase();
  }

  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return (
      "#" +
      raw
        .slice(1)
        .split("")
        .map(char => char + char)
        .join("")
    ).toLowerCase();
  }

  return fallback;
}

function shadeHexColor(
  value: string,
  factor: number,
  fallback = "#a6503e"
): string {
  const hex = normalizeHexColor(value, fallback);
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);

  const transform = (channel: number) =>
    factor >= 0
      ? clampByte(channel + (255 - channel) * factor)
      : clampByte(channel * (1 + factor));

  return (
    "#" +
    [transform(red), transform(green), transform(blue)]
      .map(channel => channel.toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Compact railway switchman's hut.
 *
 * The renderer is intentionally almost orthographic top-down. Only a very
 * narrow front wall/entrance edge is visible so it reads naturally on the HUB
 * layout canvas without turning into an isometric building.
 */
export class SwitchmanHutElement extends BaseElement {
  override type: typeof ELEMENT_TYPES.SWITCHMAN_HUT =
    ELEMENT_TYPES.SWITCHMAN_HUT;

  roofColor = "#a6503e";

  private _size = 2;

  get size(): number {
    return this._size;
  }

  set size(value: number) {
    const normalized = Math.max(
      1,
      Math.min(
        4,
        Math.round(
          Number.isFinite(value)
            ? value
            : 2
        )
      )
    );

    this._size = normalized;
    this.w = normalized;
    this.h = 1;
  }

  constructor(x: number, y: number) {
    super(x, y);
    this.layerName = "buildings";
    this.rotationStep = 0;
    this.name = "Switchman's hut";
    this.size = 2;
  }

  override draw(
    ctx: CanvasRenderingContext2D,
    options?: DrawOptions
  ): void {
    if (!this.visible) return;

    this.beginDraw(ctx, options);

    const x = this.posLeft;
    const y = this.posTop;
    const width = this.width;
    const height = this.height;

    const roofColor =
      normalizeHexColor(
        this.roofColor,
        "#a6503e"
      );

    const edge =
      shadeHexColor(
        roofColor,
        -0.46
      );

    const dark =
      shadeHexColor(
        roofColor,
        -0.22
      );

    const light =
      shadeHexColor(
        roofColor,
        0.2
      );

    const ridge =
      shadeHexColor(
        roofColor,
        0.34
      );

    // Tiny forward projection only: enough to suggest a front facade while
    // preserving an almost perfectly top-down HUB asset.
    const facadeDepth = 4;
    const roofMarginX = 4;
    const roofMarginTop = 4;
    const roofMarginBottom =
      facadeDepth + 2;

    const roofX =
      x + roofMarginX;
    const roofY =
      y + roofMarginTop;
    const roofWidth =
      Math.max(
        10,
        width - roofMarginX * 2
      );
    const roofHeight =
      Math.max(
        12,
        height -
          roofMarginTop -
          roofMarginBottom
      );

    const ridgeY =
      roofY + roofHeight / 2;

    // Soft shadow.
    ctx.fillStyle =
      "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.roundRect(
      x + 4,
      y + 5,
      width - 3,
      height - 3,
      3
    );
    ctx.fill();

    // Very thin plaster facade visible on the lower edge.
    const wallX = x + 6;
    const wallY =
      roofY + roofHeight - 1;
    const wallWidth =
      width - 12;

    ctx.fillStyle = "#d8c9ae";
    ctx.strokeStyle = "#766957";
    ctx.lineWidth = 0.9;
    ctx.fillRect(
      wallX,
      wallY,
      wallWidth,
      facadeDepth + 1
    );
    ctx.strokeRect(
      wallX,
      wallY,
      wallWidth,
      facadeDepth + 1
    );

    // Foundation strip.
    ctx.fillStyle = "#8a8881";
    ctx.fillRect(
      wallX,
      wallY + facadeDepth - 0.5,
      wallWidth,
      1.5
    );

    // Main gable roof: two almost-flat planes separated by the ridge.
    let gradient =
      ctx.createLinearGradient(
        roofX,
        roofY,
        roofX,
        ridgeY
      );

    gradient.addColorStop(
      0,
      dark
    );
    gradient.addColorStop(
      1,
      light
    );

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(
      roofX,
      roofY
    );
    ctx.lineTo(
      roofX + roofWidth,
      roofY
    );
    ctx.lineTo(
      roofX + roofWidth - 4,
      ridgeY
    );
    ctx.lineTo(
      roofX + 4,
      ridgeY
    );
    ctx.closePath();
    ctx.fill();

    gradient =
      ctx.createLinearGradient(
        roofX,
        roofY + roofHeight,
        roofX,
        ridgeY
      );

    gradient.addColorStop(
      0,
      dark
    );
    gradient.addColorStop(
      1,
      roofColor
    );

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(
      roofX,
      roofY + roofHeight
    );
    ctx.lineTo(
      roofX + roofWidth,
      roofY + roofHeight
    );
    ctx.lineTo(
      roofX + roofWidth - 4,
      ridgeY
    );
    ctx.lineTo(
      roofX + 4,
      ridgeY
    );
    ctx.closePath();
    ctx.fill();

    // Gable end caps.
    ctx.fillStyle = dark;

    ctx.beginPath();
    ctx.moveTo(
      roofX,
      roofY
    );
    ctx.lineTo(
      roofX,
      roofY + roofHeight
    );
    ctx.lineTo(
      roofX + 4,
      ridgeY
    );
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(
      roofX + roofWidth,
      roofY
    );
    ctx.lineTo(
      roofX + roofWidth,
      roofY + roofHeight
    );
    ctx.lineTo(
      roofX + roofWidth - 4,
      ridgeY
    );
    ctx.closePath();
    ctx.fill();

    // Roof outline + ridge.
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.1;
    ctx.strokeRect(
      roofX,
      roofY,
      roofWidth,
      roofHeight
    );

    ctx.strokeStyle = ridge;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(
      roofX + 4,
      ridgeY
    );
    ctx.lineTo(
      roofX + roofWidth - 4,
      ridgeY
    );
    ctx.stroke();

    // Subtle tile rows.
    ctx.strokeStyle =
      "rgba(54,34,27,0.22)";
    ctx.lineWidth = 0.6;

    for (
      let row = 1;
      row <= 3;
      row += 1
    ) {
      const upperY =
        roofY +
        (ridgeY - roofY) *
          (row / 4);

      const lowerY =
        ridgeY +
        (roofY + roofHeight - ridgeY) *
          (row / 4);

      ctx.beginPath();
      ctx.moveTo(
        roofX + 2,
        upperY
      );
      ctx.lineTo(
        roofX + roofWidth - 2,
        upperY
      );
      ctx.moveTo(
        roofX + 2,
        lowerY
      );
      ctx.lineTo(
        roofX + roofWidth - 2,
        lowerY
      );
      ctx.stroke();
    }

    // Chimney.
    const chimneyX =
      roofX +
      roofWidth * 0.72;
    const chimneyY =
      ridgeY - 4;

    ctx.fillStyle = "#795142";
    ctx.strokeStyle = "#47372f";
    ctx.lineWidth = 0.9;
    ctx.fillRect(
      chimneyX - 2.5,
      chimneyY - 2.5,
      5,
      5
    );
    ctx.strokeRect(
      chimneyX - 2.5,
      chimneyY - 2.5,
      5,
      5
    );

    ctx.fillStyle = "#2f2925";
    ctx.fillRect(
      chimneyX - 1,
      chimneyY - 1,
      2,
      2
    );

    // Tiny front entrance and shallow canopy. This is the only intentional
    // "front view" cue and stays within a few pixels.
    const centerX =
      x + width / 2;
    const doorWidth =
      Math.max(
        4,
        Math.min(
          7,
          width * 0.12
        )
      );

    ctx.fillStyle = "#304437";
    ctx.strokeStyle = "#202c25";
    ctx.lineWidth = 0.8;
    ctx.fillRect(
      centerX - doorWidth / 2,
      wallY + 0.5,
      doorWidth,
      facadeDepth
    );
    ctx.strokeRect(
      centerX - doorWidth / 2,
      wallY + 0.5,
      doorWidth,
      facadeDepth
    );

    const canopyWidth =
      doorWidth + 7;

    ctx.fillStyle = roofColor;
    ctx.strokeStyle = edge;
    ctx.beginPath();
    ctx.moveTo(
      centerX,
      wallY - 3.5
    );
    ctx.lineTo(
      centerX -
        canopyWidth / 2,
      wallY + 0.5
    );
    ctx.lineTo(
      centerX +
        canopyWidth / 2,
      wallY + 0.5
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // One-pixel-ish step: readable on the canvas, but no isometric projection.
    ctx.fillStyle = "#aaa69f";
    ctx.strokeStyle = "#6d6963";
    ctx.fillRect(
      centerX -
        (doorWidth + 4) / 2,
      wallY +
        facadeDepth +
        0.5,
      doorWidth + 4,
      1.5
    );
    ctx.strokeRect(
      centerX -
        (doorWidth + 4) / 2,
      wallY +
        facadeDepth +
        0.5,
      doorWidth + 4,
      1.5
    );

    // Small facade windows.
    if (this.size >= 2) {
      ctx.fillStyle = "#394b4d";
      ctx.strokeStyle = "#e0d8c9";
      ctx.lineWidth = 0.7;

      const windowY =
        wallY + 1.1;

      for (const offset of [-0.27, 0.27]) {
        const windowX =
          centerX +
          wallWidth * offset;

        ctx.fillRect(
          windowX - 2,
          windowY,
          4,
          2.4
        );
        ctx.strokeRect(
          windowX - 2,
          windowY,
          4,
          2.4
        );
      }
    }

    this.endDraw(ctx);
    this.drawSelection(ctx);
  }

  override toJSON(): SwitchmanHutElementDto {
    return {
      ...super.toJSON(),
      type:
        ELEMENT_TYPES.SWITCHMAN_HUT,
      size: this.size,
      roofColor: this.roofColor,
    };
  }

  static fromJSON(
    data: SwitchmanHutElementDto
  ): SwitchmanHutElement {
    const element =
      new SwitchmanHutElement(
        data.x,
        data.y
      );

    element.id = data.id;
    element.name = data.name;
    element.layerName =
      data.layerName ||
      "buildings";
    element.rotation = 0;
    element.rotationStep = 0;
    element.bg = data.bg;
    element.fg = data.fg;
    element.roofColor =
      normalizeHexColor(
        data.roofColor ??
          "#a6503e",
        "#a6503e"
      );
    element.size =
      data.size ??
      data.w ??
      2;

    return element;
  }

  override clone(): SwitchmanHutElement {
    const copy =
      new SwitchmanHutElement(
        this.x,
        this.y
      );

    copy.name = this.name;
    copy.size = this.size;
    copy.roofColor =
      this.roofColor;

    return copy;
  }

  override getEditableProperties(): IEditableProperty[] {
    return [
      ...super.getEditableProperties(),
      {
        label:
          i18next.t(
            "ui.size"
          ),
        key: "size",
        type: "number",
        min: 1,
        max: 4,
      },
      {
        label:
          i18next.t(
            "ui.roofColor"
          ),
        key: "roofColor",
        type: "colorpicker",
      },
    ];
  }
}
