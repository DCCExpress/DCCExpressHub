import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webUiRoot = path.resolve(here, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(webUiRoot, relativePath), "utf8");
}

test("TrainEvent exposes the complete block lifecycle", () => {
  const events = read("src/domain/trainEvents.ts");

  for (const name of [
    "arrival",
    "arrived",
    "afterArrived",
    "beforeLeave",
    "starting",
    "leave",
    "afterLeave",
  ]) {
    assert.match(events, new RegExp("\\| \"" + name + "\""));
  }
});

test("Movement release never directly resumes locomotive speed", () => {
  const engine = read("src/services/movementEngine.ts");

  assert.match(engine, /export function holdMovement/);
  assert.match(engine, /export function releaseMovement/);
  assert.match(engine, /externalHolds/);
  assert.match(engine, /waitForExternalHolds/);

  const releaseStart = engine.indexOf("export function releaseMovement");
  const releaseEnd = engine.indexOf("export function getMovementHoldOwners", releaseStart);
  const releaseBody = engine.slice(releaseStart, releaseEnd);

  assert.doesNotMatch(releaseBody, /applyDesiredSpeed/);
  assert.doesNotMatch(releaseBody, /setPhysicalSpeed/);
});

test("Flow can hold and release the Movement from TrainEvent payload", () => {
  const flow = read("src/domain/automationFlow.ts");
  const worker = read("src/services/clientScriptWorker.ts");
  const runner = read("src/services/clientScriptRunner.ts");

  assert.match(flow, /"movementHold"/);
  assert.match(flow, /"movementRelease"/);
  assert.match(flow, /payload\.movementId/);
  assert.match(worker, /movement\.hold/);
  assert.match(worker, /movement\.release/);
  assert.match(runner, /holdMovement/);
  assert.match(runner, /releaseMovement/);
  assert.match(runner, /releaseMovementHoldsOwnedByExecution/);
});
