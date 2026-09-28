import type {
  MovementAction,
  MovementPage,
  MovementSensorCondition,
  MovementWhen,
} from "../domain/movement";

import {
  loadMovementPlan,
  type MovementPlan,
  type MovementPlanLeg,
  type MovementPlanResource,
} from "./movementPlan";

import {
  effectiveMovementResourceEventRule,
} from "./movementResourceEvents";

type ActionSequence = {
  id: string;
  mode:
    "blocking" |
    "background";
  actions:
    MovementAction[];
};

function q(
  value: string
): string {
  return JSON.stringify(
    value
  );
}

function indent(
  lines: string[],
  level = 1
): string[] {
  const prefix =
    "  ".repeat(
      level
    );

  return lines.map(
    line =>
      line.length >
        0
        ? prefix +
          line
        : ""
  );
}

function sensorState(
  condition:
    MovementSensorCondition
): string {
  return (
    "SENSOR " +
    String(
      condition.sensor
    ) +
    " = " +
    (
      condition.state
        ? "ON"
        : "OFF"
    )
  );
}

function conditionBlock(
  keyword: string,
  conditions:
    MovementSensorCondition[],
  match:
    "all" |
    "any" =
      "all"
): string[] {
  if (
    conditions.length ===
      0
  ) {
    return [
      keyword +
        " NONE",
    ];
  }

  const lines = [
    keyword +
      " " +
      match.toUpperCase() +
      " {",
    ...indent(
      conditions.map(
        sensorState
      )
    ),
    "}",
  ];

  return lines;
}

function actionSequences(
  page:
    MovementPage,
  resourceKey: string,
  when:
    MovementWhen
): ActionSequence[] {
  const matching =
    page.actions.filter(
      action =>
        action.resourceKey ===
          resourceKey &&
        action.when ===
          when
    );

  const result:
    ActionSequence[] = [];

  const byId =
    new Map<
      string,
      ActionSequence
    >();

  for (
    const action of
    matching
  ) {
    let sequence =
      byId.get(
        action.sequenceId
      );

    if (!sequence) {
      sequence = {
        id:
          action.sequenceId,
        mode:
          action.sequenceMode,
        actions: [],
      };

      byId.set(
        action.sequenceId,
        sequence
      );

      result.push(
        sequence
      );
    }

    sequence.actions.push(
      action
    );
  }

  return result;
}

function audioPath(
  value: string
): string {
  const source =
    value.trim();

  if (!source) {
    return "";
  }

  if (
    source.startsWith(
      "/"
    )
  ) {
    return source;
  }

  if (
    source.includes(
      "."
    )
  ) {
    return (
      "/sd/audio/" +
      source
    );
  }

  return (
    "/sd/audio/" +
    source +
    ".mp3"
  );
}

function renderAction(
  action:
    MovementAction
): string {
  switch (
    action.kind
  ) {
    case "speed":
      return (
        "SET DESIRED_SPEED " +
        String(
          action.speed
        ) +
        "  // applied immediately only while moving"
      );

    case "function":
      return (
        "FUNCTION F" +
        String(
          action.functionNumber
        ) +
        " " +
        (
          action.functionActive
            ? "ON"
            : "OFF"
        )
      );

    case "horn":
      return (
        "PULSE FUNCTION F" +
        String(
          action.functionNumber
        ) +
        " FOR " +
        String(
          action.pulseMs
        ) +
        "ms"
      );

    case "delay":
      return (
        "WAIT " +
        String(
          action.delayMs
        ) +
        "ms"
      );

    case "randomDelay":
      return (
        "WAIT_RANDOM " +
        String(
          Math.min(
            action.minDelayMs,
            action.maxDelayMs
          )
        ) +
        ".." +
        String(
          Math.max(
            action.minDelayMs,
            action.maxDelayMs
          )
        ) +
        "ms"
      );

    case "playAudio": {
      const source =
        audioPath(
          action.audioName
        );

      if (!source) {
        return (
          "PLAY_AUDIO SKIPPED  // empty audio name"
        );
      }

      return (
        "PLAY_AUDIO " +
        q(
          source
        ) +
        (
          action.audioWaitForEnd
            ? " WAIT_FOR_END"
            : " NO_WAIT"
        )
      );
    }

    case "log":
      return (
        "LOG " +
        q(
          action.message
        )
      );
  }
}

