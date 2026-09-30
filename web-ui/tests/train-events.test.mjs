import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = relative =>
  fs.readFileSync(path.join(root, relative), "utf8");

test("TrainEvent contract carries train, resource and movement context", () => {
  const source = read("src/domain/trainEvents.ts");

  assert.match(source, /export type TrainEventName/);
  assert.match(source, /locoAddress:\s*number/);
  assert.match(source, /trainType:\s*string \| null/);
  assert.match(source, /resourceType:/);
  assert.match(source, /sensorAddress:/);
  assert.match(source, /sensors:\s*number\[\]/);
  assert.match(source, /source:\s*TrainEventSource/);
});

test("Movement emits semantic TrainEvents instead of deriving train identity from raw sensors", () => {
  const source = read("src/services/movementEngine.ts");

  for (const event of [
    "enter",
    "leave",
    "approach",
    "arrived",
    "beforeDepart",
    "depart",
    "afterLeave",
  ]) {
    assert.match(
      source,
      new RegExp(
        `emitMovementTrainEvent\\([\\s\\S]*?"${event}"`
      )
    );
  }

  assert.match(
    source,
    /configuredLoco:\s*Loco \| null/
  );
  assert.match(
    source,
    /trainType:[\s\S]*execution\.configuredLoco\?\.trainType/
  );
});
