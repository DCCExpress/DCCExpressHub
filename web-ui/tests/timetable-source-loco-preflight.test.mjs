import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const timetable = read("desktop/DCCExpressHub.Net/Web/TimetableRuntime.cs");
const movement = read("desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");

const body = (name, next) => {
  const start = timetable.indexOf("    void " + name + "(");
  const end = timetable.indexOf("    void " + next + "(", start + 1);
  assert.ok(start >= 0 && end > start, "method bounds: " + name);
  return timetable.slice(start, end);
};

test("timetable checks source occupancy before creating a saved Movement run", () => {
  const code = body("LaunchMovement", "LaunchFromTo");
  const check = code.indexOf("_movement.HasSourceLocomotive(sourceBlockId.Value)");
  const run = code.indexOf("NewRunId()");
  const start = code.indexOf("_movement.Start(");
  assert.ok(check >= 0 && check < run && run < start,
    "empty source must be skipped BEFORE run creation and Movement.Start");
  assert.match(code, /sourceBlockId is > 0/);
  assert.match(code, /if \(result\.Error == "movement_source_loco_missing"\)/);
  assert.match(code, /_activeRuns\.Remove\(runId\)/);
});

test("timetable From-To skips empty source before registering or starting", () => {
  const code = body("LaunchFromTo", "LaunchScript");
  const check = code.indexOf("_movement.HasSourceLocomotive(route.FromBlockId)");
  const run = code.indexOf("NewRunId()");
  const start = code.indexOf("_movement.StartTransient(");
  assert.ok(check >= 0 && check < run && run < start,
    "empty source must be skipped BEFORE run creation and StartTransient");
  assert.match(code, /if \(result\.Error == "movement_source_loco_missing"\)/);
  assert.match(code, /_activeRuns\.Remove\(runId\)/);
  assert.match(code, /Status = "error"/, "other genuine safety failures remain errors");
});

test("source preflight is based on the real block locomotive, never target or prediction", () => {
  const start = movement.indexOf("public bool HasSourceLocomotive(int blockId)");
  const end = movement.indexOf("bool ConditionsSatisfied(", start);
  assert.ok(start >= 0 && end > start);
  const code = movement.slice(start, end);
  assert.match(code, /Block\(blockId\)/);
  assert.match(code, /block\.LocoAddress > 0/);
  assert.doesNotMatch(code, /TargetLocoAddress|runtimeTransit|prediction/i);
  assert.match(movement, /return \(false, "movement_source_loco_missing"\)/,
    "the authoritative Movement start-time safety check remains intact");
});
