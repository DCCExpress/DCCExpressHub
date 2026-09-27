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

    const previous =
      vector[
        index -
          1
      ];

    const next =
      vector[
        index +
          1
      ];

    const conditions:
      MovementArrivalDefaultCondition[] =
      [];

    const seen =
      new Set<number>();

    if (
      previous?.sensor !==
        null &&
      previous?.sensor !==
        undefined &&
      previous.sensor !==
        current.sensor
    ) {
      seen.add(
        previous.sensor
      );

      conditions.push({
        sensor:
          previous.sensor,
        state:
          false,
      });
    }

    if (
      current.sensor !==
        null
    ) {
      seen.add(
        current.sensor
      );

      conditions.push({
        sensor:
          current.sensor,
        state:
          true,
      });
    }

    if (
      next?.sensor !==
        null &&
      next?.sensor !==
        undefined &&
      next.sensor !==
        current.sensor &&
      !seen.has(
        next.sensor
      )
    ) {
      conditions.push({
        sensor:
          next.sensor,
        state:
          false,
      });
    }

    result.push({
      blockId:
        current.blockId,
      conditions,
    });
  }

  return result;
}