function renderActions(
  page:
    MovementPage,
  resourceKey: string,
  when:
    MovementWhen,
  label:
    string
): string[] {
  const sequences =
    actionSequences(
      page,
      resourceKey,
      when
    );

  if (
    sequences.length ===
      0
  ) {
    return [
      label +
        " NONE",
    ];
  }

  const lines = [
    label +
      " {",
  ];

  for (
    let index = 0;
    index <
      sequences.length;
    index += 1
  ) {
    const sequence =
      sequences[
        index
      ]!;

    lines.push(
      ...indent([
        "SEQUENCE " +
          String(
            index +
              1
          ) +
          " " +
          sequence.mode.toUpperCase() +
          " {",
        ...indent(
          sequence.actions.map(
            renderAction
          )
        ),
        "}",
      ])
    );
  }

  lines.push(
    "}"
  );

  return lines;
}

function pathDetectorAddresses(
  leg:
    MovementPlanLeg
): number[] {
  const sourceNode =
    leg.from.nodeIndex;

  const result:
    number[] = [];

  for (
    const resource of
    leg.resources
  ) {
    const checked =
      resource.kind ===
        "turnout" ||
      (
        resource.kind ===
          "segment" &&
        resource.nodeIndex !==
          null &&
        resource.nodeIndex !==
          sourceNode
      );

    if (!checked) {
      continue;
    }

    for (
      const address of
      resource.detectors
    ) {
      if (
        !result.includes(
          address
        )
      ) {
        result.push(
          address
        );
      }
    }
  }

  return result;
}

function renderAuthority(
  leg:
    MovementPlanLeg,
  held:
    boolean
): string[] {
  const sensors =
    pathDetectorAddresses(
      leg
    );

  const lines = [
    (
      held
        ? "RECHECK_HELD_AUTHORITY"
        : "WAIT_ROUTE_AUTHORITY"
    ) +
      " {",
    ...indent([
      "NEXT_BLOCK " +
        q(
          leg.to.name
        ) +
        " RUNTIME_STATE = KNOWN",
      "NEXT_BLOCK LOCO = NONE",
      "NEXT_BLOCK FOREIGN_TARGET = NONE",
      leg.to.sensorAddress ===
        null
        ? "NEXT_BLOCK OCCUPANCY_SENSOR = NONE"
        : (
          "NEXT_BLOCK SENSOR " +
          String(
            leg.to.sensorAddress
          ) +
          " = KNOWN_OFF"
        ),
      sensors.length ===
        0
        ? "PATH_SENSORS = NONE"
        : (
          "PATH_SENSORS = KNOWN_OFF [" +
          sensors.join(
            ", "
          ) +
          "]"
        ),
    ]),
    "}",
  ];

  return lines;
}

function renderLegClearance(
  leg:
    MovementPlanLeg
): string[] {
  const resourceLocks = [
    "BLOCK " +
      q(
        leg.from.name
      ),
    "BLOCK " +
      q(
        leg.to.name
      ),
    ...leg.resources
      .filter(
        resource =>
          resource.kind ===
            "segment"
      )
      .map(
        resource =>
          "SEGMENT " +
          q(
            resource.name
          )
      ),
  ];

  const turnoutLines =
    leg.turnoutStates.map(
      state =>
        "TURNOUT " +
        String(
          state.address
        ) +
        " = " +
        (
          state.closed
            ? "CLOSED"
            : "THROWN"
        )
    );

  return [
    "WAIT_LEG_CLEARANCE {",
    ...indent([
      "REQUIRE ROUTE_AUTHORITY",
      "ACQUIRE RESOURCE_LOCKS [",
      ...indent(
        resourceLocks
      ),
      "]",
      "RECHECK ROUTE_AUTHORITY",
      ...(
        turnoutLines.length ===
          0
          ? [
              "TURNOUT_LOCKS = NONE",
            ]
          : [
              "ACQUIRE TURNOUT_LOCKS [",
              ...indent(
                turnoutLines.map(
                  line =>
                    line.split(
                      " = "
                    )[0]!
                )
              ),
              "]",
              "SET_TURNOUTS [",
              ...indent(
                turnoutLines
              ),
              "]",
            ]
      ),
      "RECHECK ROUTE_AUTHORITY",
      "RESERVE TARGET_BLOCK " +
        q(
          leg.to.name
        ),
      "// Any failed check releases acquired resources and retries.",
    ]),
    "}",
  ];
}

