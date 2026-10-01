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

test("Dispatcher is the public movement execution boundary", () => {
  const controls = read("src/components/movement/MovementRuntimeControls.tsx");
  const cards = read("src/components/movement/MovementPagesTable.tsx");
  const timetable = read("src/services/timetableScheduler.ts");

  assert.match(controls, /services\/dispatcherRuntime/);
  assert.match(cards, /services\/dispatcherRuntime/);
  assert.match(timetable, /services\/dispatcherRuntime/);

  assert.doesNotMatch(controls, /services\/movementEngine/);
  assert.doesNotMatch(cards, /services\/movementEngine/);
  assert.doesNotMatch(timetable, /services\/movementEngine/);
});

test("Dispatcher requires active Tracking and one loco on the requested route", () => {
  const dispatcher = read("src/services/dispatcherRuntime.ts");

  assert.match(dispatcher, /getTrainTrackingState/);
  assert.match(dispatcher, /!tracking\.active/);
  assert.match(dispatcher, /requested\.includes\(\s*loco\.currentBlockId/);
  assert.match(dispatcher, /routeLocos\.length ===\s*0/);
  assert.match(dispatcher, /routeLocos\.length >\s*1/);
});

test("Legacy Movement engine is only a compatibility executor behind Dispatcher", () => {
  const dispatcher = read("src/services/dispatcherRuntime.ts");

  assert.match(dispatcher, /Compatibility executor/);
  assert.match(dispatcher, /await startMovement\(\s*executionPage/);
});


test("Dispatcher has a visible Automation tab", () => {
  const panel = read("src/components/AutomationPanel.tsx");
  const dispatcherPanel = read("src/components/automation/DispatcherPanel.tsx");

  const movement = panel.indexOf('value="movement"');
  const dispatcher = panel.indexOf('value="dispatcher"');
  const flows = panel.indexOf('value="flows"');

  assert.ok(movement >= 0);
  assert.ok(dispatcher > movement);
  assert.ok(flows > dispatcher);
  assert.match(panel, /<DispatcherPanel/);
  assert.match(dispatcherPanel, /subscribeDispatcherRuntime/);
  assert.match(dispatcherPanel, /Current block/);
  assert.match(dispatcherPanel, /Next block/);
  assert.match(dispatcherPanel, /Dispatcher log/);
});


test("Dispatcher resumes from an intermediate tracked block", () => {
  const dispatcher = read("src/services/dispatcherRuntime.ts");

  assert.match(dispatcher, /function remainingMovementPage/);
  assert.match(dispatcher, /requested\.slice\(\s*currentIndex/);
  assert.match(dispatcher, /routeKey:\s*""/);
  assert.match(dispatcher, /fromBlockId:\s*remaining\[0\]/);
  assert.match(dispatcher, /viaBlockIds:\s*remaining\.slice\(\s*1,\s*-1/);
  assert.match(dispatcher, /toBlockId:/);
  assert.match(dispatcher, /Resuming/);
  assert.match(dispatcher, /already completed/);
});
