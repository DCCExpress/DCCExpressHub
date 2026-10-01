import i18next from "i18next";
import { BLOCK_TYPES, type BlockType, ELEMENT_TYPES } from "../../../domain/layout/elementTypes";
import type { IRect } from "../../../domain/Rect";
import type { BlockDirectionEventConfigDto, BlockEventConfigDto, BlockEventSensorConditionDto } from "../../../domain/layout/layoutDto";
import { generateId } from "../../../helpers";
import i18n from "../../../i18n";
import { getBlockTargetLocoAddress } from "../../../services/blockTargetLocoRuntime";
import { getMovementBlockRuntime } from "../../../services/movementBlockRuntime";
import { wsClient } from "../../../services/wsClient";
import { TrackElement } from "../core/TrackElement";
import { getCanvasImage } from "../rendering/ImageCache";
import { DrawOptions, IBlockElement } from "../types/EditorTypes";
import { IEditableProperty } from "./PropertyDescriptor";
function normalizeBlockEventConditions(value: unknown): BlockEventSensorConditionDto[] {
  if (!Array.isArray(value)) return [];

  const result: BlockEventSensorConditionDto[] = [];
  const used = new Set<number>();

  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Record<string, unknown>;
    const sensor = Math.trunc(Number(candidate.sensor));
    if (!Number.isInteger(sensor) || sensor < 1 || sensor > 65535 || used.has(sensor)) continue;
    used.add(sensor);
    // Block configuration stores physical sensor groups only. Their configured
    // trigger is always ON; derived OFF events are produced by Movement.
    result.push({ sensor, state: true });
  }

  return result;
}

function normalizeBlockDirectionEvents(value: unknown): BlockDirectionEventConfigDto {
  const candidate =
    value && typeof value === "object"
      ? value as Record<string, unknown>
      : {};

  const legacyLeave =
    Array.isArray(candidate.afterLeave) &&
    candidate.afterLeave.length > 0
      ? candidate.afterLeave
      : candidate.beforeLeave;

  return {
    // Legacy migration:
    //   beforeArrive -> arrival
    //   arrived      -> arrived
    //   afterLeave / beforeLeave -> leave sensor group
    arrival: normalizeBlockEventConditions(
      candidate.arrival ??
      candidate.beforeArrive
    ),
    arrived: normalizeBlockEventConditions(
      candidate.arrived
    ),
    leave: normalizeBlockEventConditions(
      candidate.leave ??
      legacyLeave
    ),
  };
}

export function emptyBlockEventConfig(): BlockEventConfigDto {
  return {
    forward: normalizeBlockDirectionEvents(null),
    reverse: normalizeBlockDirectionEvents(null),
  };
}

function normalizeBlockEventConfig(value: unknown): BlockEventConfigDto {
  const candidate =
    value && typeof value === "object"
      ? value as Record<string, unknown>
      : {};

  return {
    forward: normalizeBlockDirectionEvents(candidate.forward),
    reverse: normalizeBlockDirectionEvents(candidate.reverse),
  };
}

