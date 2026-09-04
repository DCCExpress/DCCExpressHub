import type {
  BlockType,
  ElementType,
} from "./elementTypes.js";

import type {
  SignalOutputConfiguration,
} from "./signalOutput.js";

/**
 * Stable layout entity identifier.
 *
 * 0 is reserved as "not assigned". Persisted layout entities use 1..65535.
 */
export type LayoutElementId = number;
export const INVALID_LAYOUT_ELEMENT_ID: LayoutElementId = 0;
export const MAX_LAYOUT_ELEMENT_ID: LayoutElementId = 0xffff;

export type RotationStepDto = 0 | 45 | 90;

export type RouteTurnoutItemDto = {
  turnoutId: LayoutElementId;
  closed: boolean;
};

export type SerializedRouteTurnoutItemDto = {
  turnoutId?: LayoutElementId | string;
  closed?: boolean;
};

export type AudioListButtonItemDto = {
  id: string;
  name: string;
  fileName: string;
};

export type LevelCrossingBarrierTypeDto =
  | "none"
  | "half"
  | "full";

export type SensorKindDto = number;

/**
 * Raw JSON shape. Element IDs are allowed to be strings here only so old
 * UUID based layout files can be migrated when they are loaded.
 */
export type SerializedLayoutElementDto = {
  id?: LayoutElementId | string;
  type?: ElementType | string;
  name?: string;
  layerName?: string;

  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
  rotationStep?: RotationStepDto;

  bg?: string;
  fg?: string;

  trackName?: string;
  address?: number;
  length?: number;

  turnoutAddress?: number;
  turnoutClosedValue?: boolean;

  turnout1Address?: number;
  turnout2Address?: number;
  turnout1ClosedValue?: boolean;
  turnout2ClosedValue?: boolean;

  kind?: SensorKindDto;
  colorOn?: string;
  colorOff?: string;
  radius?: number;

  textOn?: string;
  textOff?: string;

  fileName?: string;
  label?: string;
  script?: string;
  audioItems?: AudioListButtonItemDto[];

  basicAccessoryAddress?: number;
  basicAccessoryClosedValue?: boolean;
  barrierType?: LevelCrossingBarrierTypeDto;
  barrierClosed?: boolean;
  lightsEnabled?: boolean;
  blinkingEnabled?: boolean;
  roadColor?: string;

  routeTurnouts?: SerializedRouteTurnoutItemDto[];

  fromBlockId?: LayoutElementId | string;
  toBlockId?: LayoutElementId | string;

  locoAddress?: number;
  sensorAddress?: number;
  blockType?: BlockType | string;

  text?: string;
  fontSize?: number;
  color?: string;
  alignment?: "left" | "center" | "right";
  offsetY?: number;
  offsetX?: number;

  signalOutput?: SignalOutputConfiguration;
  currentStateIndex?: number;

  /** Legacy signal fields. */
  aspect?: number;
  addressLength?: number;
  dispalyAsSingleLamp?: boolean;
  valueGreen?: number;
  valueRed?: number;
  valueYellow?: number;
  valueWhite?: number;

  [key: string]: unknown;
};

export type SerializedLayoutLayerDto = {
  id?: string;
  name?: string;
  visible?: boolean;
  locked?: boolean;
  elements?: SerializedLayoutElementDto[];
};

export type SerializedLayoutDto = {
  gridSize?: number;
  _activeLayerId?: string;
  layers?: SerializedLayoutLayerDto[];
  [key: string]: unknown;
};

export interface BaseElementDto {
  id: LayoutElementId;
  type: ElementType;
  name: string;
  layerName: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  rotationStep: RotationStepDto;
  bg: string;
  fg: string;
}

export interface TrackElementDto extends BaseElementDto {
  address: number;
  length: number;
}

export interface TrackStraightElementDto extends TrackElementDto {
  type: "trackstraight";
}

export interface TrackLevelCrossingElementDto extends TrackElementDto {
  type: "tracklevelcrossing";
  basicAccessoryAddress: number;
  basicAccessoryClosedValue: boolean;
  barrierType: LevelCrossingBarrierTypeDto;
  barrierClosed: boolean;
  lightsEnabled: boolean;
  blinkingEnabled: boolean;
  roadColor: string;
}

export interface TrackDirectionElementDto extends TrackElementDto {
  type: "trackdirection";
}

export interface TrackEndElementDto extends TrackElementDto {
  type: "trackend";
}

export interface TrackCornerElementDto extends TrackElementDto {
  type: "trackcorner";
}

export interface TrackCurveElementDto extends TrackElementDto {
  type: "trackcurve";
}

export interface TrackCrossingElementDto extends TrackElementDto {
  type: "trackcrossing";
}

