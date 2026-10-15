import { IconBell, IconBulb, IconCarFan, IconDoor, IconEngine, IconGauge, IconHorn, IconLamp, IconMoon, IconMusic, IconPlayerPause, IconPower, IconSettings, IconSpeakerphone, IconTrain, IconVolume, IconWind, IconWiper, IconBolt, IconArrowUp } from "@tabler/icons-react";
import type { ComponentType } from "react";

export const BUILTIN_FUNCTION_ICONS = [
  ["light", "Headlight", IconBulb], ["cab-light", "Cab light", IconLamp],
  ["engine", "Engine", IconEngine], ["horn", "Horn", IconHorn],
  ["bell", "Bell", IconBell], ["sound", "Sound", IconVolume],
  ["speaker", "Announcement", IconSpeakerphone], ["music", "Music", IconMusic],
  ["fan", "Fan", IconCarFan], ["brake", "Brake", IconGauge],
  ["door", "Door", IconDoor], ["power", "Power", IconPower],
  ["pause", "Idle", IconPlayerPause], ["night", "Night light", IconMoon],
  ["steam", "Steam / smoke", IconWind], ["wiper", "Wiper", IconWiper],
  ["aux", "Auxiliary", IconSettings], ["train", "Train", IconTrain],
  ["electric", "Electric", IconBolt], ["pantograph", "Pantograph", IconArrowUp],
] as const;
export type FunctionIconComponent = ComponentType<{size?: number}>;
export function getBuiltinFunctionIcon(value: string): FunctionIconComponent | null {
  const id = value.startsWith("builtin:") ? value.slice(8) : value;
  return (BUILTIN_FUNCTION_ICONS.find(entry => entry[0] === id)?.[2] ?? null) as FunctionIconComponent | null;
}
