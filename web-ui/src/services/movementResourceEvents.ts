import {
  createMovementId,
  type MovementConditionMatch,
  type MovementResourceEventName,
  type MovementResourceEventRule,
  type MovementSensorCondition,
} from "../domain/movement";

import type {
  MovementPlanResource,
} from "./movementPlan";

function uniqueSensors(
  resource:
    MovementPlanResource
): number[] {
  return [
    ...new Set(
      resource.detectors.filter(
        address =>
          Number.isInteger(
            address
          ) &&
          address > 0
      )
    ),
  ].sort(
    (
      left,
      right
    ) =>
      left - right
  );
}

export function resourceEventNames(
  resource:
    MovementPlanResource
): MovementResourceEventName[] {
  if (
    resource.kind ===
      "segment"
  ) {
    return [
      "enter",
      "leave",
    ];
  }

  if (
    resource.kind ===
      "turnout"
  ) {
    return [
      "approach",
      "leave",
    ];
  }

  return [];
}

export function defaultMovementResourceEventRule(
  resource:
    MovementPlanResource,
  event:
    MovementResourceEventName
): MovementResourceEventRule {
  const sensors =
    uniqueSensors(
      resource
    );

  const active =
    event !==
    "leave";

  const match:
    MovementConditionMatch =
    event ===
      "leave"
      ? "all"
      : "any";

  return {
    resourceKey:
      resource.key,
    event,
    match,
    conditions:
      sensors.map(
        sensor => ({
          id:
            `default-${resource.key}-${event}-${sensor}`,
          sensor,
          state:
            active,
        })
      ),
  };
}

export function effectiveMovementResourceEventRule(
  rules:
    MovementResourceEventRule[],
  resource:
    MovementPlanResource,
  event:
    MovementResourceEventName
): MovementResourceEventRule {
  const explicit =
    rules.find(
      rule =>
        rule.resourceKey ===
          resource.key &&
        rule.event ===
          event
    );

  if (explicit) {
    return {
      ...explicit,
      conditions:
        explicit.conditions.map(
          condition => ({
            ...condition,
          })
        ),
    };
  }

  return defaultMovementResourceEventRule(
    resource,
    event
  );
}

export function materializeMovementResourceEventRule(
  rule:
    MovementResourceEventRule
): MovementResourceEventRule {
  return {
    ...rule,
    conditions:
      rule.conditions.map(
        condition => ({
          ...condition,
          id:
            condition.id.startsWith(
              "default-"
            )
              ? createMovementId(
                  "condition"
                )
              : condition.id,
        })
      ),
  };
}

export function movementResourceRuleSatisfied(
  rule:
    MovementResourceEventRule,
  readState: (
    sensor: number
  ) => boolean | undefined
): boolean {
  if (
    rule.conditions.length ===
    0
  ) {
    return false;
  }

  const matches =
    (
      condition:
        MovementSensorCondition
    ): boolean =>
      readState(
        condition.sensor
      ) ===
      condition.state;

  return rule.match ===
    "any"
    ? rule.conditions.some(
        matches
      )
    : rule.conditions.every(
        matches
      );
}
