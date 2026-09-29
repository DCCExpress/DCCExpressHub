import type {
  MovementPage,
} from "../domain/movement";

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

export function movementLegSafetySensors(
  leg:
    MovementPlanLeg
): number[] {
  const sensors =
    new Set(
      movementLegPathSafetySensors(
        leg
      )
    );

  const targetSensor =
    leg.to.sensorAddress;

  if (
    targetSensor !==
      null &&
    Number.isInteger(
      targetSensor
    ) &&
    targetSensor >
      0
  ) {
    sensors.add(
      targetSensor
    );
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


function movementSafetyRuleKey(
  leg:
    MovementPlanLeg
): string | null {
  if (
    leg.from.blockId ===
      null ||
    leg.to.blockId ===
      null
  ) {
    return null;
  }

  return `${leg.from.blockId}->${leg.to.blockId}`;
}

export function movementLegIgnoredSafetySensors(
  page:
    MovementPage,
  leg:
    MovementPlanLeg
): number[] {
  const key =
    movementSafetyRuleKey(
      leg
    );

  if (key === null) {
    return [];
  }

  const rule =
    page.safetyRules.find(
      candidate =>
        `${candidate.fromBlockId}->${candidate.toBlockId}` ===
          key
    );

  return (
    rule?.ignoredSensors ??
    []
  )
    .filter(
      address =>
        Number.isInteger(
          address
        ) &&
        address >
          0
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

export function movementLegSensorIsChecked(
  page:
    MovementPage,
  leg:
    MovementPlanLeg,
  address:
    number
): boolean {
  return !movementLegIgnoredSafetySensors(
    page,
    leg
  ).includes(
    address
  );
}

export function movementLegEffectivePathSafetySensors(
  page:
    MovementPage,
  leg:
    MovementPlanLeg
): number[] {
  const ignored =
    new Set(
      movementLegIgnoredSafetySensors(
        page,
        leg
      )
    );

  return movementLegPathSafetySensors(
    leg
  ).filter(
    address =>
      !ignored.has(
        address
      )
  );
}

export function movementLegEffectiveSafetySensors(
  page:
    MovementPage,
  leg:
    MovementPlanLeg
): number[] {
  const ignored =
    new Set(
      movementLegIgnoredSafetySensors(
        page,
        leg
      )
    );

  return movementLegSafetySensors(
    leg
  ).filter(
    address =>
      !ignored.has(
        address
      )
  );
}
