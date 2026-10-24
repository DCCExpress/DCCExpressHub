import i18next from "i18next";
import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import type { GardenHouseElementDto } from "@domain/layout/layoutDto";
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
  fallback = "#9f5545"
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
 * Detached house with its own garden parcel.
 *
 * w / h represent the garden dimensions in layout grid units. The house is
 * deliberately not stretched with the parcel: it is always recomputed around
 * the parcel center so changing either garden dimension keeps it centered.
 */
export class GardenHouseElement extends BaseElement {
  override type: typeof ELEMENT_TYPES.GARDEN_HOUSE =
    ELEMENT_TYPES.GARDEN_HOUSE;

  roofColor = "#9f5545";

  constructor(x: number, y: number) {
    super(x, y);
    this.layerName = "buildings";
    this.rotationStep = 0;
    this.name = "Garden house";
    this.w = 4;
    this.h = 3;
  }

  get gardenWidth(): number {
    return this.w;
  }

  set gardenWidth(value: number) {
    this.w = Math.max(
      2,
      Math.min(
        12,
        Math.round(
          Number.isFinite(value)
            ? value
            : 4
        )
      )
    );
  }

  get gardenHeight(): number {
    return this.h;
  }

  set gardenHeight(value: number) {
    this.h = Math.max(
      2,
      Math.min(
        10,
        Math.round(
          Number.isFinite(value)
            ? value
            : 3
        )
      )
    );
  }

