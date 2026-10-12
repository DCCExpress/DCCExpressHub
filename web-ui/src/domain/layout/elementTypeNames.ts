import { ELEMENT_TYPES, type ElementType } from "./elementTypes";

/** Human-readable English labels for every persisted editor element type. */
export const ELEMENT_TYPE_NAMES: Record<ElementType, string> = {
  [ELEMENT_TYPES.GENERAL]: "General",
  [ELEMENT_TYPES.ADDRESSED_ELEMENT]: "Addressed Element",
  [ELEMENT_TYPES.TRACK_STRAIGHT]: "Straight Track",
  [ELEMENT_TYPES.TRACK_BRIDGE]: "Bridge Track",
  [ELEMENT_TYPES.TRACK_DIRECTION]: "Track Direction",
  [ELEMENT_TYPES.TRACK_END]: "Track End",
  [ELEMENT_TYPES.TRACK_CORNER]: "Corner Track",
  [ELEMENT_TYPES.TRACK_CURVE]: "Curve Track",
  [ELEMENT_TYPES.TRACK_CROSSING]: "Track Crossing",
  [ELEMENT_TYPES.TRACK_LEVEL_CROSSING]: "Level Crossing",
  [ELEMENT_TYPES.TRACK_TURNOUT]: "Turnout",
  [ELEMENT_TYPES.TRACK_TURNOUT_LEFT]: "Left Turnout",
  [ELEMENT_TYPES.TRACK_TURNOUT_RIGHT]: "Right Turnout",
  [ELEMENT_TYPES.TRACK_TURNOUT_DOUBLE]: "Double Turnout",
  [ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY]: "Two-Way Turnout",
  [ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY]: "Three-Way Turnout",
  [ELEMENT_TYPES.TRACK_SENSOR]: "Track Sensor",
  [ELEMENT_TYPES.TRACK_SIGNAL]: "Track Signal",
  [ELEMENT_TYPES.TRACK_BLOCK]: "Track Block",
  [ELEMENT_TYPES.BUTTON]: "Button",
  [ELEMENT_TYPES.BUTTON_SCRIPT]: "Script Button",
  [ELEMENT_TYPES.BUTTON_AUDIO]: "Audio Button",
  [ELEMENT_TYPES.BUTTON_AUDIO_LIST]: "Audio List Button",
  [ELEMENT_TYPES.BUTTON_ROUTE]: "Route Button",
  [ELEMENT_TYPES.BUTTON_ROUTE_EXTENDED]: "Extended Route Button",
  [ELEMENT_TYPES.CLOCK]: "Clock",
  [ELEMENT_TYPES.TREE]: "Tree",
  [ELEMENT_TYPES.BUSH]: "Bush",
  [ELEMENT_TYPES.LAMP]: "Lamp",
  [ELEMENT_TYPES.STATION_BUILDING]: "Station Building",
  [ELEMENT_TYPES.SWITCHMAN_HUT]: "Switchman Hut",
  [ELEMENT_TYPES.GARDEN_HOUSE]: "Garden House",
  [ELEMENT_TYPES.LABEL]: "Label",
};

export function getElementTypeName(type: ElementType): string {
  return ELEMENT_TYPE_NAMES[type] ?? type;
}
