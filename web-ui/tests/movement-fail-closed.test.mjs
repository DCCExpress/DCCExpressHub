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
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/DispatcherRuntime.cs");

  assert.match(
    backend,
    /ValidateSourceBlock/
  );

  assert.match(
    backend,
    /ValidateDestinationBlock/
  );

  const sensors =
    sliceBetween(
      backend,
      "\(bool Ok, ushort\? BlockingSensor\) SensorsFree",
      "bool TryReserveLegResources"
    );

  assert.match(
    sensors,
    /!_runtime\.TryGetSensorState\([\s\S]*\|\| on/
  );

  assert.match(
    backend,
    /destination\.HasRuntimeState/
  );

  assert.match(
    backend,
    /destination_target_lost/
  );
});

test("Movement requires every effective path safety detector to be explicitly OFF", () => {
  const movement =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");
  const dispatcher =
    read("../desktop/DCCExpressHub.Net/Web/DispatcherRuntime.cs");
  const safety =
    read("src/services/movementSafety.ts");

  assert.match(
    movement,
    /EffectiveSafetySensors\([\s\S]*execution\.Page,[\s\S]*leg/
  );

  assert.match(
    dispatcher,
    /!_runtime\.TryGetSensorState\([\s\S]*\|\| on/
  );

  assert.match(safety, /resource\.kind ===[\s\S]*"turnout"/);
  assert.match(safety, /resource\.kind ===[\s\S]*"segment"/);
  assert.match(safety, /sourceSensor/);

  const held =
    sliceBetween(
      movement,
      "async Task WaitForHeldLegReady",
      "async Task TraverseLeg"
    );

  assert.match(
    held,
    /_dispatcher\.ValidateHeldLeg/
  );

  const traverse =
    sliceBetween(
      movement,
      "async Task TraverseLeg",
      "async Task RunExecution"
    );

  const recheck =
    traverse.indexOf("await WaitForHeldLegReady");
  const speedEnable =
    traverse.indexOf("execution.Moving = true", recheck);
  const throttle =
    traverse.indexOf("await ApplySpeed", speedEnable);

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
  const movement =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");

  assert.match(
    movement,
    /Waiting for safety sensor #/
  );

  assert.match(
    movement,
    /BlockingSensor\.HasValue/
  );

  assert.match(
    movement,
    /Waiting for held route safety before departure/
  );
});

test("Movement forgets stale authority knowledge across WebSocket reconnects", () => {
  const engine =
    read("src/services/movementEngine.ts");
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/DispatcherRuntime.cs");

  assert.match(
    engine,
    /wsClient\.subscribeStatus\([\s\S]*"connected"[\s\S]*requestSnapshot\(\)/
  );

  assert.doesNotMatch(
    engine,
    /sensorStates|turnoutStates|blockSnapshotKnown|navigator\.locks/
  );

  assert.match(
    backend,
    /readonly Dictionary<string, DispatcherLegLeaseInfo> _leases/
  );

  assert.match(
    backend,
    /ValidateHeldLeg/
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
