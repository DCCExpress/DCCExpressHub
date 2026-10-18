import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = file => readFileSync(path.join(project, file), "utf8");

test("backend blocks an execution unless every routed block has a registered, known occupancy sensor", () => {
  const runtime = read("desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");
  const start = runtime.slice(runtime.indexOf("StartSavedPage("));
  const validation = start.indexOf("foreach (var routeBlock in plan.Blocks.Where(");
  const creation = start.indexOf("var execution =");
  assert.ok(validation >= 0, "missing validation of every routed block");
  assert.ok(creation > validation, "sensor validation must precede execution creation");
  const guard = start.slice(validation, creation);
  assert.match(guard, /_layout\.FindSensor\(sensorAddress\)/);
  assert.match(guard, /_layout\.TryGetSensorState\(sensorAddress, out _\)/);
  assert.match(guard, /sensor #\{sensorAddress\}/);
  assert.match(guard, /UNKNOWN/);
  assert.match(start, /if \(!_layout\.TryGetSensorState\([\s\S]*?!sourceOccupied\)/);
});

test("all Movement start paths use the same backend guard", () => {
  const runtime = read("desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");
  const scheduler = read("desktop/DCCExpressHub.Net/Web/TimetableRuntime.cs");
  const driver = read("desktop/DCCExpressHub.Net/Web/TrainDriverRuntime.cs");
  assert.match(runtime, /return StartSavedPage\([\s\S]*?page,[\s\S]*?false\)/);
  assert.match(runtime, /StartTransient\([\s\S]*?StartSavedPage\(/);
  assert.match(scheduler, /_movement\.Start\(/);
  assert.match(scheduler, /_movement\.StartTransient\(/);
  assert.match(driver, /_movement\.StartTransient\(/);
});

test("rejected interactive starts display a modal, and timetable failures retain their reason", () => {
  const service = read("web-ui/src/services/movementEngine.ts");
  const dialog = read("web-ui/src/components/movement/MovementStartErrorDialog.tsx");
  const root = read("web-ui/src/main.tsx");
  const scheduler = read("desktop/DCCExpressHub.Net/Web/TimetableRuntime.cs");
  assert.match(service, /publishMovementStartRejection\(page, message\)/);
  assert.match(dialog, /subscribeMovementStartRejections/);
  assert.match(dialog, /Movement start blocked/);
  assert.match(root, /<MovementStartErrorDialog\s*\/>/);
  assert.match(scheduler, /Status = "error"/);
  assert.match(scheduler, /Message = result\.Error/);
});
