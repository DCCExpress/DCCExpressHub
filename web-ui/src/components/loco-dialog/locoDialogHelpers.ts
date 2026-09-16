import i18next from "i18next";
import type { Loco, LocoAction, LocoActionHook, LocoFunction } from "@domain/types";

import { generateId } from "../../helpers";

export type LocoActionType = LocoAction["type"];

export const ACTION_HOOKS: { value: LocoActionHook; label: string; description: string }[] = [
  { value: "beforeStart", get label() { return i18next.t("ui.beforeStart"); }, get description() { return i18next.t("ui.runsBeforeTheTaskStartsTheLoco"); } },
  { value: "afterStart", get label() { return i18next.t("ui.afterStart"); }, get description() { return i18next.t("ui.runsAfterTheLocoStartCommandWasSent"); } },
  { value: "beforeStop", get label() { return i18next.t("ui.beforeStop"); }, get description() { return i18next.t("ui.runsBeforeANormalTaskStop"); } },
  { value: "afterStop", get label() { return i18next.t("ui.afterStop"); }, get description() { return i18next.t("ui.runsAfterTheLocoStopCommandWasSent"); } },
];

export const ACTION_TYPE_OPTIONS: { value: LocoActionType; label: string }[] = [
  { value: "setFunction", get label() { return i18next.t("ui.functionOnOff"); } },
  { value: "momentaryFunction", get label() { return i18next.t("ui.momentaryFunction"); } },
  { value: "playAudio", get label() { return i18next.t("ui.audio"); } },
  { value: "wait", get label() { return i18next.t("ui.wait"); } },
];

export const createEmptyLocoActions = (): Record<LocoActionHook, LocoAction[]> => ({
  beforeStart: [],
  afterStart: [],
  beforeStop: [],
  afterStop: [],
});

export const createEmptyLoco = (): Loco => ({
  id: generateId(),
  name: "",
  address: 3,
  maxSpeed: 100,
  invert: false,
  image: "",
  length: 200,
  trainType: "passenger",
  occupancyDetectionPosition: "forward",
  functions: [],
  actions: createEmptyLocoActions(),
});

export const createDefaultFunction = (nextNumber: number): LocoFunction => ({
  id: generateId(),
  number: nextNumber,
  name: `F${nextNumber}`,
  icon: "💡",
  momentary: false,
});

export const createDefaultAction = (type: LocoActionType = "wait"): LocoAction => {
  switch (type) {
    case "setFunction":
      return { id: generateId(), type, functionNumber: 0, active: true };
    case "momentaryFunction":
      return { id: generateId(), type, functionNumber: 2, ms: 200 };
    case "playAudio":
      return { id: generateId(), type, fileName: "" };
    case "wait":
      return { id: generateId(), type, ms: 500 };
  }
};

export const convertActionType = (action: LocoAction, type: LocoActionType): LocoAction => ({
  ...createDefaultAction(type),
  id: action.id,
});

export const getLocoActions = (loco: Loco, hook: LocoActionHook): LocoAction[] => loco.actions?.[hook] ?? [];

export const getActionSummary = (action: LocoAction): string => {
  switch (action.type) {
    case "setFunction":
      return `F${action.functionNumber} ${action.active ? "ON" : "OFF"}`;
    case "momentaryFunction":
      return `F${action.functionNumber} pulse ${action.ms} ms`;
    case "playAudio":
      return action.fileName ? `Audio ${action.fileName}` : "Audio";
    case "wait":
      return `Wait ${action.ms} ms`;
  }
};

export const moveItem = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  if (item === undefined) return items;
  next.splice(toIndex, 0, item);
  return next;
};
