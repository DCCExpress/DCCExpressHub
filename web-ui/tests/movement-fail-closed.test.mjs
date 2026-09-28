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

test("Movement route authority is fail-closed for unknown runtime state", () => {
  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  assert.match(
    engine,
    /let blockSnapshotKnown =[sS]*false/
  );

  assert.match(
    engine,
    /status ===[sS]*"connected"[sS]*return;[sS]*sensorStates\.clear\(\)[sS]*blockStates = \{\}[sS]*blockSnapshotKnown =[sS]*false/
  );

  assert.match(
    engine,
    /"blockStateChanged"[sS]*blockSnapshotKnown =[sS]*true/
  );

  assert.match(
    engine,
    /function blockAvailableForTarget[sS]*!blockSnapshotKnown[sS]*return false/
  );

  assert.match(
    engine,
    /block\.sensorAddress !==[sS]*null[sS]*sensorStates\.get\([sS]*block\.sensorAddress[sS]*\) !==[sS]*false/
  );

  assert.match(
    engine,
    /if \(!state\) \{[sS]*return false;/
  );

  assert.doesNotMatch(
    engine,
    /sensorStates\.get\([sS]*address[sS]*\) !==[sS]*true/
  );
});

test("Movement requires every known path detector to be explicitly OFF", () => {
  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  const start =
    engine.indexOf(
      "function aheadPathSensorsAreFree"
    );

  const end =
    engine.indexOf(
      "async function acquireLock",
      start
    );

  assert.ok(
    start >= 0 &&
    end > start
  );

  const guard =
    engine.slice(
      start,
      end
    );

  assert.match(
    guard,
    /resource\.kind ===[sS]*"turnout"/
  );

  assert.match(
    guard,
    /resource\.kind ===[sS]*"segment"/
  );

  assert.match(
    guard,
    /sensorStates\.get\([sS]*address[sS]*\) ===[sS]*false/
  );

  assert.doesNotMatch(
    guard,
    /!==[sS]*true/
  );

  assert.match(
    engine,
    /waitForHeldLegReady[sS]*aheadPathSensorsAreFree/
  );

  assert.match(
    engine,
    /execution\.moving =[sS]*true;[sS]*applyDesiredSpeed/
  );
});

test("ESP32 runtime snapshot never turns unknown sensors into OFF", () => {
  const protocol =
    read(
      "../src/WsProtocol.cpp"
    );

  const matches =
    protocol.match(
      /_runtime\.getSensorState\([\s\S]*sensor\.address,[\s\S]*on\)[\s\S]*continue;/g
    ) ??
    [];

  assert.ok(
    matches.length >= 2,
    "both direct and broadcast runtime snapshots must skip unknown sensor states"
  );

  assert.doesNotMatch(
    protocol,
    /data\["on"\][\s\S]*sensor\.on/
  );
});
