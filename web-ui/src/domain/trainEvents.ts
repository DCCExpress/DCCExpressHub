export type TrainEventName =
  // Block lifecycle events.
  | "arrival"
  | "arrived"
  | "afterArrived"
  | "beforeLeave"
  | "starting"
  | "leave"
  | "afterLeave"
  // Physical Movement Vector resource events kept for segment/turnout flows.
  | "approach"
  | "enter";

export type TrainEventResourceType =
  | "block"
  | "segment"
  | "turnout";

export type TrainEventSource =
  | "movement"
  | "dispatcher";

export type TrainEvent = {
  id: string;
  timestamp: number;
  source: TrainEventSource;

  movementId?: string;
  movementName?: string;

  locoId: string | null;
  locoAddress: number;
  locoName: string | null;
  trainType: string | null;
  direction:
    | "forward"
    | "reverse";

  event: TrainEventName;

  resourceType:
    TrainEventResourceType;
  resourceKey: string;
  resourceId:
    string | number | null;
  resourceName: string;
  resourceLabel: string;
  sensorAddress:
    number | null;
  sensors: number[];
};
