import i18next from "i18next";
import { wsApi } from "../../../services/wsApi";
import { wsClient } from "../../../services/wsClient";
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

const lamps = new Set<LampElement>();

export class LampElement extends BaseElement {
  override type: typeof ELEMENT_TYPES.LAMP = ELEMENT_TYPES.LAMP;
  variant: LampVariantDto = "classic";
  outputMode: "accessory" | "extended" = "accessory";
  address = 0;
  activeValue = true;
  offValue = false;
  onAspect = 1;
  offAspect = 0;
  on = false;

  sendConfiguredState(on: boolean): boolean {
    if (!Number.isInteger(this.address) || this.address < 1 || this.address > 2048) return false;
    return this.outputMode === "extended"
      ? wsApi.setSignalAspect(this.address, on ? this.onAspect : this.offAspect)
      : wsApi.setBasicAccessory(this.address, on ? this.activeValue : this.offValue);
  }


  constructor(x: number, y: number) {
    super(x, y);
    this.layerName = "buildings";
    this.rotationStep = 45;
    this.name = "Lamp";
    lamps.add(this);
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
      if (this.on) {
        const halo = ctx.createRadialGradient(x, y, 0, x, y, radius * 5);
        halo.addColorStop(0, "rgba(255,239,158,0.65)");
        halo.addColorStop(0.4, "rgba(255,207,80,0.24)");
        halo.addColorStop(1, "rgba(255,207,80,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, radius * 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#2f3235";
      ctx.beginPath();
      ctx.arc(x, y, radius + 2.2, 0, Math.PI * 2);
      ctx.fill();

      const glow = ctx.createRadialGradient(x - 1, y - 1, 0.5, x, y, radius);
      glow.addColorStop(0, this.on ? "#fff6c8" : "#737779");
      glow.addColorStop(0.45, this.on ? "#f2d378" : "#56595b");
      glow.addColorStop(1, this.on ? "#9d8240" : "#393c3e");
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
      ctx.fillStyle = this.on ? "#fff2a8" : "#707579";
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
      outputMode: this.outputMode,
      address: this.address,
      activeValue: this.activeValue,
      offValue: this.offValue,
      onAspect: this.onAspect,
      offAspect: this.offAspect,
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
    element.outputMode = data.outputMode === "extended" ? "extended" : "accessory";
    element.address = data.address ?? 0;
    element.activeValue = data.activeValue ?? true;
    element.offValue = data.offValue ?? false;
    element.onAspect = data.onAspect ?? 1;
    element.offAspect = data.offAspect ?? 0;
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
    copy.outputMode = this.outputMode;
    copy.address = this.address;
    copy.activeValue = this.activeValue;
    copy.offValue = this.offValue;
    copy.onAspect = this.onAspect;
    copy.offAspect = this.offAspect;
    return copy;
  }

  override getEditableProperties(): IEditableProperty[] {
    return [
      ...super.getEditableProperties(),
      { label: i18next.t("ui.outputType"), key: "outputMode", type: "select", options: [
        { value: "accessory", label: "Basic accessory" },
        { value: "extended", label: "Extended accessory" },
      ] },
      { label: i18next.t("ui.accessoryAddress"), key: "address", type: "number", min: 1, max: 2048 },
      { label: i18next.t("ui.outputStates"), key: "activeValue", type: "bittoggle" },
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

wsClient.on("accessoryChanged", data => {
  for (const lamp of lamps) {
    if (lamp.outputMode !== "accessory" || lamp.address !== data.address) continue;
    if (data.active === lamp.activeValue) lamp.on = true;
    else if (data.active === lamp.offValue) lamp.on = false;
  }
});
wsClient.on("signalAspectChanged", data => {
  for (const lamp of lamps) {
    if (lamp.outputMode !== "extended" || lamp.address !== data.address) continue;
    if (data.aspect === lamp.onAspect) lamp.on = true;
    else if (data.aspect === lamp.offAspect) lamp.on = false;
  }
});
wsClient.on("runtimePhysicalSnapshot", data => {
  for (const lamp of lamps) {
    if (!lamp.address) continue;
    if (lamp.outputMode === "extended") {
      const state = data.extendedAccessories.find(item => item.address === lamp.address);
      if (state) lamp.on = state.aspect === lamp.onAspect;
    } else {
      const state = data.basicAccessories.find(item => item.address === lamp.address);
      if (state) lamp.on = state.active === lamp.activeValue;
    }
  }
});
