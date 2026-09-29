import type {
  MovementPlanLeg,
  MovementPlanResource,
} from "./movementPlan";

function isSafetyResource(
  resource:
    MovementPlanResource,
  sourceNode:
    number | null
): boolean {
  if (
    resource.kind ===
      "turnout"
  ) {
    return true;
  }

  return (
    resource.kind ===
      "segment" &&
    resource.nodeIndex !==
      null &&
    resource.nodeIndex !==
      sourceNode
  );
}

export function movementLegPathSafetySensors(
  leg:
    MovementPlanLeg
): number[] {
  const sourceNode =
    leg.from.nodeIndex;

  const sourceSensor =
    leg.from.sensorAddress;

  const sensors =
    new Set<number>();

  for (
    const resource of
    leg.resources
  ) {
    if (
      !isSafetyResource(
        resource,
        sourceNode
      )
    ) {
      continue;
    }

    for (
      const address of
      resource.detectors
    ) {
      if (
        !Number.isInteger(
          address
        ) ||
        address <= 0 ||
        (
          sourceSensor !==
            null &&
          address ===
            sourceSensor
        )
      ) {
        continue;
      }

      sensors.add(
        address
      );
    }
  }

  return [
    ...sensors,
  ].sort(
    (
      left,
      right
    ) =>
      left -
      right
  );
}

export function movementResourceSafetySensors(
  leg:
    MovementPlanLeg,
  resource:
    MovementPlanResource
): number[] {
  const effective =
    new Set(
      movementLegPathSafetySensors(
        leg
      )
    );

  return resource.detectors
    .filter(
      address =>
        effective.has(
          address
        )
    )
    .sort(
      (
        left,
        right
      ) =>
        left -
        right
    );
}
