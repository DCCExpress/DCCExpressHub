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
    const frontY = y + height - 3;

    if (
      this.variant === "stairs"
    ) {
      const steps = [
        { width: 14, depth: 1.5 },
        { width: 18, depth: 1.5 },
        { width: 22, depth: 1.5 },
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

    const x = this.posLeft;
    const logicalY = this.posTop;
    const width = this.width;
    const height = this.height;

    const buildingOffsetY =
      this.variant === "stairs"
        ? -2
        : 0;

    const y =
      logicalY +
      buildingOffsetY;

    const roofColor =
      normalizeHexColor(
        this.roofColor,
        "#b96354"
      );

    const palette = {
      edge:
        shadeHexColor(
          roofColor,
          -0.46
        ),
      dark:
        shadeHexColor(
          roofColor,
          -0.22
        ),
      top:
        roofColor,
      light:
        shadeHexColor(
          roofColor,
          0.2
        ),
      ridge:
        shadeHexColor(
          roofColor,
          0.34
        ),
      dormer:
        shadeHexColor(
          roofColor,
          -0.28
        ),
    };

    // Same almost-orthographic language as the switchman's hut:
    // a very thin front facade, with the roof carrying most of the shape.
    const facadeDepth = 5;
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
        18,
        width - roofMarginX * 2
      );
    const roofHeight =
      Math.max(
        12,
        height -
          roofMarginTop -
          roofMarginBottom
      );

    const ridgeInset =
      Math.max(
        4,
        Math.min(
          8,
          roofWidth * 0.055
        )
      );

    const ridgeY =
      roofY + roofHeight / 2;
    const ridgeX1 =
      roofX + ridgeInset;
    const ridgeX2 =
      roofX +
      roofWidth -
      ridgeInset;

    // Entrance details stay tucked under the lower roof edge.
    this.drawEntranceVariant(
      ctx,
      x,
      y,
      width,
      height,
      {
        edge: palette.edge,
        side: palette.dark,
        top: palette.top,
        highlight: palette.light,
        ridge: palette.ridge,
        dormer: palette.dormer,
      }
    );

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

    // Narrow plaster facade visible only on the lower edge.
    const wallX = x + 6;
    const wallY =
      roofY + roofHeight - 1;
    const wallWidth =
      Math.max(
        12,
        width - 12
      );

    const wallGradient =
      ctx.createLinearGradient(
        wallX,
        wallY,
        wallX,
        wallY + facadeDepth + 1
      );

    wallGradient.addColorStop(
      0,
      "#e2d4bc"
    );
    wallGradient.addColorStop(
      1,
      "#c5b292"
    );

    ctx.fillStyle = wallGradient;
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

    // Main gable roof, matching the switchman's hut rather than the old
    // hipped-roof station silhouette.
    let gradient =
      ctx.createLinearGradient(
        roofX,
        roofY,
        roofX,
        ridgeY
      );

    gradient.addColorStop(
      0,
      palette.dark
    );
    gradient.addColorStop(
      1,
      palette.light
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
      palette.dark
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

    // Gable end caps.
    ctx.fillStyle = palette.dark;

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

    // Roof outline + ridge.
    ctx.strokeStyle =
      palette.edge;
    ctx.lineWidth = 1.1;
    ctx.strokeRect(
      roofX,
      roofY,
      roofWidth,
      roofHeight
    );

    ctx.strokeStyle =
      palette.ridge;
    ctx.lineWidth = 1.7;
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

    // Subtle tile rows, same visual texture as the switchman's hut.
    ctx.strokeStyle =
      "rgba(54,34,27,0.22)";
    ctx.lineWidth = 0.6;

    const tileRows =
      this.size >= 5
        ? 4
        : 3;

    for (
      let row = 1;
      row <= tileRows;
      row += 1
    ) {
      const fraction =
        row /
        (tileRows + 1);

      const upperY =
        roofY +
        (ridgeY - roofY) *
          fraction;

      const lowerY =
        ridgeY +
        (roofY +
          roofHeight -
          ridgeY) *
          fraction;

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

    // Keep the station-building roof windows / vents from the previous
    // design. The count scales gently with building length.
    const dormerCount =
      Math.max(
        1,
        Math.min(
          4,
          Math.floor(
            (this.size + 1) /
              2
          )
        )
      );

    for (
      let index = 0;
      index < dormerCount;
      index += 1
    ) {
      const progress =
        (index + 1) /
        (dormerCount + 1);

      const dormerX =
        ridgeX1 +
        (ridgeX2 -
          ridgeX1) *
          progress;

      this.drawEyebrowDormer(
        ctx,
        dormerX,
        roofY,
        roofHeight,
        "top",
        {
          edge: palette.edge,
          top: palette.top,
          highlight: palette.light,
          dormer: palette.dormer,
        }
      );

      if (
        this.size >= 3 ||
        index % 2 === 0
      ) {
        this.drawEyebrowDormer(
          ctx,
          dormerX,
          roofY,
          roofHeight,
          "bottom",
          {
            edge: palette.edge,
            top: palette.top,
            highlight: palette.light,
            dormer: palette.dormer,
          }
        );
      }
    }

    // Chimney.
    if (this.size >= 2) {
      const chimneyX =
        roofX +
        roofWidth * 0.76;
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
    }

    // Central entrance, kept shallow so the asset still reads as top-down.
    const centerX =
      x + width / 2;
    const doorWidth =
      Math.max(
        5,
        Math.min(
          8,
          width * 0.075
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
      doorWidth + 8;

    ctx.fillStyle =
      palette.top;
    ctx.strokeStyle =
      palette.edge;
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

    // Platform-facing windows.
    if (this.size >= 2) {
      ctx.fillStyle = "#394b4d";
      ctx.strokeStyle = "#e0d8c9";
      ctx.lineWidth = 0.7;

      const windowY =
        wallY + 1.1;

      const windowCount =
        Math.max(
          2,
          Math.min(
            6,
            this.size + 1
          )
        );

      for (
        let index = 0;
        index < windowCount;
        index += 1
      ) {
        const progress =
          (index + 1) /
          (windowCount + 1);

        const windowX =
          wallX +
          wallWidth *
            progress;

        if (
          Math.abs(
            windowX -
              centerX
          ) <
          doorWidth + 5
        ) {
          continue;
        }

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
      data.variant === "stairs"
        ? "stairs"
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
