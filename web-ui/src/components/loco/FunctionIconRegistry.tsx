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
  ["car-turbine", "Car turbine", "IconCarTurbine"],
  ["keyframes", "Keyframes", "IconKeyframes"],
  ["playstation-square", "PlayStation square", "IconPlaystationSquare"],
  ["playstation-circle", "PlayStation circle", "IconPlaystationCircle"],
  ["playstation-triangle", "PlayStation triangle", "IconPlaystationTriangle"],
  ["playstation-x", "PlayStation X", "IconPlaystationX"],
  ["radioactive", "Radioactive", "IconRadioactive"],
  ["school-bell", "School bell", "IconSchoolBell"],
  ["noise-reduction", "Noise reduction", "IconNoiseReduction"],
  ["road-sign", "Road sign", "IconRoadSign"],
  ["radar", "Radar", "IconRadar"],
  ["badge-vo", "Badge VO", "IconBadgeVo"],
  ["air-conditioning", "Air conditioning", "IconAirConditioning"],
  ["face-mask", "Face mask", "IconFaceMask"],
  ["arrow-autofit-content", "Autofit content", "IconArrowAutofitContent"],
  ["virus", "Virus", "IconVirus"],
  ["car-suspension", "Car suspension", "IconCarSuspension"],
  ["link", "Link", "IconLink"],
  ["plug", "Plug", "IconPlug"],
  ["separator-horizontal", "Horizontal separator", "IconSeparatorHorizontal"],
  ["brand-denodo", "Denodo", "IconBrandDenodo"],
  ["building-bridge-2", "Bridge", "IconBuildingBridge2"],
] as const;

export type FunctionIconComponent = ComponentType<{ size?: number }>;
const iconExports = TablerIcons as unknown as Record<string, FunctionIconComponent | undefined>;
// Avoid silently showing a gear whenever a renamed Tabler icon is unavailable.
const fallback = TablerIcons.IconQuestionMark as FunctionIconComponent;

export function getBuiltinFunctionIcon(value: string): FunctionIconComponent | null {
  const id = value.startsWith("builtin:") ? value.slice(8) : value;
  const entry = BUILTIN_FUNCTION_ICONS.find(item => item[0] === id);
  if (!entry) return null;
  return iconExports[entry[2]] ?? fallback;
}