function renderResource(
  page:
    MovementPage,
  resource:
    MovementPlanResource
): string[] {
  if (
    resource.kind ===
      "block"
  ) {
    return [];
  }

  const entryEvent =
    resource.kind ===
      "turnout"
      ? "approach"
      : "enter";

  const entryRule =
    effectiveMovementResourceEventRule(
      page.resourceEventRules,
      resource,
      entryEvent
    );

  const leaveRule =
    effectiveMovementResourceEventRule(
      page.resourceEventRules,
      resource,
      "leave"
    );

  const label =
    resource.kind.toUpperCase() +
    " " +
    q(
      resource.name
    );

  const lines = [
    "RESOURCE " +
      label +
      " {",
  ];

  if (
    entryRule.conditions.length ===
      0
  ) {
    lines.push(
      ...indent([
        "ENTRY IMMEDIATE  // no detector rule",
      ])
    );
  } else {
    lines.push(
      ...indent(
        conditionBlock(
          "WAIT " +
            entryEvent.toUpperCase(),
          entryRule.conditions,
          entryRule.match
        )
      )
    );
  }

  lines.push(
    ...indent(
      renderActions(
        page,
        resource.key,
        entryEvent,
        "ON " +
          entryEvent.toUpperCase()
      )
    )
  );

  if (
    leaveRule.conditions.length ===
      0
  ) {
    lines.push(
      ...indent([
        "LEAVE = LEGACY_RESOURCE_BOUNDARY_FALLBACK",
      ])
    );
  } else {
    lines.push(
      ...indent(
        conditionBlock(
          "ARM LEAVE",
          leaveRule.conditions,
          leaveRule.match
        )
      )
    );

    lines.push(
      ...indent([
        "ON LEAVE WHEN CONDITION BECOMES TRUE",
      ])
    );
  }

  lines.push(
    ...indent(
      renderActions(
        page,
        resource.key,
        "leave",
        "LEAVE_ACTIONS"
      )
    )
  );

  lines.push(
    "}"
  );

  return lines;
}

function renderBlockApproach(
  page:
    MovementPage,
  leg:
    MovementPlanLeg
): string[] {
  if (
    leg.approachWhen.length >
      0
  ) {
    return [
      ...conditionBlock(
        "BLOCK_APPROACH",
        leg.approachWhen,
        "all"
      ),
      ...renderActions(
        page,
        leg.to.key,
        "approach",
        "ON BLOCK_APPROACH"
      ),
    ];
  }

  const segments =
    leg.resources.filter(
      resource =>
        resource.kind ===
          "segment"
    );

  return [
    segments.length >
      0
      ? (
        "BLOCK_APPROACH = ENTER LAST_SEGMENT " +
        q(
          segments[
            segments.length -
              1
          ]!.name
        )
      )
      : "BLOCK_APPROACH = IMMEDIATELY_AFTER_THROTTLE",
    ...renderActions(
      page,
      leg.to.key,
      "approach",
      "ON BLOCK_APPROACH"
    ),
  ];
}

