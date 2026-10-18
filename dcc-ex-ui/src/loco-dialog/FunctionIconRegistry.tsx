import * as TablerIcons from "@tabler/icons-react";
import type { ComponentType } from "react";

// Icon IDs are stable: adding or replacing entries does not alter saved locomotives.
export const BUILTIN_FUNCTION_ICONS = [
  ["light", "Headlight", "IconBulb"],
  ["cab-light", "Cab light", "IconLamp"],
  ["engine", "Engine", "IconEngine"],
  ["train-engine", "Train engine", "IconTrain"],
  ["horn", "Horn", "IconSpeakerphone"],
  ["bell", "Bell", "IconBell"],
  ["sound", "Sound", "IconVolume"],
  ["speaker", "Announcement", "IconMicrophone"],
  ["music", "Music", "IconMusic"],
  ["fan", "Fan", "IconPropeller"],
  ["brake", "Brake", "IconGauge"],
  ["door", "Door", "IconDoor"],
  ["power", "Power", "IconPower"],
  ["pause", "Idle", "IconPlayerPause"],
  ["night", "Night light", "IconMoon"],
  ["steam", "Steam / smoke", "IconWind"],
  ["wiper", "Wiper", "IconWiper"],
  ["aux", "Auxiliary", "IconSettings"],
  ["train", "Train", "IconTrain"],
  ["electric", "Electric", "IconBolt"],
  ["pantograph", "Pantograph", "IconArrowUp"],
] as const;

export type FunctionIconComponent = ComponentType<{ size?: number; color?: string }>;
const iconExports = TablerIcons as unknown as Record<string, FunctionIconComponent | undefined>;
// Avoid silently showing a gear whenever a renamed Tabler icon is unavailable.
const fallback = TablerIcons.IconQuestionMark as FunctionIconComponent;

export function getBuiltinFunctionIcon(value: string): FunctionIconComponent | null {
  const id = value.startsWith("builtin:") ? value.slice(8) : value;
  const entry = BUILTIN_FUNCTION_ICONS.find(item => item[0] === id);
  if (!entry) return null;
  return iconExports[entry[2]] ?? fallback;
}