export class BlockElement extends TrackElement {
  text: string = "HELLO";
  textColor: string = "black";
  locoAddress: number = 0;
  override length: number = 1;
  sensorAddress: number = 0;
  blockType: BlockType = BLOCK_TYPES.NORMAL;
  eventConfig: BlockEventConfigDto = emptyBlockEventConfig();
  /**
   * A blokk vizuálisan 3x1 overlay, de az x/y továbbra is
   * a blokkhoz tartozó középső fizikai síncella.
   */
  override getBounds(): IRect {
    if (this.rotation === 0 || this.rotation === 180) {
      return {
        x: this.x - 1,
        y: this.y,
        width: this.w,
        height: this.h,
      };
    }
    return {
      x: this.x,
      y: this.y - 1,
      width: this.h,
      height: this.w,
    };
  }
  /**
   * Ütközéshez nem a teljes vizuális overlayt foglaljuk,
   * hanem csak a blokk középső síncelláját.
   *
   * Így a blokk kattintható/kijelölhető a teljes rajzolt méretén,
   * de a szerkesztőben nem tiltja túl agresszíven a szomszédos elemeket.
   */
  override getCollisionBounds(): IRect {
    return {
      x: this.x,
      y: this.y,
      width: 1,
      height: 1,
    };
  }
  override type: typeof ELEMENT_TYPES.TRACK_BLOCK = ELEMENT_TYPES.TRACK_BLOCK;
  /**
   * Csak kliensoldali, átmeneti overlay:
   * ha a task két blokk között halad,
   * mindkét érintett blokkban ezt a címet mutatjuk.
   */
  runtimeTransitLocoAddress: number = 0;
  /**
   * Csak runtime vizuális adat.
   * A blokk alatt fekvő valódi sín elem abszolút forward irányszöge.
   */
  runtimeForwardRotation: number | null = null;
  constructor(x: number, y: number) {
    super(x, y);
    this.layerName = "blocks";
    this.rotationStep = 90;
    this.w = 3;
    this.h = 1;
  }
  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    const previousTransit = this.runtimeTransitLocoAddress;
    const targetAddress = getBlockTargetLocoAddress(this.id);
    if (this.locoAddress <= 0 && targetAddress > 0) this.runtimeTransitLocoAddress = targetAddress;
    try {
      this.drawBlock(ctx, options);
    } finally {
      this.runtimeTransitLocoAddress = previousTransit;
    }
  }

  protected drawBlock(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;
    this.beginDraw(ctx, options);
    ctx.translate(this.centerX, this.centerY);
    ctx.rotate((this.rotation * Math.PI) / 180);
    ctx.translate(-this.centerX, -this.centerY);
    const blockX = this.posLeft + 5;
    const blockY = this.posTop + 10;
    const blockW = this.width - 10;
    const blockH = this.height - 20;

    const hasAssignedLoco =
      this.locoAddress > 0;

    const sensorOccupied =
      this.isSensorAddressOccupied(
        this.sensorAddress
      );

    // A block is physically/operationally occupied when either the Hub
    // runtime already has a locomotive assigned to it or its dedicated
    // occupancy sensor is active.
    const occupied =
      hasAssignedLoco ||
      sensorOccupied;

    // Target-loco/transit coloring remains lower priority than real
    // occupancy. If neither a real loco nor the occupancy sensor marks the
    // block occupied, the existing amber target state is preserved.
    const inTransit =
      !occupied &&
      this.runtimeTransitLocoAddress > 0;

    const bg = occupied
      ? options?.darkMode
        ? "#7f1d1d"
        : "#ffc9c9"
      : inTransit
        ? options?.darkMode
          ? "#8a5a00"
          : "#ffe8a3"
        : options?.darkMode
          ? "#888888"
          : "#f0f0f0";
    const fg = "black";

    // Keep showing the target locomotive while it is heading to this block.
    // If the occupancy sensor turns ON before the Hub moves the runtime loco
    // assignment, the block turns red but the target locomotive stays visible.
    const displayLocoAddress =
      hasAssignedLoco
        ? this.locoAddress
        : this.runtimeTransitLocoAddress;

    const showBlockName = options?.showBlockNames === true && this.name.trim().length > 0;
    const blockNameHeight = showBlockName ? 9 : 0;
    ctx.fillStyle = bg;
    ctx.strokeStyle = fg;
    ctx.lineWidth = 1;
    ctx.fillRect(blockX, blockY, blockW, blockH);
    ctx.strokeRect(blockX, blockY, blockW, blockH);
    if (
      occupied ||
      inTransit
    ) {
      this.drawForwardDirectionTriangle(
        ctx,
        blockX,
        blockY,
        blockW,
        blockH,
        displayLocoAddress,
        inTransit
      );
    }
    const withReadableOverlayAt180 = (drawFn: () => void): void => {
      if (this.rotation === 180) {
        ctx.translate(this.centerX, this.centerY);
        ctx.rotate(Math.PI);
        ctx.translate(-this.centerX, -this.centerY);
      }
      drawFn();
      if (this.rotation === 180) {
        ctx.translate(this.centerX, this.centerY);
        ctx.rotate(-Math.PI);
        ctx.translate(-this.centerX, -this.centerY);
      }
    };
    const drawBlockName = (): void => {
      if (!showBlockName) return;
      ctx.fillStyle = fg;
      ctx.font = "bold 8px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(this.name.trim(), blockX + blockW / 2, blockY + 2);
    };
    if (displayLocoAddress <= 0) {
      withReadableOverlayAt180(() => {
        drawBlockName();
      });
    }
    if (displayLocoAddress > 0) {
      const loco = options?.locos?.find((item) => item.address === displayLocoAddress);
      if (loco?.image) {
        const img = getCanvasImage(loco.image);
        if (img.naturalWidth > 0) {
          const padding = 2;
          const availableImageHeight = blockH - blockNameHeight - padding * 2;
          const maxW = blockW - padding * 2;
          const maxH = Math.max(1, availableImageHeight);
          const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
          const imgW = img.naturalWidth * scale;
          const imgH = img.naturalHeight * scale;
          const contentY = blockY + blockNameHeight;
          const contentH = blockH - blockNameHeight;
          const imgX = blockX + (blockW - imgW) / 2;
          const imgY = contentY + (contentH - imgH) / 2;
          withReadableOverlayAt180(() => {
            drawBlockName();
            ctx.drawImage(img, imgX, imgY, imgW, imgH);
            ctx.fillStyle = fg;
            ctx.font = "8px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("#" + displayLocoAddress.toString(), imgX - 10, contentY + contentH / 2);
          });
        }
      } else {
        withReadableOverlayAt180(() => {
          drawBlockName();
          ctx.fillStyle = fg;
          ctx.font = "8px Arial";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const addressY = blockY + blockNameHeight + (blockH - blockNameHeight) / 2;
          ctx.fillText(displayLocoAddress.toString(), blockX + blockW / 2, addressY);
        });
      }
    }
    this.drawSelection(ctx);
    this.endDraw(ctx);
  }
  private drawForwardDirectionTriangle(
    ctx: CanvasRenderingContext2D,
    blockX: number,
    blockY: number,
    blockW: number,
    blockH: number,
    displayLocoAddress: number,
    inTransit: boolean,
  ): void {
    const movementRuntime =
      getMovementBlockRuntime(
        this.id
      );

    const liveLocoState =
      displayLocoAddress > 0
        ? wsClient.getLatestLocoState(
            displayLocoAddress
          )
        : null;

    /*
     * The live locomotive runtime is authoritative for direction regardless of
     * whether the locomotive is already assigned to this block or is only the
     * target locomotive heading toward it. This is critical for secondary
     * clients: Movement runtime is local to the controller that started the
     * Movement, while locoState is broadcast by the backend to every client.
     */
    const liveDirection =
      liveLocoState?.direction ??
      null;

    const fallbackDirection =
      movementRuntime?.direction ??
      null;

    const direction =
      liveDirection ??
      fallbackDirection;

    if (!direction) {
      return;
    }

    const normalizeRotation = (angle: number): number => {
      const result = angle % 360;
      return result < 0 ? result + 360 : result;
    };

    const baseForwardRotation =
      this.runtimeForwardRotation ??
      this.rotation;

    const effectiveForwardRotation =
      normalizeRotation(
        baseForwardRotation +
        (
          direction ===
            "reverse"
            ? 180
            : 0
        )
      );

    const localForwardRotation =
      normalizeRotation(
        effectiveForwardRotation -
        this.rotation
      );

    const localForwardRad =
      (
        localForwardRotation *
        Math.PI
      ) /
      180;

    const pointsRight =
      Math.cos(
        localForwardRad
      ) >= 0;

    const arrowLength = 6;
    const arrowHalfHeight = 4;
    const centerY = blockY + blockH / 2;
    const edgePadding = 2;

    const points = pointsRight
      ? {
          tipX: blockX + blockW - edgePadding,
          backX: blockX + blockW - edgePadding - arrowLength,
        }
      : {
          tipX: blockX + edgePadding,
          backX: blockX + edgePadding + arrowLength,
        };

    ctx.save();

    ctx.beginPath();
    ctx.moveTo(
      points.tipX,
      centerY
    );
    ctx.lineTo(
      points.backX,
      centerY -
        arrowHalfHeight
    );
    ctx.lineTo(
      points.backX,
      centerY +
        arrowHalfHeight
    );
    ctx.closePath();

    const liveMoving =
      liveLocoState !==
        null
        ? liveLocoState.speed >
          0
        : null;

    const moving =
      liveMoving ??
      (
        movementRuntime?.phase ===
          "moving"
      );

    const blinking =
      moving;

    const blinkOn =
      !blinking ||
      Math.floor(
        Date.now() /
          350
      ) %
        2 ===
      0;

    ctx.globalAlpha =
      blinkOn
        ? 1
        : 0.22;

    if (moving) {
      ctx.fillStyle =
        "#a3e635";

      ctx.strokeStyle =
        "#365314";
    } else if (
      movementRuntime?.phase ===
        "error"
    ) {
      ctx.fillStyle =
        "#ff6b6b";

      ctx.strokeStyle =
        "#7f1d1d";
    } else {
      ctx.fillStyle =
        "#ffd43b";

      ctx.strokeStyle =
        "#5f3d00";
    }

    ctx.fill();
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  override clone(): BlockElement {
    const copy = new BlockElement(this.x, this.y);
    copy.id = generateId();
    copy.name = this.name;
    copy.rotation = this.rotation;
    copy.rotationStep = this.rotationStep;
    copy.selected = this.selected;
    copy.bg = this.bg;
    copy.fg = this.fg;
    copy.address = this.address;
    copy.locoAddress = this.locoAddress;
    copy.length = this.length;
    copy.sensorAddress = this.sensorAddress;
    copy.blockType = this.blockType;
    copy.eventConfig = normalizeBlockEventConfig(this.eventConfig);
    return copy;
  }
  static fromJSON(data: IBlockElement): BlockElement {
    const element = new BlockElement(data.x, data.y);
    element.id = data.id;
    element.name = data.name;
    element.layerName = data.layerName;
    element.rotation = data.rotation;
    element.rotationStep = data.rotationStep;
    element.bg = data.bg;
    element.fg = data.fg;
    element.address = data.address;
    element.length = data.length ?? 100;
    element.sensorAddress = data.sensorAddress ?? 0;
    /**
     * Futáskor majd runtime kezeli,
     * ezért induláskor nem töltjük vissza.
     */
    element.locoAddress = 0;
    element.blockType = data.blockType ?? BLOCK_TYPES.NORMAL;
    element.eventConfig = normalizeBlockEventConfig(data.eventConfig);
    return element;
  }
  override toJSON(): IBlockElement {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.TRACK_BLOCK,
      address: this.address,
      length: this.length,
      // Occupancy belongs to /runtime-state.json, never to the saved layout.
      locoAddress: 0,
      sensorAddress: this.sensorAddress,
      blockType: this.blockType as BlockType,
      eventConfig: normalizeBlockEventConfig(this.eventConfig),
    };
  }
  override getEditableProperties(): IEditableProperty[] {
    return [
      ...super.getEditableProperties(),
      {
        label: i18next.t("ui.blockType"),
        key: "blockType",
        type: "blockTypeSelect",
        readonly: false,
      },
      {
        label: i18next.t("ui.length"),
        key: "length",
        type: "number",
        readonly: false,
        min: 1,
      },
      {
        label: i18next.t("ui.occupancySensorAddress"),
        key: "sensorAddress",
        type: "number",
        readonly: false,
        min: 0,
      },
    ];
  }
  override getHelp(): string {
    return `
      <h3 style="margin-top:0;">
        ${i18n.t("help.block.title")}
      </h3>

      <p>
        ${i18n.t("help.block.description")}
      </p>

      <p>
        ${i18n.t("help.block.occupancyDescription")}
      </p>

      <ul>
        <li>
          <b>${i18n.t("help.block.fields.name.title")}</b>:
          ${i18n.t("help.block.fields.name.description")}
        </li>
        <li>
          <b>${i18n.t("help.block.fields.blockType.title")}</b>:
          ${i18n.t("help.block.fields.blockType.description")}
        </li>
        <li>
          <b>${i18n.t("help.block.fields.length.title")}</b>:
          ${i18n.t("help.block.fields.length.description")}
        </li>
        <li>
          <b>${i18n.t("help.block.fields.sensorAddress.title")}</b>:
          ${i18n.t("help.block.fields.sensorAddress.description")}
        </li>
      </ul>

      <h4>${i18n.t("help.block.types.title")}</h4>

      <ul>
        <li>
          <b>${i18n.t("help.block.types.normal.title")}</b>:
          ${i18n.t("help.block.types.normal.description")}
        </li>
        <li>
          <b>${i18n.t("help.block.types.station.title")}</b>:
          ${i18n.t("help.block.types.station.description")}
        </li>
        <li>
          <b>${i18n.t("help.block.types.terminal.title")}</b>:
          ${i18n.t("help.block.types.terminal.description")}
        </li>
        <li>
          <b>${i18n.t("help.block.types.staging.title")}</b>:
          ${i18n.t("help.block.types.staging.description")}
        </li>
        <li>
          <b>${i18n.t("help.block.types.siding.title")}</b>:
          ${i18n.t("help.block.types.siding.description")}
        </li>
        <li>
          <b>${i18n.t("help.block.types.yard.title")}</b>:
          ${i18n.t("help.block.types.yard.description")}
        </li>
      </ul>
    `;
  }

  override get posLeft(): number {
    return (this.x - 1) * this.GridSizeX;
  }

  override get posRight(): number {
    return (this.x - 1) * this.GridSizeX + this.w * this.GridSizeX;
  }

  override get posTop(): number {
    return this.y * this.GridSizeY;
  }

  override get posBottom(): number {
    return this.y * this.GridSizeY + this.h * this.GridSizeY;
  }

  override get centerX(): number {
    return this.x * this.GridSizeX + this.GridSizeX / 2;
  }

  override get centerY(): number {
    return this.y * this.GridSizeY + this.GridSizeY / 2;
  }
  protected override get hasOccupancySensorProperty(): boolean {
    return false;
  }
}