export type OutputCommandModeDto =
  | "accessory"
  | "vpin";

export type ButtonBehaviorDto =
  | "toggle"
  | "push"
  | "momentary";

export interface TrackTurnoutLeftElementDto extends TrackElementDto {
  type: "trackturnoutleft";
  outputMode?: OutputCommandModeDto;
  turnoutAddress: number;
  turnoutClosedValue: boolean;
}

export interface TrackTurnoutRightElementDto extends TrackElementDto {
  type: "trackturnoutright";
  outputMode?: OutputCommandModeDto;
  turnoutAddress: number;
  turnoutClosedValue: boolean;
}

export interface TrackTurnoutTwoWayElementDto extends TrackElementDto {
  type: "trackturnouttwoway";
}

export interface TrackTurnoutDoubleElementDto extends TrackElementDto {
  type: "trackturnoutdouble";
  outputMode?: OutputCommandModeDto;
  turnout1Address: number;
  turnout2Address: number;
  turnout1ClosedValue: boolean;
  turnout2ClosedValue: boolean;
}

export interface TrackTurnoutThreeWayElementDto extends TrackElementDto {
  type: "trackturnouttreeway";
  turnout1Address: number;
  turnout2Address: number;
}

export interface TrackSensorElementDto extends TrackElementDto {
  type: "tracksensor";
  kind: SensorKindDto;
  colorOn: string;
  colorOff: string;
  address: number;
  radius: number;
}

export interface ButtonElementDto extends BaseElementDto {
  type: "button";
  outputMode?: OutputCommandModeDto;
  behavior?: ButtonBehaviorDto;
  pulseDurationMs?: number;
  colorOn: string;
  colorOff: string;
  textOn: string;
  textOff: string;
  address: number;
  activeValue?: boolean;
}

export interface ButtonScriptElementDto extends BaseElementDto {
  type: "buttonscript";
  colorOn: string;
  colorOff: string;
  textOn: string;
  textOff: string;
  script: string;
}

export interface AudioButtonElementDto extends BaseElementDto {
  type: "audiobutton";
  fileName: string;
  label: string;
}

export interface AudioListButtonElementDto extends BaseElementDto {
  type: "audiolistbutton";
  label: string;
  audioItems: AudioListButtonItemDto[];
}

export interface RouteButtonElementDto extends BaseElementDto {
  type: "routebutton";
  colorOn: string;
  label: string;
  routeTurnouts: RouteTurnoutItemDto[];
}

export interface ExtendedRouteButtonElementDto extends BaseElementDto {
  type: "extendedroutebutton";
  label: string;
  fromBlockId: LayoutElementId;
  toBlockId: LayoutElementId;
}

export interface ClockElementDto extends BaseElementDto {
  type: "clcok";
}

export interface BlockElementDto extends TrackElementDto {
  type: "trackblock";
  length: number;
  locoAddress: number;
  sensorAddress: number;
  blockType: BlockType;
}

export interface TreeElementDto extends BaseElementDto {
  type: "tree";
}

export interface LabelElementDto extends BaseElementDto {
  type: "label";
  text: string;
  fontSize: number;
  color: string;
  alignment: "left" | "center" | "right";
  offsetY: number;
  offsetX: number;
}

/**
 * `tracksignal2` is the generic signal type going forward.
 * `tracksignal3` / `tracksignal4` are accepted only for legacy layout loading.
 */
export interface TrackSignalElementDto extends TrackElementDto {
  type:
    | "tracksignal2"
    | "tracksignal3"
    | "tracksignal4";

  signalOutput?: SignalOutputConfiguration;
  currentStateIndex?: number;

  outputMode?: OutputCommandModeDto;
  aspect?: number;
  address: number;
  addressLength?: number;
  dispalyAsSingleLamp?: boolean;
  valueGreen?: number;
  valueRed?: number;
  valueYellow?: number;
  valueWhite?: number;
}

export type LayoutElementDto =
  | TrackStraightElementDto
  | TrackLevelCrossingElementDto
  | TrackDirectionElementDto
  | TrackEndElementDto
  | TrackCornerElementDto
  | TrackCurveElementDto
  | TrackCrossingElementDto
  | TrackTurnoutLeftElementDto
  | TrackTurnoutRightElementDto
  | TrackTurnoutTwoWayElementDto
  | TrackTurnoutDoubleElementDto
  | TrackTurnoutThreeWayElementDto
  | TrackSensorElementDto
  | ButtonElementDto
  | ButtonScriptElementDto
  | AudioButtonElementDto
  | AudioListButtonElementDto
  | RouteButtonElementDto
  | ExtendedRouteButtonElementDto
  | ClockElementDto
  | BlockElementDto
  | TreeElementDto
  | TrackSignalElementDto
  | LabelElementDto;
