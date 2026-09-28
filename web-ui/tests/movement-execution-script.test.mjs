import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here =
  path.dirname(
    fileURLToPath(
      import.meta.url
    )
  );

const root =
  path.resolve(
    here,
    ".."
  );

function read(relativePath) {
  return fs.readFileSync(
    path.join(
      root,
      relativePath
    ),
    "utf8"
  );
}

function sliceBetween(
  source,
  startMarker,
  endMarker
) {
  const start =
    source.indexOf(
      startMarker
    );

  const end =
    source.indexOf(
      endMarker,
      start
    );

  assert.ok(
    start >= 0 &&
    end > start,
    "Could not slice " +
      startMarker
  );

  return source.slice(
    start,
    end
  );
}

function assertOrder(
  source,
  markers,
  label
) {
  let previous =
    -1;

  for (
    const marker of
    markers
  ) {
    const index =
      source.indexOf(
        marker,
        previous +
          1
      );

    assert.ok(
      index >
        previous,
      label +
        ": expected after previous marker: " +
        marker
    );

    previous =
      index;
  }
}

test("Movement execution script resolves the same persisted plan as runtime", () => {
  const script =
    read(
      "src/services/movementExecutionScript.ts"
    );

  assert.ok(
    script.includes(
      "await loadMovementPlan("
    )
  );

  assert.ok(
    script.includes(
      "page\n    );"
    )
  );

  assert.equal(
    script.includes(
      "layoutOverride"
    ),
    false
  );

  assert.ok(
    script.includes(
      "Runtime startMovement() also calls loadMovementPlan(page)"
    )
  );
});

test("Movement execution script mirrors the core runtime leg order", () => {
  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  const script =
    read(
      "src/services/movementExecutionScript.ts"
    );

  const traverse =
    sliceBetween(
      engine,
      "async function traverseLeg",
      "async function executeMovement"
    );

  assertOrder(
    traverse,
    [
      "await waitForDepartureConditions(",
      "await waitForPreDepartureAvailability(",
      '"beforeDepart"',
      "await waitForLegClearance(",
      "await waitForDepartureConditions(",
      '"depart"',
      "await waitForHeldLegReady(",
      "execution.moving =",
      "applyDesiredSpeed(",
      "await waitForArrival(",
      "await waitForBlockLeave(",
      "wsApi.setBlockRemove(",
      '"afterLeave"',
      "wsApi.setBlock(",
    ],
    "runtime traverseLeg"
  );

  const renderLeg =
    sliceBetween(
      script,
      "function renderLeg(",
      "export function renderMovementExecutionScript"
    );

  assertOrder(
    renderLeg,
    [
      '"WAIT DEPART_CONDITION"',
      "renderAuthority(",
      '"beforeDepart"',
      "renderLegClearance(",
      '"RECHECK DEPART_CONDITION"',
      '"depart"',
      "renderAuthority(",
      '"APPLY_LOCO_SPEED -> "',
      "renderSourceBlockLeaveWatch(",
      '"WAIT ARRIVED"',
      '"WAIT SOURCE_BLOCK_LEAVE_WATCH TO FIRE"',
      '"REMOVE SOURCE_BLOCK_RUNTIME "',
      '"afterLeave"',
      '"COMMIT LOCO TO TARGET_BLOCK "',
    ],
    "execution script renderLeg"
  );
});

test("Movement execution script includes fail-closed route authority", () => {
  const script =
    read(
      "src/services/movementExecutionScript.ts"
    );

  assert.ok(
    script.includes(
      "NEXT_BLOCK RUNTIME_STATE = KNOWN"
    ) ||
    script.includes(
      '" RUNTIME_STATE = KNOWN"'
    )
  );

  assert.ok(
    script.includes(
      "NEXT_BLOCK LOCO = NONE"
    )
  );

  assert.ok(
    script.includes(
      "NEXT_BLOCK FOREIGN_TARGET = NONE"
    )
  );

  assert.ok(
    script.includes(
      "KNOWN_OFF"
    )
  );

  assert.ok(
    script.includes(
      "UNKNOWN sensor/runtime state is BLOCKED"
    )
  );

  assert.ok(
    script.includes(
      "RECHECK_HELD_AUTHORITY"
    )
  );

  assert.ok(
    script.includes(
      "TRY_ACQUIRE RESOURCE_LOCKS"
    )
  );

  assert.ok(
    script.includes(
      "TRY_ACQUIRE TURNOUT_LOCKS"
    )
  );

  assert.ok(
    script.includes(
      "RESERVE TARGET_BLOCK"
    )
  );
});

test("Movement execution script preserves default versus explicit block LEAVE semantics", () => {
  const script =
    read(
      "src/services/movementExecutionScript.ts"
    );

  assert.ok(
    script.includes(
      "leg.leaveWhenExplicit"
    )
  );

  assert.ok(
    script.includes(
      "MODE = EXPLICIT"
    )
  );

  assert.ok(
    script.includes(
      "MODE = DEFAULT_OCCUPANCY_EDGE"
    )
  );

  assert.ok(
    script.includes(
      "MUST_BE_SEEN ON THEN OFF"
    )
  );

  assert.ok(
    script.includes(
      "RUNTIME_RELEASE_FALLBACK"
    )
  );
});

