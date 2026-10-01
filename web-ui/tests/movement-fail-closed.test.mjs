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
    \`Could not slice \${startMarker}\`
  );

  return source.slice(
    start,
    end
  );
}

test("Movement route authority is fail-closed for unknown runtime state", () => {
  const engine =
    read(
      "src/services/dispatcherExecutionRuntime.ts"
    );

  assert.ok(
    engine.includes(
      "let blockSnapshotKnown ="
    )
  );

  assert.ok(
    engine.includes(
      "sensorStates.clear();"
    )
  );

  assert.ok(
    engine.includes(
      "blockStates = {};"
    )
  );

  assert.ok(
    engine.includes(
      "blockSnapshotKnown =\n        false;"
    )
  );

  assert.ok(
    engine.includes(
      "wsApi.getLayoutRuntimeSnapshot();"
    )
  );

  const targetGuard =
    sliceBetween(
      engine,
      "function blockAvailableForTarget",
      "function reserveBlockTarget"
    );

  assert.ok(
    targetGuard.includes(
      "!blockSnapshotKnown"
    )
  );

  assert.ok(
    targetGuard.includes(
      "if (!state)"
    )
  );

  assert.ok(
    targetGuard.includes(
      "checkOccupancySensor &&"
    )
  );

  assert.ok(
    targetGuard.includes(
      "!==\n      false"
    ),
    "checked target block sensor must be explicitly OFF"
  );

  const targetLegGuard =
    sliceBetween(
      engine,
      "function targetBlockAvailableForLeg",
      "function reserveBlockTarget"
    );

  assert.ok(
    targetLegGuard.includes(
      "movementLegSensorIsChecked("
    ),
    "target occupancy sensor may only be bypassed by an explicit safety override"
  );
});

test("Movement requires every effective path safety detector to be explicitly OFF", () => {
  const engine =
    read(
      "src/services/dispatcherExecutionRuntime.ts"
    );

  const safety =
    read(
      "src/services/movementSafety.ts"
    );

  const guard =
    sliceBetween(
      engine,
      "function aheadPathSensorsAreFree",
      "async function acquireLock"
    );

  assert.ok(
    guard.includes(
      "movementLegEffectivePathSafetySensors("
    ),
    "runtime guard must use the effective safety selector with explicit overrides"
  );

  assert.ok(
    guard.includes(
      "===\n        false"
    ),
    "effective route detector must be explicitly OFF"
  );

  assert.ok(
    safety.includes(
      'resource.kind ===\n      "turnout"'
    )
  );

  assert.ok(
    safety.includes(
      'resource.kind ===\n      "segment"'
    )
  );

  assert.ok(
    safety.includes(
      "resource.nodeIndex !==\n      sourceNode"
    ),
    "source segment must not be rechecked as ahead-path safety"
  );

  assert.ok(
    safety.includes(
      "address ===\n            sourceSensor"
    ),
    "source block occupancy sensor must be excluded from ahead-path safety"
  );

  assert.ok(
    safety.includes(
      "new Set<number>()"
    ),
    "effective safety addresses must be deduplicated"
  );

  const heldReady =
    sliceBetween(
      engine,
      "async function waitForHeldLegReady",
      "async function waitForArrival"
    );

  assert.ok(
    heldReady.includes(
      "aheadPathSensorsAreFree"
    ),
    "speed-up recheck must use the fail-closed path guard"
  );

  const traverse =
    sliceBetween(
      engine,
      "async function traverseLeg",
      "async function executeMovement"
    );

  const recheck =
    traverse.indexOf(
      "await waitForHeldLegReady"
    );

  const speedEnable =
    traverse.indexOf(
      "execution.moving =",
      recheck
    );

  const throttle =
    traverse.indexOf(
      "applyDesiredSpeed(",
      speedEnable
    );

  assert.ok(
    recheck >= 0 &&
    speedEnable > recheck &&
    throttle > speedEnable,
    "held authority must be rechecked immediately before non-zero speed"
  );
});

test("Movement safety selector excludes a duplicated source occupancy detector", () => {
  const safety =
    read(
      "src/services/movementSafety.ts"
    );

  assert.match(
    safety,
    /const sourceSensor =[\s\S]*leg\.from\.sensorAddress/
  );

  assert.match(
    safety,
    /sourceSensor !==[\s\S]*null[\s\S]*address ===[\s\S]*sourceSensor[\s\S]*continue;/
  );
});

test("Movement safety waiting message names blocking sensor addresses and states", () => {
  const engine =
    read(
      "src/services/dispatcherExecutionRuntime.ts"
    );

  assert.match(
    engine,
    /function blockedPathSafetySensorSummary/
  );

  assert.match(
    engine,
    /state ===[\s\S]*true[\s\S]*\? "ON"[\s\S]*: "UNKNOWN"/
  );

  assert.match(
    engine,
    /Waiting for safety: \$\{blockedPathSafetySensorSummary\(/
  );

  assert.doesNotMatch(
    engine,
    /Waiting for route sensors to become safely free/
  );
});

test("Movement forgets stale authority knowledge across WebSocket reconnects", () => {
  const engine =
    read(
      "src/services/dispatcherExecutionRuntime.ts"
    );

  const tracking =
    sliceBetween(
      engine,
      "function installTracking",
      "function delay"
    );

  assert.ok(
    tracking.includes(
      "wsClient.subscribeStatus"
    )
  );

  assert.ok(
    tracking.includes(
      "sensorStates.clear();"
    )
  );

  assert.ok(
    tracking.includes(
      "turnoutStates.clear();"
    )
  );

  assert.ok(
    tracking.includes(
      "blockStates = {};"
    )
  );

  assert.ok(
    tracking.includes(
      "wsApi.getBlocks();"
    )
  );

  assert.ok(
    tracking.includes(
      "wsApi.getLayoutRuntimeSnapshot();"
    )
  );
});

test("ESP32 runtime snapshot never turns unknown sensors into OFF", () => {
  const protocol =
    read(
      "../src/WsProtocol.cpp"
    );

  const direct =
    sliceBetween(
      protocol,
      "void WsProtocol::sendRuntimeSnapshot",
      "void WsProtocol::broadcastRuntimeSnapshot"
    );

  const broadcast =
    sliceBetween(
      protocol,
      "void WsProtocol::broadcastRuntimeSnapshot",
      "void WsProtocol::sendProgrammingResponse"
    );

  for (
    const section of
    [direct, broadcast]
  ) {
    assert.ok(
      section.includes(
        "_runtime.getSensorState("
      )
    );

    assert.ok(
      section.includes(
        "continue;"
      )
    );

    assert.ok(
      section.includes(
        'data["on"] ='
      )
    );

    assert.equal(
      section.includes(
        "sensor.on"
      ),
      false,
      "unknown compatibility sensor state must not be serialized as OFF"
    );
  }
});
