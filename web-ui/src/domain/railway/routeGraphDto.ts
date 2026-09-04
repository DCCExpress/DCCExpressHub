import type { LayoutElementId } from "../layout/layoutDto.js";
import type {
  SectionBlock,
  SectionDetector,
  SectionSignal,
  TurnoutStateRequirement,
} from "./graph.js";
import type { TravelDirection } from "./topology.js";

export type RouteGraphTrackRuntimeDto = {
  id: LayoutElementId;
  section: number;
  travelDirection: TravelDirection;
};

export type RouteGraphNodeDto = {
  name: string;
  trackName: string;
  x: number;
  y: number;
  isVirtual: boolean;
  busy: boolean;
  detectors: SectionDetector[];
  signals: SectionSignal[];
  blocks: SectionBlock[];
  elementIds: LayoutElementId[];
};

export type RouteGraphEdgeDto = {
  from: string;
  to: string;
  turnoutStates: TurnoutStateRequirement[];
  locoDirection: TravelDirection;
};

export type RouteGraphDto = {
  ready: true;
  nodes: RouteGraphNodeDto[];
  edges: RouteGraphEdgeDto[];
  trackRuntime: RouteGraphTrackRuntimeDto[];
};

export type RouteGraphNotReadyDto = { ready: false };
export type RouteGraphResponseDto = RouteGraphDto | RouteGraphNotReadyDto;
