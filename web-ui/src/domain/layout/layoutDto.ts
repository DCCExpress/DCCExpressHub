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

export type RouteReferenceDto = {
  fromBlockId: LayoutElementId;
  toBlockId: LayoutElementId;
  direction: "forward" | "reverse";
  viaBlockIds: LayoutElementId[];
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
  section?: number;
  travelDirection?: "unknown" | "forward" | "reverse";

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
  generatedRouteRef?: RouteReferenceDto;

  fromBlockId?: LayoutElementId | string;
  toBlockId?: LayoutElementId | string;

  locoAddress?: number;
  sensorAddress?: number;
  blockType?: BlockType | string;
  eventConfig?: BlockEventConfigDto;

  text?: string;
  fontSize?: number;
  color?: string;
  alignment?: "left" | "center" | "right";
  offsetY?: number;
  offsetX?: number;

  size?: number;
  roofColor?: string;
  gardenWidth?: number;
  gardenHeight?: number;

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
  /** Persisted physical segment number. 0 means not assigned / turnout boundary. */
  section?: number;
  /** Persisted travel direction derived from TrackDirection. */
  travelDirection?: "unknown" | "forward" | "reverse";
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

export type ButtonOutputModeDto =
  | "accessory"
  | "extended";

export type ButtonBehaviorDto =
  | "toggle"
  | "push"
  | "momentary";

export type TurnoutOutputModeDto = OutputCommandModeDto | "extended";

export interface TrackTurnoutElementDto extends TrackElementDto {
  outputMode?: TurnoutOutputModeDto;
  turnoutAddress: number;
  turnoutClosedValue: boolean;
  turnoutClosedAspect?: number;
  turnoutOpenedAspect?: number;
}

export interface TrackTurnoutLeftElementDto extends TrackTurnoutElementDto {
  type: "trackturnoutleft";
}

export interface TrackTurnoutRightElementDto extends TrackTurnoutElementDto {
  type: "trackturnoutright";
}

export interface TrackTurnoutTwoWayElementDto extends TrackTurnoutElementDto {
  type: "trackturnouttwoway";
}

export interface TrackTurnoutDoubleElementDto extends TrackElementDto {
  type: "trackturnoutdouble";
  outputMode?: TurnoutOutputModeDto;
  turnout1Address: number;
  turnout2Address: number;
  turnout1ClosedValue: boolean;
  turnout2ClosedValue: boolean;
  turnout1ClosedAspect?: number;
  turnout1OpenedAspect?: number;
  turnout2ClosedAspect?: number;
  turnout2OpenedAspect?: number;
}

export interface TrackTurnoutThreeWayElementDto extends TrackElementDto {
  type: "trackturnouttreeway";
  outputMode?: OutputCommandModeDto;
  turnout1Address: number;
  turnout2Address: number;
  turnout1ClosedValue: boolean;
  turnout2ClosedValue: boolean;
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
  outputMode?: ButtonOutputModeDto;
  behavior?: ButtonBehaviorDto;
  pulseDurationMs?: number;
  colorOn: string;
  colorOff: string;
  textOn: string;
  textOff: string;
  address: number;
  activeValue?: boolean;
  offValue?: boolean;
  onAspect?: number;
  offAspect?: number;
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
  generatedRouteRef?: RouteReferenceDto;
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

export type BlockEventSensorConditionDto = {
  sensor: number;
  state: boolean;
};

export type BlockDirectionEventConfigDto = {
  arrival: BlockEventSensorConditionDto[];
  arrivalDelayMs: number;
  arrived: BlockEventSensorConditionDto[];
  arrivedDelayMs: number;
  leave: BlockEventSensorConditionDto[];
  leaveDelayMs: number;
};

export type BlockEventConfigDto = {
  forward: BlockDirectionEventConfigDto;
  reverse: BlockDirectionEventConfigDto;
};

export interface BlockElementDto extends TrackElementDto {
  type: "trackblock";
  length: number;
  locoAddress: number;
  sensorAddress: number;
  blockType: BlockType;
  eventConfig?: BlockEventConfigDto;
}

export type TreeVariantDto = "round" | "broad" | "conifer";

export interface TreeElementDto extends BaseElementDto {
  type: "tree";
  variant: TreeVariantDto;
  branchCount: number;
}

export type BushVariantDto = "compact" | "wide" | "flowering";

export interface BushElementDto extends BaseElementDto {
  type: "bush";
  variant: BushVariantDto;
  clusterCount: number;
}

export type LampVariantDto = "classic" | "modern" | "double";

export interface LampElementDto extends BaseElementDto {
  type: "lamp";
  variant: LampVariantDto;
}

export type StationBuildingVariantDto = "plain" | "terrace" | "coveredTerrace" | "stairs" | "classic" | "rural" | "modern";

export interface StationBuildingElementDto extends BaseElementDto {
  type: "stationbuilding";
  variant: StationBuildingVariantDto;
  size: number;
  roofColor: string;
}

export interface SwitchmanHutElementDto extends BaseElementDto {
  type: "switchmanhut";
  size: number;
  roofColor: string;
}

export interface GardenHouseElementDto extends BaseElementDto {
  type: "gardenhouse";
  gardenWidth: number;
  gardenHeight: number;
  roofColor: string;
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

export interface TrackSignalElementDto extends TrackElementDto {
  type: "tracksignal2";

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
  | BushElementDto
  | LampElementDto
  | StationBuildingElementDto
  | SwitchmanHutElementDto
  | GardenHouseElementDto
  | TrackSignalElementDto
  | LabelElementDto;
