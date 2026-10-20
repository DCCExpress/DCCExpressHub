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
  assert.match(code, /_movement\.TimetableSourceStatus\(sourceBlockId\.Value\)/);
  assert.match(code, /sourceStatus\.Skip/);
  assert.match(code, /sourceStatus\.LocoAddress > 0/);
  assert.match(code, /if \(IsTimetableNotReadyFailure\(result\.Error\)\)/);
  assert.match(code, /_activeRuns\.Remove\(runId\)/);
});

test("timetable From-To skips empty source before registering or starting", () => {
  const code = body("LaunchFromTo", "LaunchScript");
  const check = code.indexOf("_movement.HasSourceLocomotive(route.FromBlockId)");
  const run = code.indexOf("NewRunId()");
  const start = code.indexOf("_movement.StartTransient(");
  assert.ok(check >= 0 && check < run && run < start,
    "empty source must be skipped BEFORE run creation and StartTransient");
  assert.match(code, /if \(IsTimetableNotReadyFailure\(result\.Error\)\)/);
  assert.match(code, /_activeRuns\.Remove\(runId\)/);
  assert.match(code, /_movement\.TimetableSourceStatus\(route\.FromBlockId\)/);
  assert.match(code, /sourceStatus\.Skip/);
  assert.match(code, /ExpectedLocoAddress = sourceStatus\.LocoAddress/);
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

test("sensor OFF/UNKNOWN and already-managed source cannot create timetable runs", () => {
  const methodStart = movement.indexOf("public (bool Skip, int LocoAddress, string Reason) TimetableSourceStatus(int blockId)");
  const methodEnd = movement.indexOf("bool ConditionsSatisfied(", methodStart);
  assert.ok(methodStart > 0 && methodEnd > methodStart);
  const status = movement.slice(methodStart, methodEnd);
  assert.match(status, /!_layout\.TryGetSensorState\(block\.SensorAddress, out var on\)/);
  assert.match(status, /if \(!on\)/);
  assert.match(status, /IsLocoManaged\(block\.LocoAddress\)/);
  assert.match(status, /"source_block_empty"/);
  assert.match(status, /"source sensor #/);
  assert.match(status, /"locomotive #/);

  assert.match(timetable, /static bool IsTimetableNotReadyFailure\(string\? error\)/);
  assert.match(timetable, /"locomotive_already_managed"/);
  assert.match(timetable, /" is not ON\."/);
  assert.match(timetable, /" is UNKNOWN \(no current feedback\)\."/);
  assert.match(timetable, /void LogSourceSkip\(/);
  assert.match(timetable, /Status = "error"/, "unrelated configuration/safety errors still remain ERROR");
});
