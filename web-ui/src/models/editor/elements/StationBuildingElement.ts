import i18next from "i18next";
import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import type {
  StationBuildingElementDto,
  StationBuildingVariantDto,
} from "@domain/layout/layoutDto";
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
  fallback = "#b96354"
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

export class StationBuildingElement extends BaseElement {
  override type: typeof ELEMENT_TYPES.STATION_BUILDING =
    ELEMENT_TYPES.STATION_BUILDING;

  variant: StationBuildingVariantDto = "plain";

  roofColor = "#b96354";

  private _size = 3;

  get size(): number {
    return this._size;
  }

  set size(value: number) {
    const normalized = Math.max(
      1,
      Math.min(
        6,
        Math.round(
          Number.isFinite(value)
            ? value
            : 3
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
    this.name = "Station building";
    this.size = 3;
  }

  private drawEntranceVariant(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    palette: {
      edge: string;
      side: string;
      top: string;
      highlight: string;
      ridge: string;
      dormer: string;
    }
  ): void {
    if (
      this.variant === "plain" ||
      this.variant === "classic" ||
      this.variant === "rural" ||
      this.variant === "modern"
    ) {
      return;
    }

    const centerX = x + width / 2;
    const frontY = y + height - 1;

    if (
      this.variant === "terrace" ||
      this.variant === "coveredTerrace"
    ) {
      const terraceWidth =
        Math.min(
          width - 12,
          Math.max(
            22,
            width * 0.46
          )
        );

      const terraceX =
        centerX -
        terraceWidth / 2;

      const terraceY =
        frontY;
      const terraceDepth = 17;

      const deck =
        ctx.createLinearGradient(
          terraceX,
          terraceY,
          terraceX,
          frontY
        );

      deck.addColorStop(
        0,
        "#bda786"
      );
      deck.addColorStop(
        1,
        "#8f785c"
      );

      ctx.fillStyle = deck;
      ctx.strokeStyle =
        "#675641";
      ctx.lineWidth = 1;

      ctx.fillRect(
        terraceX,
        terraceY,
        terraceWidth,
        terraceDepth
      );

      ctx.strokeRect(
        terraceX,
        terraceY,
        terraceWidth,
        terraceDepth
      );

      ctx.strokeStyle =
        "rgba(255,255,255,0.18)";
      ctx.lineWidth = 0.8;

      for (
        let deckX =
          terraceX + 5;
        deckX <
          terraceX +
            terraceWidth -
            2;
        deckX += 7
      ) {
        ctx.beginPath();
        ctx.moveTo(
          deckX,
          terraceY + 1
        );
        ctx.lineTo(
          deckX,
          terraceY +
            terraceDepth -
            1
        );
        ctx.stroke();
      }

      if (
        this.variant ===
        "coveredTerrace"
      ) {
        const canopyY =
          terraceY + 1;
        const canopyDepth =
          11;

        const canopy =
          ctx.createLinearGradient(
            terraceX,
            canopyY,
            terraceX,
            terraceY
          );

        canopy.addColorStop(
          0,
          palette.highlight
        );
        canopy.addColorStop(
          1,
          palette.side
        );

        ctx.fillStyle = canopy;
        ctx.strokeStyle =
          palette.edge;
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.moveTo(
          terraceX + 2,
          canopyY
        );
        ctx.lineTo(
          terraceX +
            terraceWidth -
            2,
          canopyY
        );
        ctx.lineTo(
          terraceX +
            terraceWidth,
          canopyY +
            canopyDepth
        );
        ctx.lineTo(
          terraceX,
          canopyY +
            canopyDepth
        );
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle =
          "#51483e";

        ctx.fillRect(
          terraceX + 3,
          canopyY + 2,
          2,
          canopyDepth + 4
        );

        ctx.fillRect(
          terraceX +
            terraceWidth -
            5,
          canopyY + 2,
          2,
          canopyDepth + 4
        );
      }

      return;
    }

    if (
      this.variant === "stairs"
    ) {
      const steps = [
        { width: 12, depth: 5 },
        { width: 16, depth: 5 },
        { width: 20, depth: 5 },
      ];

      let stepY =
        frontY;

      steps.forEach(
        (
          step,
          index
        ) => {
          ctx.fillStyle =
            index % 2 === 0
              ? "#c1beb7"
              : "#a6a39d";
          ctx.strokeStyle =
            "#6e6b66";
          ctx.lineWidth = 0.8;

          ctx.fillRect(
            centerX -
              step.width / 2,
            stepY,
            step.width,
            step.depth
          );

          ctx.strokeRect(
            centerX -
              step.width / 2,
            stepY,
            step.width,
            step.depth
          );

          ctx.strokeStyle =
            "rgba(255,255,255,0.18)";
          ctx.beginPath();
          ctx.moveTo(
            centerX -
              step.width / 2 +
              1,
            stepY + 1
          );
          ctx.lineTo(
            centerX +
              step.width / 2 -
              1,
            stepY + 1
          );
          ctx.stroke();

          stepY +=
            step.depth;
        }
      );
    }
  }

  private drawEyebrowDormer(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    roofY: number,
    roofHeight: number,
    side: "top" | "bottom",
    palette: {
      edge: string;
      top: string;
      highlight: string;
      dormer: string;
    }
  ): void {
    const direction =
      side === "top"
        ? 1
        : -1;

    const baseY =
      side === "top"
        ? roofY + roofHeight * 0.17
        : roofY + roofHeight * 0.83;

    const width = 11;
    const height = 7;

    ctx.save();

    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.beginPath();
    ctx.ellipse(
      centerX + 1.5,
      baseY + direction * 1.3,
      width * 0.55,
      height * 0.42,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    const gradient =
      ctx.createLinearGradient(
        centerX,
        baseY - direction * height,
        centerX,
        baseY + direction * height
      );

    gradient.addColorStop(
      0,
      palette.highlight
    );
    gradient.addColorStop(
      0.55,
      palette.top
    );
    gradient.addColorStop(
      1,
      palette.dormer
    );

    ctx.fillStyle = gradient;
    ctx.strokeStyle = palette.edge;
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(
      centerX - width / 2,
      baseY
    );
    ctx.quadraticCurveTo(
      centerX,
      baseY - direction * height,
      centerX + width / 2,
      baseY
    );
    ctx.quadraticCurveTo(
      centerX,
      baseY - direction * (height * 0.3),
      centerX - width / 2,
      baseY
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle =
      "rgba(35,43,48,0.88)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(
      centerX - 2.8,
      baseY + direction * 0.6
    );
    ctx.lineTo(
      centerX + 2.8,
      baseY + direction * 0.6
    );
    ctx.stroke();

    ctx.restore();
  }

  override draw(
    ctx: CanvasRenderingContext2D,
    options?: DrawOptions
  ): void {
    if (!this.visible) return;

    this.beginDraw(ctx, options);

    const width = this.width;
    const height = this.height;
    const x = this.posLeft;
    const logicalY = this.posTop;

    const buildingOffsetY =
      this.variant === "plain"
        ? 0
        : -8;

    const y =
      logicalY +
      buildingOffsetY;

    const normalizedRoofColor =
      normalizeHexColor(
        this.roofColor,
        "#b96354"
      );

    const palette = {
      edge:
        shadeHexColor(
          normalizedRoofColor,
          -0.42
        ),
      side:
        shadeHexColor(
          normalizedRoofColor,
          -0.2
        ),
      top:
        normalizedRoofColor,
      highlight:
        shadeHexColor(
          normalizedRoofColor,
          0.22
        ),
      ridge:
        shadeHexColor(
          normalizedRoofColor,
          0.42
        ),
      dormer:
        shadeHexColor(
          normalizedRoofColor,
          -0.28
        ),
    };

    // Soft building shadow.
    ctx.fillStyle =
      "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.roundRect(
      x + 4,
      y + 5,
      width,
      height - 2,
      4
    );
    ctx.fill();

    // A narrow wall rim remains visible around the roof in top view.
    const wallMargin = 3;
    const wallGradient =
      ctx.createLinearGradient(
        x,
        y,
        x,
        y + height
      );

    wallGradient.addColorStop(
      0,
      "#e1d1b7"
    );
    wallGradient.addColorStop(
      1,
      "#bda98a"
    );

    ctx.fillStyle = wallGradient;
    ctx.strokeStyle = "#65584a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(
      x + wallMargin,
      y + wallMargin,
      width - wallMargin * 2,
      height - wallMargin * 2,
      3
    );
    ctx.fill();
    ctx.stroke();

    // Hipped / tent roof.
    const roofMargin = 5;
    const roofX = x + roofMargin;
    const roofY = y + roofMargin;
    const roofWidth =
      width - roofMargin * 2;
    const roofHeight =
      height - roofMargin * 2;

    const ridgeInset =
      Math.min(
        15,
        roofWidth * 0.18
      );

    const ridgeY =
      roofY + roofHeight / 2;
    const ridgeX1 =
      roofX + ridgeInset;
    const ridgeX2 =
      roofX + roofWidth - ridgeInset;

    let gradient =
      ctx.createLinearGradient(
        roofX,
        roofY,
        roofX,
        ridgeY
      );

    gradient.addColorStop(
      0,
      palette.side
    );
    gradient.addColorStop(
      1,
      palette.top
    );

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(roofX, roofY);
    ctx.lineTo(
      roofX + roofWidth,
      roofY
    );
    ctx.lineTo(
      ridgeX2,
      ridgeY
    );
    ctx.lineTo(
      ridgeX1,
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
      palette.side
    );
    gradient.addColorStop(
      1,
      palette.top
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
      ridgeX2,
      ridgeY
    );
    ctx.lineTo(
      ridgeX1,
      ridgeY
    );
    ctx.closePath();
    ctx.fill();

    gradient =
      ctx.createLinearGradient(
        roofX,
        ridgeY,
        ridgeX1,
        ridgeY
      );

    gradient.addColorStop(
      0,
      palette.edge
    );
    gradient.addColorStop(
      1,
      palette.top
    );

    ctx.fillStyle = gradient;
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
      ridgeX1,
      ridgeY
    );
    ctx.closePath();
    ctx.fill();

    gradient =
      ctx.createLinearGradient(
        roofX + roofWidth,
        ridgeY,
        ridgeX2,
        ridgeY
      );

    gradient.addColorStop(
      0,
      palette.edge
    );
    gradient.addColorStop(
      1,
      palette.top
    );

    ctx.fillStyle = gradient;
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
      ridgeX2,
      ridgeY
    );
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle =
      palette.edge;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(
      roofX,
      roofY,
      roofWidth,
      roofHeight
    );

    ctx.strokeStyle =
      "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(
      roofX,
      roofY
    );
    ctx.lineTo(
      ridgeX1,
      ridgeY
    );
    ctx.moveTo(
      roofX,
      roofY + roofHeight
    );
    ctx.lineTo(
      ridgeX1,
      ridgeY
    );
    ctx.moveTo(
      roofX + roofWidth,
      roofY
    );
    ctx.lineTo(
      ridgeX2,
      ridgeY
    );
    ctx.moveTo(
      roofX + roofWidth,
      roofY + roofHeight
    );
    ctx.lineTo(
      ridgeX2,
      ridgeY
    );
    ctx.stroke();

