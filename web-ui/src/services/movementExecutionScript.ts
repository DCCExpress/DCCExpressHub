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

import {
  movementLegPathSafetySensors,
} from "./movementSafety";

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

function locoTarget(): string {
  return "address=RUNTIME_SOURCE_LOCO direction=ROUTE_DIRECTION";
}

function stopLocoCommand(
  reason: string
): string {
  return (
    "SET_LOCO " +
    locoTarget() +
    " speed=0  // " +
    reason
  );
}

function movingSpeedCommand(
  speed:
    number | string
): string {
  return (
    "SET_LOCO " +
    locoTarget() +
    " speed=" +
    String(
      speed
    )
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
        "; APPLY_LOCO_SPEED -> IF MOVING THEN " +
        movingSpeedCommand(
          action.speed
        ) +
        " ELSE " +
        stopLocoCommand(
          "Movement is not moving"
        )
      );

    case "function":
      return (
        "SET_LOCO_FUNCTION address=RUNTIME_SOURCE_LOCO F" +
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
        "SET_LOCO_FUNCTION address=RUNTIME_SOURCE_LOCO F" +
        String(
          action.functionNumber
        ) +
        " ON; WAIT " +
        String(
          action.pulseMs
        ) +
        "ms; SET_LOCO_FUNCTION address=RUNTIME_SOURCE_LOCO F" +
        String(
          action.functionNumber
        ) +
        " OFF"
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

    if (
      sequence.mode ===
        "background"
    ) {
      lines.push(
        ...indent([
          "START_BACKGROUND SEQUENCE " +
            String(
              index +
                1
            ) +
            " {",
          ...indent(
            sequence.actions.map(
              renderAction
            )
          ),
          "}",
          "MAIN_FLOW CONTINUES IMMEDIATELY",
        ])
      );

      continue;
    }

    lines.push(
      ...indent([
        "RUN_BLOCKING SEQUENCE " +
          String(
            index +
              1
          ) +
          " {",
        ...indent(
          sequence.actions.map(
            renderAction
          )
        ),
        "}",
        "MAIN_FLOW WAITS FOR SEQUENCE",
      ])
    );
  }

  lines.push(
    "}"
  );

  return lines;
}

function renderAuthority(
  leg:
    MovementPlanLeg,
  held:
    boolean
): string[] {
  const sensors =
    movementLegPathSafetySensors(
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
      (
        held
          ? "ON_BLOCKED_HELD_AUTHORITY: "
          : "ON_WAIT_ROUTE_AUTHORITY: "
      ) +
        stopLocoCommand(
          held
            ? "held authority became unsafe"
            : "route authority unavailable"
        ),
    ]),
    "}",
  ];

  return lines;
}

function normalizedTurnoutRequirements(
  leg:
    MovementPlanLeg
): Array<{
  address: number;
  closed: boolean;
}> {
  const byAddress =
    new Map<
      number,
      boolean
    >();

  for (
    const state of
    leg.turnoutStates
  ) {
    if (
      !Number.isInteger(
        state.address
      ) ||
      state.address <
        1 ||
      state.address >
        2048
    ) {
      throw new Error(
        "Movement route contains invalid turnout address: " +
        String(
          state.address
        ) +
        "."
      );
    }

    const existing =
      byAddress.get(
        state.address
      );

    if (
      existing !==
        undefined &&
      existing !==
        state.closed
    ) {
      throw new Error(
        "Movement route contains conflicting turnout state for #" +
        String(
          state.address
        ) +
        "."
      );
    }

    byAddress.set(
      state.address,
      state.closed
    );
  }

  return [
    ...byAddress.entries(),
  ]
    .sort(
      (
        [left],
        [right]
      ) =>
        left -
        right
    )
    .map(
      ([
        address,
        closed,
      ]) => ({
        address,
        closed,
      })
    );
}

function resourceLockNames(
  leg:
    MovementPlanLeg
): string[] {
  const names =
    new Set<string>();

  if (
    leg.from.blockId !==
      null
  ) {
    names.add(
      "dcc-express-dispatcher-block:" +
      String(
        leg.from.blockId
      )
    );
  }

  if (
    leg.to.blockId !==
      null
  ) {
    names.add(
      "dcc-express-dispatcher-block:" +
      String(
        leg.to.blockId
      )
    );
  }

  for (
    const resource of
    leg.resources
  ) {
    if (
      resource.kind ===
        "segment"
    ) {
      names.add(
        "dcc-express-movement-segment:" +
        resource.name
      );
    }
  }

  return [
    ...names,
  ].sort();
}