test("Movement execution script preserves action sequence mode and action semantics", () => {
  const script =
    read(
      "src/services/movementExecutionScript.ts"
    );

  for (
    const marker of
    [
      "START_BACKGROUND SEQUENCE ",
      "RUN_BLOCKING SEQUENCE ",
      "MAIN_FLOW CONTINUES IMMEDIATELY",
      "MAIN_FLOW WAITS FOR SEQUENCE",
      "SET DESIRED_SPEED ",
      "SET_LOCO_FUNCTION address=RUNTIME_SOURCE_LOCO F",
      "ON; WAIT ",
      "WAIT_RANDOM ",
      "PLAY_AUDIO ",
      "WAIT_FOR_END",
      "NO_WAIT",
      "LOG ",
    ]
  ) {
    assert.ok(
      script.includes(
        marker
      ),
      marker
    );
  }
});

test("Movement execution script exposes concrete locomotive interventions", () => {
  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  const script =
    read(
      "src/services/movementExecutionScript.ts"
    );

  const physicalSpeed =
    sliceBetween(
      engine,
      "function setPhysicalSpeed",
      "function applyDesiredSpeed"
    );

  assert.ok(
    physicalSpeed.includes(
      "wsApi.setLoco("
    )
  );

  assert.ok(
    physicalSpeed.includes(
      "execution.direction"
    )
  );

  for (
    const marker of
    [
      "address=RUNTIME_SOURCE_LOCO direction=ROUTE_DIRECTION",
      "INITIAL_DESIRED_SPEED = ",
      "ALL SPEED COMMANDS USE ROUTE_DIRECTION = ",
      "force stopped route direction before departure",
      "CONFIRM LIVE_LOCO speed=0 direction=ROUTE_DIRECTION",
      "ON WAIT DEPART_CONDITION:",
      "ON_WAIT_ROUTE_AUTHORITY:",
      "ON ANY WAIT/LOCK CONFLICT:",
      "turnout must be changed before movement",
      "ON_BLOCKED_HELD_AUTHORITY:",
      "SET MOVING = TRUE",
      "APPLY_LOCO_SPEED -> ",
      "final ARRIVED automatic stop",
      "normal Movement completion",
      "STOP_REQUEST -> SET CANCELLED=TRUE",
      "RUNTIME_ERROR -> SET MOVING=FALSE",
      "EMERGENCY_ABORT -> STOP_REQUEST plus GLOBAL_EMERGENCY_STOP",
    ]
  ) {
    assert.ok(
      script.includes(
        marker
      ),
      marker
    );
  }
});

test("Movement script speed/function/horn actions show their physical loco commands", () => {
  const script =
    read(
      "src/services/movementExecutionScript.ts"
    );

  const actionRenderer =
    sliceBetween(
      script,
      "function renderAction(",
      "function renderActions("
    );

  assert.ok(
    actionRenderer.includes(
      "SET DESIRED_SPEED "
    )
  );

  assert.ok(
    actionRenderer.includes(
      "IF MOVING THEN "
    )
  );

  assert.ok(
    actionRenderer.includes(
      "movingSpeedCommand("
    )
  );

  assert.ok(
    actionRenderer.includes(
      "Movement is not moving"
    )
  );

  assert.ok(
    actionRenderer.includes(
      "SET_LOCO_FUNCTION address=RUNTIME_SOURCE_LOCO F"
    )
  );

  assert.ok(
    actionRenderer.includes(
      " ON; WAIT "
    )
  );

  assert.ok(
    actionRenderer.includes(
      " OFF"
    )
  );
});

test("Movement execution script makes background task behavior explicit", () => {
  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  const script =
    read(
      "src/services/movementExecutionScript.ts"
    );

  assert.ok(
    engine.includes(
      'sequence.mode ===\n      "background"'
    )
  );

  assert.ok(
    engine.includes(
      "startBackgroundSequence("
    )
  );

  assert.ok(
    engine.includes(
      "await Promise.allSettled("
    )
  );

  for (
    const marker of
    [
      "START_BACKGROUND SEQUENCE ",
      "MAIN_FLOW CONTINUES IMMEDIATELY",
      "RUN_BLOCKING SEQUENCE ",
      "MAIN_FLOW WAITS FOR SEQUENCE",
      "JOIN ALL STARTED_BACKGROUND SEQUENCES",
    ]
  ) {
    assert.ok(
      script.includes(
        marker
      ),
      marker
    );
  }
});

test("Movement editor exposes a small read-only Script dialog", () => {
  const editor =
    read(
      "src/components/movement/MovementEditorDialog.tsx"
    );

  const dialog =
    read(
      "src/components/movement/MovementExecutionScriptDialog.tsx"
    );

  assert.ok(
    editor.includes(
      "IconCode"
    )
  );

  assert.ok(
    editor.includes(
      ">\n                      Script\n"
    )
  );

  assert.ok(
    editor.includes(
      "<MovementExecutionScriptDialog"
    )
  );

  assert.ok(
    dialog.includes(
      "loadMovementExecutionScript"
    )
  );

  assert.ok(
    dialog.includes(
      "<pre"
    )
  );

  assert.ok(
    dialog.includes(
      "Read-only projection"
    )
  );
});