function renderSourceBlockLeaveWatch(
  page:
    MovementPage,
  leg:
    MovementPlanLeg
): string[] {
  if (
    leg.leaveWhen.length ===
      0
  ) {
    return [
      "SOURCE_BLOCK_LEAVE_WATCH = NONE",
      "// LEAVE actions will run at runtime-release fallback after arrival.",
    ];
  }

  const lines = [
    "WATCH SOURCE_BLOCK_LEAVE {",
  ];

  if (
    leg.leaveWhenExplicit
  ) {
    lines.push(
      ...indent([
        "MODE = EXPLICIT",
        ...conditionBlock(
          "TRIGGER",
          leg.leaveWhen,
          "all"
        ),
      ])
    );
  } else {
    const sensor =
      leg.from.sensorAddress;

    lines.push(
      ...indent([
        "MODE = DEFAULT_OCCUPANCY_EDGE",
        sensor ===
          null
          ? "ERROR SOURCE_BLOCK_SENSOR = NONE"
          : (
            "SENSOR " +
            String(
              sensor
            ) +
            " MUST_BE_SEEN ON THEN OFF"
          ),
      ])
    );
  }

  lines.push(
    ...indent([
      ...renderActions(
        page,
        leg.from.key,
        "leave",
        "ON SOURCE_BLOCK_LEAVE"
      ),
      "// Evaluated while waiting for resources/arrival and again at the post-arrival leave barrier.",
    ])
  );

  lines.push(
    "}"
  );

  return lines;
}

function renderLeg(
  page:
    MovementPage,
  plan:
    MovementPlan,
  leg:
    MovementPlanLeg
): string[] {
  const isFinal =
    plan.legs[
      plan.legs.length -
        1
    ] ===
    leg;

  const lines = [
    "LEG " +
      String(
        leg.index +
          1
      ) +
      " " +
      q(
        leg.from.name
      ) +
      " -> " +
      q(
        leg.to.name
      ) +
      " {",
  ];

  lines.push(
    ...indent(
      conditionBlock(
        "WAIT DEPART_CONDITION",
        leg.departWhen,
        "all"
      )
    )
  );

  lines.push(
    ...indent(
      renderAuthority(
        leg,
        false
      )
    )
  );

  lines.push(
    ...indent(
      renderActions(
        page,
        leg.from.key,
        "beforeDepart",
        "BEFORE_DEPART_ACTIONS"
      )
    )
  );

  lines.push(
    ...indent(
      renderLegClearance(
        leg
      )
    )
  );

  lines.push(
    ...indent(
      conditionBlock(
        "RECHECK DEPART_CONDITION",
        leg.departWhen,
        "all"
      )
    )
  );

  lines.push(
    ...indent(
      renderActions(
        page,
        leg.from.key,
        "depart",
        "DEPART_ACTIONS"
      )
    )
  );

  lines.push(
    ...indent(
      renderAuthority(
        leg,
        true
      )
    )
  );

  lines.push(
    ...indent([
      "THROTTLE = CURRENT_DESIRED_SPEED",
      "",
      ...renderBlockApproach(
        page,
        leg
      ),
      "",
      ...renderSourceBlockLeaveWatch(
        page,
        leg
      ),
    ])
  );

  for (
    const resource of
    leg.resources
  ) {
    const resourceLines =
      renderResource(
        page,
        resource
      );

    if (
      resourceLines.length >
        0
    ) {
      lines.push(
        "",
        ...indent(
          resourceLines
        )
      );
    }
  }

  lines.push(
    "",
    ...indent(
      conditionBlock(
        "WAIT ARRIVED",
        leg.arrivedWhen,
        "all"
      )
    )
  );

  if (
    isFinal
  ) {
    lines.push(
      ...indent([
        "// Final leg: blocking ARRIVED actions run while the locomotive may still be moving.",
        ...renderActions(
          page,
          leg.to.key,
          "arrived",
          "ARRIVED_ACTIONS"
        ),
        "STOP LOCO",
      ])
    );
  }

  lines.push(
    ...indent([
      leg.leaveWhen.length ===
        0
        ? "SOURCE_BLOCK_LEAVE_BARRIER = SKIPPED"
        : "WAIT SOURCE_BLOCK_LEAVE_WATCH TO FIRE",
      "REMOVE SOURCE_BLOCK_RUNTIME " +
        q(
          leg.from.name
        ),
    ])
  );

  if (
    leg.leaveWhen.length ===
      0
  ) {
    lines.push(
      ...indent([
        "RUN SOURCE_BLOCK_LEAVE RUNTIME_RELEASE_FALLBACK",
        ...renderActions(
          page,
          leg.from.key,
          "leave",
          "ON SOURCE_BLOCK_LEAVE"
        ),
      ])
    );
  }

  lines.push(
    ...indent(
      renderActions(
        page,
        leg.from.key,
        "afterLeave",
        "AFTER_LEAVE_ACTIONS"
      )
    )
  );

  lines.push(
    ...indent([
      "COMMIT LOCO TO TARGET_BLOCK " +
        q(
          leg.to.name
        ),
    ])
  );

  if (!isFinal) {
    lines.push(
      ...indent(
        renderActions(
          page,
          leg.to.key,
          "arrived",
          "ARRIVED_ACTIONS"
        )
      )
    );
  }

  lines.push(
    ...indent([
      "RELEASE LEG LOCKS",
    ])
  );

  lines.push(
    "}"
  );

  return lines;
}

