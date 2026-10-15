import * as TablerIcons from "@tabler/icons-react";
import type { ComponentType } from "react";

// Icon IDs are stable: adding or replacing entries does not alter saved locomotives.
export const BUILTIN_FUNCTION_ICONS = [
  ["light", "Headlight", "IconBulb"],
  ["cab-light", "Cab light", "IconLamp"],
  ["engine", "Engine", "IconEngine"],
  ["horn", "Horn", "IconHorn"],
  ["bell", "Bell", "IconBell"],
  ["sound", "Sound", "IconVolume"],
  ["speaker", "Announcement", "IconSpeakerphone"],
  ["music", "Music", "IconMusic"],
  ["fan", "Fan", "IconCarFan"],
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

export type FunctionIconComponent = ComponentType<{ size?: number }>;
const iconExports = TablerIcons as unknown as Record<string, FunctionIconComponent | undefined>;
const fallback = TablerIcons.IconSettings as FunctionIconComponent;

export function getBuiltinFunctionIcon(value: string): FunctionIconComponent | null {
  const id = value.startsWith("builtin:") ? value.slice(8) : value;
  const entry = BUILTIN_FUNCTION_ICONS.find(item => item[0] === id);
  return entry ? (iconExports[entry[2]] ?? fallback) : null;
}