function renderLegClearance(
  leg:
    MovementPlanLeg
): string[] {
  const locks =
    resourceLockNames(
      leg
    );

  const turnouts =
    normalizedTurnoutRequirements(
      leg
    );

  return [
    "WAIT_LEG_CLEARANCE {",
    ...indent([
      "LOOP UNTIL ACQUIRED {",
      ...indent([
        "REQUIRE ROUTE_AUTHORITY",
        "ON ANY WAIT/LOCK CONFLICT: " +
          stopLocoCommand(
            "route/resource/turnout authority not ready"
          ),
        "TRY_ACQUIRE RESOURCE_LOCKS [",
        ...indent(
          locks.map(
            value =>
              q(
                value
              )
          )
        ),
        "]",
        "RECHECK ROUTE_AUTHORITY",
        ...(
          turnouts.length ===
            0
            ? [
                "TURNOUT_LOCKS = NONE",
              ]
            : [
                "TRY_ACQUIRE TURNOUT_LOCKS [",
                ...indent(
                  turnouts.map(
                    state =>
                      String(
                        state.address
                      )
                  )
                ),
                "]",
                "FOR_EACH TURNOUT_REQUIREMENT {",
                ...indent([
                  "IF CURRENT_STATE != REQUIRED_STATE {",
                  ...indent([
                    stopLocoCommand(
                      "turnout must be changed before movement"
                    ),
                    "SET TURNOUT",
                    "WAIT BACKEND ACK",
                    "WAIT 250ms AFTER A SET WHEN MORE TURNOUT REQUIREMENTS REMAIN",
                  ]),
                  "}",
                ]),
                "}",
              ]
        ),
        "RECHECK ROUTE_AUTHORITY",
        "RESERVE TARGET_BLOCK " +
          q(
            leg.to.name
          ),
        "SUCCESS -> RETURN HELD AUTHORITY",
        "FAILURE -> RELEASE ACQUIRED RESOURCES AND RETRY",
      ]),
      "}",
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

  if (
    leg.departWhen.length >
      0
  ) {
    lines.push(
      ...indent([
        "ON WAIT DEPART_CONDITION: " +
          stopLocoCommand(
            "departure condition is false"
          ),
      ])
    );
  }

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

  if (
    leg.departWhen.length >
      0
  ) {
    lines.push(
      ...indent([
        "ON WAIT RECHECK_DEPART_CONDITION: " +
          stopLocoCommand(
            "departure condition changed while authority is held"
          ),
      ])
    );
  }

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
      "SET MOVING = TRUE",
      "APPLY_LOCO_SPEED -> " +
        movingSpeedCommand(
          "CURRENT_DESIRED_SPEED"
        ) +
        "  // no-op if physical speed already matches",
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
    leg.arrivedWhen.length ===
      0
  ) {
    lines.push(
      ...indent([
        "RUNTIME_ERROR = " +
          q(
            "Block \"" +
            leg.to.name +
            "\" has no arrival condition or occupancy sensor."
          ),
      ])
    );
  }

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
        "SET MOVING = FALSE",
        "SET DESIRED_SPEED = 0",
        stopLocoCommand(
          "final ARRIVED automatic stop"
        ),
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
      ...indent([
        "// Non-final leg: ARRIVED actions run after target commit; movement may still be rolling.",
        ...renderActions(
          page,
          leg.to.key,
          "arrived",
          "ARRIVED_ACTIONS"
        ),
      ])
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
      "INITIAL_DESIRED_SPEED = " +
        String(
          page.speed
        ),
      "ALL SPEED COMMANDS USE ROUTE_DIRECTION = " +
        plan.direction.toUpperCase(),
      "",
      "PRECHECK {",
      ...indent([
        "REQUIRE MOVEMENT ENABLED",
        "REQUIRE TRACK_POWER ON",
        "REQUIRE ACTIVE_CONTROL_STATION",
        "WAIT SOURCE_BLOCK_LOCO_ADDRESS > 0 (timeout 3000ms)",
        "REQUIRE ROUTE_DIRECTION != UNKNOWN",
      ]),
      "}",
      "",
      "ARM_DIRECTION {",
      ...indent([
        "ROUTE_DIRECTION = " +
          plan.direction.toUpperCase(),
        stopLocoCommand(
          "force stopped route direction before departure"
        ),
        "WAIT 150ms",
        "REQUEST LIVE LOCO STATE address=RUNTIME_SOURCE_LOCO",
        "CONFIRM LIVE_LOCO speed=0 direction=ROUTE_DIRECTION (timeout 1200ms)",
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
      "SET DESIRED_SPEED = 0",
      "SET MOVING = FALSE",
      stopLocoCommand(
        "normal Movement completion"
      ),
      ...renderActions(
        page,
        "movement",
        "complete",
        "COMPLETE_ACTIONS"
      ),
      "JOIN ALL STARTED_BACKGROUND SEQUENCES  // Movement completion waits here",
      "",
      "RUNTIME_STOP_PATHS {",
      ...indent([
        "STOP_REQUEST -> SET CANCELLED=TRUE; SET MOVING=FALSE; SET DESIRED_SPEED=0; " +
          stopLocoCommand(
            "user stop/cancel"
          ),
        "RUNTIME_ERROR -> SET MOVING=FALSE; SET DESIRED_SPEED=0; " +
          stopLocoCommand(
            "runtime failure cleanup"
          ),
        "EMERGENCY_ABORT -> STOP_REQUEST plus GLOBAL_EMERGENCY_STOP when requested",
      ]),
      "}",
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
