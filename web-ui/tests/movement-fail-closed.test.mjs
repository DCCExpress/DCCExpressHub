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
      "src/services/movementEngine.ts"
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
      "!==\n      false"
    ),
    "target block sensor must be explicitly OFF"
  );
});

test("Movement requires every path detector to be explicitly OFF", () => {
  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  const guard =
    sliceBetween(
      engine,
      "function aheadPathSensorsAreFree",
      "async function acquireLock"
    );

  assert.ok(
    guard.includes(
      '"turnout"'
    )
  );

  assert.ok(
    guard.includes(
      '"segment"'
    )
  );

  assert.ok(
    guard.includes(
      "===\n              false"
    ),
    "route detector must be explicitly OFF"
  );

  assert.equal(
    guard.includes(
      "!==\n              true"
    ),
    false,
    "unknown detector state must never count as free"
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

test("Movement forgets stale authority knowledge across WebSocket reconnects", () => {
  const engine =
    read(
      "src/services/movementEngine.ts"
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