    ctx.strokeStyle =
      palette.ridge;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(
      ridgeX1,
      ridgeY
    );
    ctx.lineTo(
      ridgeX2,
      ridgeY
    );
    ctx.stroke();

    // Roof "eyebrows". Their count grows gently with the building size.
    const pairCount =
      Math.max(
        1,
        Math.min(
          4,
          Math.floor(
            (this.size + 1) / 2
          )
        )
      );

    for (
      let index = 0;
      index < pairCount;
      index += 1
    ) {
      const progress =
        (index + 1) /
        (pairCount + 1);

      const eyebrowX =
        ridgeX1 +
        (ridgeX2 - ridgeX1) *
          progress;

      this.drawEyebrowDormer(
        ctx,
        eyebrowX,
        roofY,
        roofHeight,
        "top",
        palette
      );

      if (
        this.size >= 3 ||
        index % 2 === 0
      ) {
        this.drawEyebrowDormer(
          ctx,
          eyebrowX,
          roofY,
          roofHeight,
          "bottom",
          palette
        );
      }
    }

    if (this.size >= 2) {
      const chimneyX =
        ridgeX2 -
        Math.min(
          10,
          (ridgeX2 - ridgeX1) *
            0.15
        );

      const chimneyY =
        ridgeY - 5;

      ctx.fillStyle = "#6b625b";
      ctx.strokeStyle = "#3f3934";
      ctx.lineWidth = 1;
      ctx.fillRect(
        chimneyX - 2.5,
        chimneyY - 3,
        5,
        6
      );
      ctx.strokeRect(
        chimneyX - 2.5,
        chimneyY - 3,
        5,
        6
      );
    }

