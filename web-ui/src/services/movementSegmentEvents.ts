import {
  createMovementId,
  type MovementSegmentEvent,
} from "../domain/movement";

export const MAX_SEGMENT_EVENT_SENSORS =
  8;

function normalizedSensors(
  sensors: number[]
): number[] {
  return [
    ...new Set(
      sensors.filter(
        sensor =>
          Number.isInteger(
            sensor
          ) &&
          sensor > 0 &&
          sensor <= 65535
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

export function segmentEventConditionSignature(
  event:
    Pick<
      MovementSegmentEvent,
      "conditions"
    >
): string {
  return event.conditions
    .slice()
    .sort(
      (
        left,
        right
      ) =>
        left.sensor -
        right.sensor
    )
    .map(
      condition =>
        `${condition.sensor}:${condition.state ? 1 : 0}`
    )
    .join(
      "|"
    );
}

function combinationSignature(
  sensors: number[],
  mask: number
): string {
  return sensors
    .map(
      (
        sensor,
        index
      ) =>
        `${sensor}:${(mask & (1 << index)) !== 0 ? 1 : 0}`
    )
    .join(
      "|"
    );
}

function defaultEventName(
  mask: number
): string {
  if (mask === 0) {
    return "LEAVE";
  }

  if (mask === 1) {
    return "ENTER";
  }

  return "";
}

export function syncMovementSegmentEventMatrix(
  existing:
    MovementSegmentEvent[],
  resourceKey: string,
  rawSensors: number[]
): MovementSegmentEvent[] {
  const sensors =
    normalizedSensors(
      rawSensors
    );

  const otherResources =
    existing.filter(
      event =>
        event.resourceKey !==
        resourceKey
    );

  if (
    sensors.length ===
      0 ||
    sensors.length >
      MAX_SEGMENT_EVENT_SENSORS
  ) {
    return [
      ...otherResources,
      ...existing.filter(
        event =>
          event.resourceKey ===
          resourceKey
      ),
    ];
  }

  const existingBySignature =
    new Map<
      string,
      MovementSegmentEvent
    >();

  for (
    const event of
    existing.filter(
      current =>
        current.resourceKey ===
        resourceKey
    )
  ) {
    existingBySignature.set(
      segmentEventConditionSignature(
        event
      ),
      event
    );
  }

  const rows:
    MovementSegmentEvent[] =
    [];

  const combinations =
    1 << sensors.length;

  for (
    let mask = 0;
    mask < combinations;
    mask += 1
  ) {
    const signature =
      combinationSignature(
        sensors,
        mask
      );

    const previous =
      existingBySignature.get(
        signature
      );

    if (previous) {
      rows.push({
        ...previous,
        resourceKey,
        conditions:
          sensors.map(
            (
              sensor,
              index
            ) => ({
              id:
                previous.conditions.find(
                  condition =>
                    condition.sensor ===
                    sensor
                )?.id ??
                createMovementId(
                  "condition"
                ),
              sensor,
              state:
                (
                  mask &
                  (1 << index)
                ) !==
                0,
            })
          ),
      });

      continue;
    }

    rows.push({
      id:
        createMovementId(
          "segment-event"
        ),
      resourceKey,
      name:
        defaultEventName(
          mask
        ),
      conditions:
        sensors.map(
          (
            sensor,
            index
          ) => ({
            id:
              createMovementId(
                "condition"
              ),
            sensor,
            state:
              (
                mask &
                (1 << index)
              ) !==
              0,
          })
        ),
    });
  }

  return [
    ...otherResources,
    ...rows,
  ];
}

export function segmentEventStateMask(
  sensors: number[],
  readState: (
    sensor: number
  ) => boolean | undefined
): number | null {
  const normalized =
    normalizedSensors(
      sensors
    );

  let mask =
    0;

  for (
    let index = 0;
    index < normalized.length;
    index += 1
  ) {
    const sensor =
      normalized[index]!;

    const state =
      readState(
        sensor
      );

    if (
      state ===
      undefined
    ) {
      return null;
    }

    if (state) {
      mask |=
        1 << index;
    }
  }

  return mask;
}

export function findSegmentEventForMask(
  events:
    MovementSegmentEvent[],
  resourceKey: string,
  sensors: number[],
  mask: number
): MovementSegmentEvent | null {
  const normalized =
    normalizedSensors(
      sensors
    );

  const signature =
    combinationSignature(
      normalized,
      mask
    );

  return events.find(
    event =>
      event.resourceKey ===
        resourceKey &&
      segmentEventConditionSignature(
        event
      ) ===
        signature
  ) ??
  null;
}
