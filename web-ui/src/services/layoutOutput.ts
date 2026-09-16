import i18next from "i18next";
import type { OutputCommandModeDto } from "@domain/layout/layoutDto";

import { wsApi } from "./wsApi";

export type TurnoutOutputMode = "accessory" | "extended";

export const OUTPUT_COMMAND_MODE_OPTIONS = [
  { value: "accessory", get label() { return i18next.t("ui.dccAccessoryAAddress01"); } },
  { value: "vpin", label: "DCC-EX VPIN · <z ±vpin>" },
] satisfies Array<{ value: OutputCommandModeDto; label: string }>;

export const TURNOUT_OUTPUT_MODE_OPTIONS = [
  { value: "accessory", get label() { return i18next.t("ui.basicAccessoryAAddress01"); } },
  { value: "extended", get label() { return i18next.t("ui.extendedAccessoryAAddressAspect"); } },
] satisfies Array<{ value: TurnoutOutputMode; label: string }>;

export function normalizeOutputCommandMode(value: unknown): OutputCommandModeDto {
  return value === "vpin" ? "vpin" : "accessory";
}

export function normalizeTurnoutOutputMode(value: unknown): TurnoutOutputMode {
  return value === "extended" ? "extended" : "accessory";
}

export function sendBinaryOutput(
  mode: OutputCommandModeDto,
  address: number,
  active: boolean
): boolean {
  if (!Number.isInteger(address) || address <= 0 || address > 32767) return false;
  if (mode === "vpin") return wsApi.setVpin(address, active);
  return wsApi.setBasicAccessory(address, active);
}

export type TurnoutOutputOptions = {
  closedValue?: boolean;
  closedAspect?: number;
  openedAspect?: number;
};

export function sendTurnoutOutput(
  mode: OutputCommandModeDto | TurnoutOutputMode | string,
  address: number,
  physicalValue: boolean,
  options: TurnoutOutputOptions = {}
): boolean {
  if (!Number.isInteger(address) || address <= 0 || address > 2048) return false;

  if (mode === "extended") {
    const closedValue = options.closedValue ?? false;
    const logicalClosed = physicalValue === closedValue;
    const rawAspect = logicalClosed
      ? options.closedAspect ?? 0
      : options.openedAspect ?? 1;
    const aspect = Math.max(0, Math.min(255, Math.trunc(Number(rawAspect))));

    return wsApi.setSignalAspect(address, aspect, physicalValue);
  }

  if (mode === "vpin") return wsApi.setVpin(address, physicalValue);
  return wsApi.setTurnout(address, physicalValue);
}