  private drawShrub(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number
  ): void {
    ctx.fillStyle = "#557a45";
    ctx.strokeStyle = "#344d2d";
    ctx.lineWidth = 0.7;

    ctx.beginPath();
    ctx.arc(
      x,
      y,
      radius,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.13)";
    ctx.beginPath();
    ctx.arc(
      x - radius * 0.25,
      y - radius * 0.25,
      radius * 0.38,
      0,
      Math.PI * 2
    );
    ctx.fill();
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
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    // Garden / parcel.
    ctx.fillStyle = "#6f9856";
    ctx.strokeStyle = "#435d37";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(
      x + 2,
      y + 2,
      Math.max(8, width - 4),
      Math.max(8, height - 4),
      3
    );
    ctx.fill();
    ctx.stroke();

    // Slight lawn texture without becoming noisy at layout scale.
    ctx.strokeStyle = "rgba(228,241,211,0.16)";
    ctx.lineWidth = 0.6;

    const lawnStep = 13;
    for (
      let lawnX = x + 9;
      lawnX < x + width - 7;
      lawnX += lawnStep
    ) {
      ctx.beginPath();
      ctx.moveTo(lawnX, y + 5);
      ctx.lineTo(lawnX - 5, y + height - 5);
      ctx.stroke();
    }

    // Fence.
    ctx.strokeStyle = "#d2c4a6";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(
      x + 4,
      y + 4,
      Math.max(4, width - 8),
      Math.max(4, height - 8)
    );

    ctx.strokeStyle = "rgba(91,77,59,0.72)";
    ctx.lineWidth = 0.7;

    const postSpacing = 12;

    for (
      let postX = x + 6;
      postX <= x + width - 6;
      postX += postSpacing
    ) {
      ctx.beginPath();
      ctx.moveTo(postX, y + 2.5);
      ctx.lineTo(postX, y + 7);
      ctx.moveTo(postX, y + height - 7);
      ctx.lineTo(postX, y + height - 2.5);
      ctx.stroke();
    }

    for (
      let postY = y + 6;
      postY <= y + height - 6;
      postY += postSpacing
    ) {
      ctx.beginPath();
      ctx.moveTo(x + 2.5, postY);
      ctx.lineTo(x + 7, postY);
      ctx.moveTo(x + width - 7, postY);
      ctx.lineTo(x + width - 2.5, postY);
      ctx.stroke();
    }

    // House footprint stays centered and has its own capped dimensions.
    const availableHouseWidth =
      Math.max(
        22,
        width - 24
      );

    const availableHouseHeight =
      Math.max(
        18,
        height - 28
      );

    const houseWidth =
      Math.min(
        76,
        availableHouseWidth
      );

    const houseHeight =
      Math.min(
        42,
        availableHouseHeight
      );

    const houseX =
      centerX -
      houseWidth / 2;

    const houseY =
      centerY -
      houseHeight / 2;

    // Front path from the lower fence to the centered entrance.
    const pathWidth =
      Math.max(
        8,
        Math.min(
          13,
          houseWidth * 0.16
        )
      );

    const pathTop =
      houseY +
      houseHeight -
      3;

    ctx.fillStyle = "#b8af9e";
    ctx.strokeStyle = "#837b6e";
    ctx.lineWidth = 0.8;
    ctx.fillRect(
      centerX - pathWidth / 2,
      pathTop,
      pathWidth,
      Math.max(
        4,
        y + height - 4 - pathTop
      )
    );
    ctx.strokeRect(
      centerX - pathWidth / 2,
      pathTop,
      pathWidth,
      Math.max(
        4,
        y + height - 4 - pathTop
      )
    );

    // Small family-house wall block.
    ctx.fillStyle = "#ddcfb4";
    ctx.strokeStyle = "#756653";
    ctx.lineWidth = 0.9;
    ctx.fillRect(
      houseX + 3,
      houseY + 4,
      houseWidth - 6,
      houseHeight - 7
    );
    ctx.strokeRect(
      houseX + 3,
      houseY + 4,
      houseWidth - 6,
      houseHeight - 7
    );

    const roofColor =
      normalizeHexColor(
        this.roofColor,
        "#9f5545"
      );

    const roofDark =
      shadeHexColor(
        roofColor,
        -0.24
      );

    const roofLight =
      shadeHexColor(
        roofColor,
        0.2
      );

    const roofEdge =
      shadeHexColor(
        roofColor,
        -0.46
      );

    const roofX = houseX;
    const roofY = houseY;
    const roofWidth = houseWidth;
    const roofHeight =
      Math.max(
        16,
        houseHeight - 5
      );

    const ridgeY =
      roofY + roofHeight / 2;

    const ridgeInset = 5;

    let gradient =
      ctx.createLinearGradient(
        roofX,
        roofY,
        roofX,
        ridgeY
      );

    gradient.addColorStop(
      0,
      roofDark
    );
    gradient.addColorStop(
      1,
      roofLight
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
      roofX +
        roofWidth -
        ridgeInset,
      ridgeY
    );
    ctx.lineTo(
      roofX + ridgeInset,
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
      roofDark
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
      roofX +
        roofWidth -
        ridgeInset,
      ridgeY
    );
    ctx.lineTo(
      roofX + ridgeInset,
      ridgeY
    );
    ctx.closePath();
    ctx.fill();

    // Gable ends and roof outline.
    ctx.fillStyle = roofDark;

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
      roofX + ridgeInset,
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
      roofX +
        roofWidth -
        ridgeInset,
      ridgeY
    );
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = roofEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      roofX,
      roofY,
      roofWidth,
      roofHeight
    );

    ctx.strokeStyle =
      shadeHexColor(
        roofColor,
        0.34
      );
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(
      roofX + ridgeInset,
      ridgeY
    );
    ctx.lineTo(
      roofX +
        roofWidth -
        ridgeInset,
      ridgeY
    );
    ctx.stroke();

    // Tile rows.
    ctx.strokeStyle =
      "rgba(54,34,27,0.22)";
    ctx.lineWidth = 0.55;

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
        (roofY +
          roofHeight -
          ridgeY) *
          (row / 4);

      ctx.beginPath();
      ctx.moveTo(
        roofX + 2,
        upperY
      );
      ctx.lineTo(
        roofX +
          roofWidth -
          2,
        upperY
      );
      ctx.moveTo(
        roofX + 2,
        lowerY
      );
      ctx.lineTo(
        roofX +
          roofWidth -
          2,
        lowerY
      );
      ctx.stroke();
    }

    // Chimney.
    const chimneyX =
      roofX +
      roofWidth * 0.7;

    ctx.fillStyle = "#765044";
    ctx.strokeStyle = "#47372f";
    ctx.lineWidth = 0.8;
    ctx.fillRect(
      chimneyX - 2.3,
      ridgeY - 3,
      4.6,
      5
    );
    ctx.strokeRect(
      chimneyX - 2.3,
      ridgeY - 3,
      4.6,
      5
    );

    // Front entrance + two tiny facade windows.
    const wallY =
      houseY +
      houseHeight -
      7;

    const doorWidth =
      Math.max(
        5,
        Math.min(
          8,
          houseWidth * 0.12
        )
      );

    ctx.fillStyle = "#405545";
    ctx.strokeStyle = "#27372d";
    ctx.lineWidth = 0.7;
    ctx.fillRect(
      centerX - doorWidth / 2,
      wallY,
      doorWidth,
      5
    );
    ctx.strokeRect(
      centerX - doorWidth / 2,
      wallY,
      doorWidth,
      5
    );

    ctx.fillStyle = "#40565c";
    ctx.strokeStyle = "#e1d8c9";

    for (const offset of [-0.28, 0.28]) {
      const windowX =
        centerX +
        houseWidth * offset;

      ctx.fillRect(
        windowX - 2.2,
        wallY + 0.6,
        4.4,
        2.8
      );
      ctx.strokeRect(
        windowX - 2.2,
        wallY + 0.6,
        4.4,
        2.8
      );
    }

    // A few garden shrubs; positions follow parcel corners, never the house.
    const shrubRadius =
      Math.max(
        2.5,
        Math.min(
          4.5,
          Math.min(
            width,
            height
          ) * 0.035
        )
      );

    const shrubPositions = [
      {
        x: x + 13,
        y: y + 13,
      },
      {
        x: x + width - 13,
        y: y + 14,
      },
      {
        x: x + 14,
        y: y + height - 14,
      },
      {
        x: x + width - 14,
        y: y + height - 15,
      },
    ];

    for (const shrub of shrubPositions) {
      const insideHouse =
        shrub.x >= houseX - shrubRadius &&
        shrub.x <= houseX + houseWidth + shrubRadius &&
        shrub.y >= houseY - shrubRadius &&
        shrub.y <= houseY + houseHeight + shrubRadius;

      if (!insideHouse) {
        this.drawShrub(
          ctx,
          shrub.x,
          shrub.y,
          shrubRadius
        );
      }
    }

    this.endDraw(ctx);
    this.drawSelection(ctx);
  }

  override toJSON(): GardenHouseElementDto {
    return {
      ...super.toJSON(),
      type:
        ELEMENT_TYPES.GARDEN_HOUSE,
      gardenWidth:
        this.gardenWidth,
      gardenHeight:
        this.gardenHeight,
      roofColor:
        this.roofColor,
    };
  }

  static fromJSON(
    data: GardenHouseElementDto
  ): GardenHouseElement {
    const element =
      new GardenHouseElement(
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
          "#9f5545",
        "#9f5545"
      );
    element.gardenWidth =
      data.gardenWidth ??
      data.w ??
      4;
    element.gardenHeight =
      data.gardenHeight ??
      data.h ??
      3;

    return element;
  }

  override clone(): GardenHouseElement {
    const copy =
      new GardenHouseElement(
        this.x,
        this.y
      );

    copy.name = this.name;
    copy.gardenWidth =
      this.gardenWidth;
    copy.gardenHeight =
      this.gardenHeight;
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
            "ui.gardenWidth"
          ),
        key: "gardenWidth",
        type: "number",
        min: 2,
        max: 12,
      },
      {
        label:
          i18next.t(
            "ui.gardenHeight"
          ),
        key: "gardenHeight",
        type: "number",
        min: 2,
        max: 10,
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
