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

const webUiRoot =
  path.resolve(
    here,
    ".."
  );

function read(relativePath) {
  return fs.readFileSync(
    path.join(
      webUiRoot,
      relativePath
    ),
    "utf8"
  );
}

test("Movement segment events are stable ID based and support custom event WHEN keys", () => {
  const domain =
    read(
      "src/domain/movement.ts"
    );

  assert.match(
    domain,
    /export type MovementSegmentEvent/
  );

  assert.match(
    domain,
    /segmentEvents:\s*MovementSegmentEvent\[\]/
  );

  assert.match(
    domain,
    /\| `event:\$\{string\}`/
  );

  assert.match(
    domain,
    /movementSegmentEventWhen/
  );

  assert.match(
    domain,
    /isMovementWhen[\s\S]*value\.startsWith\([\s\S]*"event:"/
  );
});

test("Segment matrix generator creates the full 2^N state space and keeps stable IDs", () => {
  const source =
    read(
      "src/services/movementSegmentEvents.ts"
    );

  assert.match(
    source,
    /const combinations =\s*1 << sensors\.length/
  );

  assert.match(
    source,
    /existingBySignature/
  );

  assert.match(
    source,
    /if \(mask === 0\)[\s\S]*return "LEAVE"/
  );

  assert.match(
    source,
    /if \(mask === 1\)[\s\S]*return "ENTER"/
  );

  assert.match(
    source,
    /MAX_SEGMENT_EVENT_SENSORS =\s*8/
  );
});

test("Segment editor renders sensor columns, blue checks and an editable event-name column", () => {
  const matrix =
    read(
      "src/components/movement/MovementSegmentEventMatrix.tsx"
    );

  assert.match(
    matrix,
    /Sensor state event matrix/
  );

  assert.match(
    matrix,
    /IconCheck/
  );

  assert.match(
    matrix,
    /color=\{[\s\S]*active[\s\S]*"blue"/
  );

  assert.match(
    matrix,
    /Event name/
  );

  assert.match(
    matrix,
    /TextInput[\s\S]*value=\{[\s\S]*row\.name/
  );
});

test("Route editor regenerates segment matrices from the actual route sensors", () => {
  const source =
    read(
      "src/components/movement/MovementRouteEditor.tsx"
    );

  assert.match(
    source,
    /syncMovementSegmentEventMatrix/
  );

  assert.match(
    source,
    /resource\.kind !==[\s\S]*"segment"/
  );

  assert.match(
    source,
    /resource\.detectors/
  );
});

test("Named segment matrix events become Action tabs without binding actions to the display name", () => {
  const source =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  assert.match(
    source,
    /movementSegmentEventWhen\([\s\S]*event\.id/
  );

  assert.match(
    source,
    /label:[\s\S]*event\.name\.trim\(\)/
  );

  assert.match(
    source,
    /LEGACY ENTER/
  );

  assert.match(
    source,
    /LEGACY LEAVE/
  );
});

test("Movement engine captures sensor vector transitions and fires matrix actions in order", () => {
  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  assert.match(
    engine,
    /captureActiveSegmentStates\([\s\S]*data\.address/
  );

  assert.match(
    engine,
    /pendingSegmentStates\.push/
  );

  assert.match(
    engine,
    /findSegmentEventForMask/
  );

  assert.match(
    engine,
    /movementSegmentEventWhen\([\s\S]*event\.id/
  );

  assert.match(
    engine,
    /activateSegmentStateTracking\([\s\S]*execution,[\s\S]*resource/
  );

  assert.match(
    engine,
    /runActions\([\s\S]*resource\.key,[\s\S]*"enter"/
  );

  assert.match(
    engine,
    /previousSegment\.key[\s\S]*runActions\([\s\S]*previousSegment\.key,[\s\S]*"leave"/
  );
});

test("Duplicate segment event names are rejected at save time", () => {
  const source =
    read(
      "src/components/movement/MovementEditorDialog.tsx"
    );

  assert.match(
    source,
    /duplicateSegmentEventName/
  );

  assert.match(
    source,
    /Event names must be unique inside one segment/
  );
});


test("Timetable scheduler deep-clones segment event matrices", () => {
  const source =
    read(
      "src/services/timetableScheduler.ts"
    );

  assert.match(
    source,
    /segmentEvents:[\s\S]*movement\.segmentEvents\.map/
  );

  assert.match(
    source,
    /event\.conditions\.map/
  );
});
