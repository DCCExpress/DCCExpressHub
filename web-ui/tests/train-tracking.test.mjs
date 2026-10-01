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

test("Automation tabs end with Tracking after Scripts", () => {
  const panel = read("src/components/AutomationPanel.tsx");

  const movement = panel.indexOf('value="movement"');
  const flows = panel.indexOf('value="flows"');
  const scripts = panel.indexOf('value="scripts"');
  const tracking = panel.indexOf('value="tracking"');

  assert.ok(movement >= 0);
  assert.ok(flows > movement);
  assert.ok(scripts > flows);
  assert.ok(tracking > scripts);
  assert.match(panel, /<TrainTrackingPanel/);
});

test("Tracking runtime is Control Station gated and ignores active Movement locos", () => {
  const runtime = read("src/services/trainTrackingRuntime.ts");

  assert.match(runtime, /enabled\s*&&\s*isControlStationRuntimeActive\(\)/);
  assert.match(runtime, /isLocoManagedByActiveMovement/);
  assert.match(runtime, /route\.locoDirection\s*===\s*direction/);
  assert.match(runtime, /routeMatchesTurnouts/);
});

test("Tracking writes block assignment only for one unique candidate", () => {
  const runtime = read("src/services/trainTrackingRuntime.ts");

  assert.match(runtime, /if\s*\(\s*values\.length\s*===\s*0/);
  assert.match(runtime, /if\s*\(\s*values\.length\s*>\s*1/);

  const uniqueStart = runtime.indexOf("const candidate =");
  const setBlock = runtime.indexOf("wsApi.setBlock", uniqueStart);

  assert.ok(uniqueStart >= 0);
  assert.ok(setBlock > uniqueStart);
});

test("Tracking reacts only to a real occupancy OFF to ON transition", () => {
  const runtime = read("src/services/trainTrackingRuntime.ts");

  assert.match(runtime, /previous\s*===\s*undefined/);
  assert.match(runtime, /previous\s*===\s*data\.on/);
  assert.match(runtime, /!data\.on/);
  assert.match(runtime, /blockSensorToId\.get/);
});
