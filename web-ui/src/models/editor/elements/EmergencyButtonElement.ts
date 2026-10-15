import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import type { BaseElementDto } from "@domain/layout/layoutDto";
import { generateId } from "../../../helpers";
import { wsApi } from "../../../services/wsApi";
import { BaseElement } from "../core/BaseElement";
import type { DrawOptions } from "../types/EditorTypes";
import type { IEditableProperty } from "./PropertyDescriptor";

export type EmergencyButtonElementDto = BaseElementDto & { type: typeof ELEMENT_TYPES.BUTTON_EMERGENCY };

/** Layout-mounted global emergency stop, inspired by the original DCCExpress button. */
export class EmergencyButtonElement extends BaseElement {
  override type: typeof ELEMENT_TYPES.BUTTON_EMERGENCY = ELEMENT_TYPES.BUTTON_EMERGENCY;
  static emergencyActive = false;

  constructor(x: number, y: number) {
    super(x, y);
    this.layerName = "buttons";
    this.name = "Emergency Stop";
    this.w = 2;
    this.h = 2;
  }

  get size(): string { return String(this.w); }
  set size(value: string) {
    const size = Number(value);
    if (size === 1 || size === 2) {
      this.w = size;
      this.h = size;
    }
  }

  override getEditableProperties(): IEditableProperty[] {
    return [
      ...super.getEditableProperties().filter(property => property.key !== "w" && property.key !== "h"),
      { key: "size", label: "Size", type: "select", options: [
        { value: "1", label: "1 × 1" },
        { value: "2", label: "2 × 2" },
      ] },
    ];
  }

  press(): void {
    wsApi.emergencyStop();
  }

  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    if (!this.visible) return;
    this.beginDraw(ctx, options);
    const x = this.posLeft, y = this.posTop;
    const w = this.width, h = this.height;
    const active = EmergencyButtonElement.emergencyActive;
    const radius = Math.max(2, Math.min(w, h) * 0.08);
    ctx.fillStyle = "#ffd600";
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, w - 2, h - 2, radius);
    ctx.fill();
    ctx.stroke();
    const r = Math.max(3, Math.min(w, h) * 0.39);
    ctx.save();
    if (!active) {
      ctx.shadowColor = "#111";
      ctx.shadowBlur = 5;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
    }
    // Reuse the canvas 225 ms animation heartbeat; blink only the red button face.
    ctx.fillStyle = active && Math.floor(Date.now() / 450) % 2 === 0 ? "#d90000" : "#ff5266";
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "white";
    ctx.font = `bold ${Math.max(8, Math.min(w * 0.23, h * 0.21))}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("STOP", x + w / 2, y + h / 2, w * 0.8);
    this.endDraw(ctx);
    super.drawSelection(ctx);
  }

  override toJSON(): EmergencyButtonElementDto {
    return { ...super.toJSON(), type: ELEMENT_TYPES.BUTTON_EMERGENCY };
  }

  static fromJSON(data: EmergencyButtonElementDto): EmergencyButtonElement {
    const e = new EmergencyButtonElement(data.x, data.y);
    e.id = data.id;
    e.name = data.name;
    e.size = String(data.w === 1 ? 1 : 2);
    e.rotation = data.rotation;
    return e;
  }

  override clone(): EmergencyButtonElement {
    const e = new EmergencyButtonElement(this.x, this.y);
    e.id = generateId();
    e.name = this.name;
    e.size = this.size;
    e.rotation = this.rotation;
    return e;
  }

  override getHelp(): string {
    return "<h3>Emergency Stop</h3><p>Press in runtime mode to send a global emergency stop command. The button reflects the command center's reported emergency state.</p>";
  }
}
