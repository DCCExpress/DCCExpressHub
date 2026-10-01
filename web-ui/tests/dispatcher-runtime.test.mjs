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

test("Dispatcher requires active Tracking and one loco in the source block", () => {
  const dispatcher = read("src/services/dispatcherRuntime.ts");

  assert.match(dispatcher, /getTrainTrackingState/);
  assert.match(dispatcher, /!tracking\.active/);
  assert.match(dispatcher, /loco\.currentBlockId ===\s*page\.fromBlockId/);
  assert.match(dispatcher, /sourceLocos\.length ===\s*0/);
  assert.match(dispatcher, /sourceLocos\.length >\s*1/);
});

test("Legacy Movement engine is only a compatibility executor behind Dispatcher", () => {
  const dispatcher = read("src/services/dispatcherRuntime.ts");

  assert.match(dispatcher, /Compatibility executor/);
  assert.match(dispatcher, /await startMovement\(\s*page/);
});