export function renderMovementExecutionScript(
  page:
    MovementPage,
  plan:
    MovementPlan
): string {
  const source =
    plan.blocks[0];

  const lines = [
    "// READ-ONLY EXECUTION PROJECTION",
    "// Built from the same resolved MovementPlan used by movementEngine.",
    "// UNKNOWN sensor/runtime state is BLOCKED by the runtime safety guards.",
    "",
    "MOVEMENT " +
      q(
        page.name
      ) +
      " {",
    ...indent([
      "ENABLED = " +
        (
          page.enabled
            ? "TRUE"
            : "FALSE"
        ),
      "CRUISE_SPEED = " +
        String(
          page.speed
        ),
      "DIRECTION = " +
        plan.direction.toUpperCase(),
      "LOCO = RUNTIME_LOCO_FROM_SOURCE_BLOCK " +
        q(
          source?.name ??
          "?"
        ),
      "",
      "PRECHECK {",
      ...indent([
        "REQUIRE MOVEMENT ENABLED",
        "REQUIRE TRACK_POWER ON",
        "REQUIRE ACTIVE_CONTROL_STATION",
        "REQUIRE SOURCE_BLOCK_LOCO_ADDRESS > 0",
        "REQUIRE ROUTE_DIRECTION != UNKNOWN",
      ]),
      "}",
      "",
      "ARM_DIRECTION {",
      ...indent([
        "SEND SPEED 0 WITH ROUTE_DIRECTION",
        "WAIT 150ms",
        "REQUEST LIVE LOCO STATE",
        "CONFIRM SPEED 0 AND DIRECTION (timeout 1200ms)",
      ]),
      "}",
      "",
      ...renderActions(
        page,
        "movement",
        "start",
        "START_ACTIONS"
      ),
    ]),
  ];

  for (
    const leg of
    plan.legs
  ) {
    lines.push(
      "",
      ...indent(
        renderLeg(
          page,
          plan,
          leg
        )
      )
    );
  }

  lines.push(
    "",
    ...indent([
      "DRAIN READY RESOURCE LEAVES",
      "STOP LOCO",
      ...renderActions(
        page,
        "movement",
        "complete",
        "COMPLETE_ACTIONS"
      ),
      "WAIT ALL BACKGROUND SEQUENCES",
    ]),
    "}",
  );

  return lines.join(
    "\n"
  );
}

export async function loadMovementExecutionScript(
  page:
    MovementPage
): Promise<string> {
  /*
   * Deliberately do NOT pass an editor layout override here.
   * Runtime startMovement() also calls loadMovementPlan(page) with the
   * persisted backend layout, so this dialog resolves the same route topology
   * that execution will use.
   */
  const plan =
    await loadMovementPlan(
      page
    );

  return renderMovementExecutionScript(
    page,
    plan
  );
}
