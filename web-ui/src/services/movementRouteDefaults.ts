import type {
  SerializedLayoutDto,
} from "../domain/layout/layoutDto";

import {
  buildMovementRouteVector,
  type MovementRouteVectorInput,
} from "./movementRouteVector";

export type MovementArrivalDefaultCondition = {
  sensor: number;
  state: boolean;
};

export type MovementIntermediateArrivalDefault = {
  blockId: number;
  conditions:
    MovementArrivalDefaultCondition[];
};

export type MovementRouteDefaultEntry =
  MovementRouteVectorInput;

export function buildMovementIntermediateArrivalDefaults(
  layout:
    SerializedLayoutDto,
  route:
    MovementRouteDefaultEntry
): MovementIntermediateArrivalDefault[] {
  const vector =
    buildMovementRouteVector(
      layout,
      route
    );

  const result:
    MovementIntermediateArrivalDefault[] =
    [];

  for (
    let index = 0;
    index <
      vector.length;
    index += 1
  ) {
    const current =
      vector[
        index
      ];

    if (
      !current ||
      current.kind !==
        "block" ||
      current.role ===
        "source"
    ) {
      continue;
    }

    const conditions:
      MovementArrivalDefaultCondition[] =
      current.sensor ===
        null
        ? []
        : [{
            sensor:
              current.sensor,
            state:
              true,
          }];

    result.push({
      blockId:
        current.blockId,
      conditions,
    });
  }

  return result;
}
