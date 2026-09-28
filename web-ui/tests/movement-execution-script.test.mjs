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
      '"THROTTLE = CURRENT_DESIRED_SPEED"',
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
      "sequence.mode.toUpperCase()",
      "SET DESIRED_SPEED ",
      "FUNCTION F",
      "PULSE FUNCTION F",
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