    this.drawEntranceVariant(
      ctx,
      x,
      y,
      width,
      height,
      palette
    );

    this.endDraw(ctx);
    this.drawSelection(ctx);
  }

  override toJSON(): StationBuildingElementDto {
    return {
      ...super.toJSON(),
      type:
        ELEMENT_TYPES.STATION_BUILDING,
      variant: this.variant,
      size: this.size,
      roofColor: this.roofColor,
    };
  }

  static fromJSON(
    data: StationBuildingElementDto
  ): StationBuildingElement {
    const element =
      new StationBuildingElement(
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
    element.variant =
      data.variant === "terrace" ||
      data.variant === "coveredTerrace" ||
      data.variant === "stairs"
        ? data.variant
        : "plain";
    element.roofColor =
      normalizeHexColor(
        data.roofColor ??
          "#b96354",
        "#b96354"
      );

    // New layouts persist size explicitly. Older prototype layouts used w.
    element.size =
      data.size ??
      data.w ??
      3;

    return element;
  }

  override clone(): StationBuildingElement {
    const copy =
      new StationBuildingElement(
        this.x,
        this.y
      );

    copy.name = this.name;
    copy.size = this.size;
    copy.roofColor =
      this.roofColor;
    copy.variant =
      this.variant;

    return copy;
  }

  override getEditableProperties(): IEditableProperty[] {
    return [
      ...super.getEditableProperties(),
      {
        label:
          i18next.t(
            "ui.variant"
          ),
        key: "variant",
        type: "select",
        options: [
          {
            value: "plain",
            label:
              i18next.t(
                "ui.plainEntrance"
              ),
          },
          {
            value: "terrace",
            label:
              i18next.t(
                "ui.terrace"
              ),
          },
          {
            value: "coveredTerrace",
            label:
              i18next.t(
                "ui.coveredTerrace"
              ),
          },
          {
            value: "stairs",
            label:
              i18next.t(
                "ui.stairs"
              ),
          },
        ],
      },
      {
        label:
          i18next.t(
            "ui.size"
          ),
        key: "size",
        type: "number",
        min: 1,
        max: 6,
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
