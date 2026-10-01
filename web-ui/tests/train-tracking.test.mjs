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

test("Tracking keeps per-loco block and sensor runtime state", () => {
  const runtime = read("src/services/trainTrackingRuntime.ts");

  assert.match(runtime, /export type LocoTrackingState/);
  assert.match(runtime, /currentBlockId:\s*number \| null/);
  assert.match(runtime, /currentSensors:\s*number\[\]/);
  assert.match(runtime, /lastSensor:\s*number \| null/);
  assert.match(runtime, /recentSensorPath:\s*number\[\]/);
  assert.match(runtime, /confidence:\s*LocoTrackingConfidence/);
});

test("Putting a loco into a block anchors it to the block occupancy sensor", () => {
  const runtime = read("src/services/trainTrackingRuntime.ts");

  assert.match(runtime, /function seedTrackingFromBlocks/);
  assert.match(runtime, /blockIdToSensor\.get/);
  assert.match(runtime, /next\.lastSensor\s*=\s*sensor/);
  assert.match(runtime, /addRecentSensor\s*\(\s*next,\s*sensor/);
});

test("Sensor tracking uses graph, direction and live turnout state", () => {
  const runtime = read("src/services/trainTrackingRuntime.ts");

  assert.match(runtime, /enabled\s*&&\s*ready\s*&&\s*isControlStationRuntimeActive\(\)/);
  assert.match(runtime, /route\.locoDirection\s*===\s*direction/);
  assert.match(runtime, /routeMatchesTurnouts/);
  assert.match(runtime, /routeSensorPath/);
  assert.match(runtime, /candidateForSensor/);
});

test("Ambiguous sensor candidates never move the block assignment", () => {
  const runtime = read("src/services/trainTrackingRuntime.ts");

  const ambiguous = runtime.indexOf("uniqueCandidates.length >");
  const unique = runtime.indexOf("const candidate =", ambiguous);
  const setBlock = runtime.indexOf("wsApi.setBlock", unique);

  assert.ok(ambiguous >= 0);
  assert.ok(unique > ambiguous);
  assert.ok(setBlock > unique);
});

test("Active Movement locos are still sensor-tracked but Tracking does not own their block assignment", () => {
  const runtime = read("src/services/trainTrackingRuntime.ts");

  assert.match(runtime, /isLocoManagedByActiveMovement/);
  assert.match(runtime, /if \(!movementOwned\) \{/);
  assert.match(runtime, /active Movement owns block assignment/);
});

test("Tracking handles both sensor ON and OFF edges", () => {
  const runtime = read("src/services/trainTrackingRuntime.ts");

  assert.match(runtime, /handleSensorOn/);
  assert.match(runtime, /handleSensorOff/);
  assert.match(runtime, /currentSensors\.filter/);
  assert.match(runtime, /previous\s*===\s*data\.on/);
});

test("Tracking exposes reverse lookup from sensor to one locomotive", () => {
  const runtime = read("src/services/trainTrackingRuntime.ts");

  assert.match(runtime, /export function getLocoAtSensor/);
  assert.match(runtime, /state\.currentSensors\.includes/);
  assert.match(runtime, /matches\.length ===\s*1/);
});


test("Tracking requires block sensors but treats section coverage as recommendation", () => {
  const runtime = read("src/services/trainTrackingRuntime.ts");
  const panel = read("src/components/automation/TrainTrackingPanel.tsx");

  assert.match(runtime, /Block .* has no occupancy sensor/);
  assert.match(runtime, /SectionPart .* has no sensor; tracking will be less precise there/);
  assert.doesNotMatch(runtime, /multiple turnout passages without an intermediate block/);
  assert.match(runtime, /readinessWarnings/);
  assert.match(runtime, /ready\s*=\s*readinessIssues\.length ===\s*0/);
  assert.match(runtime, /next\s*&&\s*!ready/);
  assert.match(panel, /!state\.ready/);
  assert.match(panel, /state\.readinessIssues\.map/);
  assert.match(panel, /state\.readinessWarnings\.map/);
});

test("Tracking keeps all currently occupied sensors for a long train", () => {
  const runtime = read("src/services/trainTrackingRuntime.ts");

  assert.match(runtime, /currentSensors:\s*number\[\]/);
  assert.match(runtime, /!state\.currentSensors\.includes\(\s*sensor/);
  assert.match(runtime, /state\.currentSensors\.push\(\s*sensor/);
  assert.match(runtime, /state\.currentSensors\s*=\s*state\.currentSensors\.filter/);
});


test("Tracking recommendations stay collapsed by default", () => {
  const panel = read("src/components/automation/TrainTrackingPanel.tsx");

  assert.match(panel, /<Accordion/);
  assert.match(panel, /<Accordion\.Item value="tracking-recommendations">/);
  assert.match(panel, /<Accordion\.Control>/);
  assert.match(panel, /<Accordion\.Panel>/);
  assert.doesNotMatch(panel, /defaultValue=\{?["']tracking-recommendations/);
});


test("Tracking commits the selected turnout route until the next block", () => {
  const runtime = read("src/services/trainTrackingRuntime.ts");

  assert.match(runtime, /const committedRoutes/);
  assert.match(runtime, /routeMatchesTurnouts/);
  assert.match(runtime, /committedRoutes\.get/);
  assert.match(runtime, /candidateFromRoute/);
  assert.match(runtime, /committedRoutes\.set/);
  assert.match(runtime, /committedRoutes\.delete/);
  assert.match(runtime, /Tracking route committed/);
});

test("Tracking exposes physical SectionParts selected by route and sensors", () => {
  const runtime = read("src/services/trainTrackingRuntime.ts");
  const panel = read("src/components/automation/TrainTrackingPanel.tsx");

  assert.match(runtime, /currentSectionParts:\s*string\[\]/);
  assert.match(runtime, /function sectionPartsForSensors/);
  assert.match(runtime, /part\.detectors/);
  assert.match(panel, /loco\.currentSectionParts/);
});


test("Tracking initializes and updates turnout state from all supported runtime sources", () => {
  const runtime = read("src/services/trainTrackingRuntime.ts");

  assert.match(runtime, /runtimePhysicalSnapshot/);
  assert.match(runtime, /turnoutChanged/);
  assert.match(runtime, /accessoryChanged/);
  assert.match(runtime, /signalAspectChanged/);
  assert.match(runtime, /vpinChanged/);
  assert.match(runtime, /route\.turnoutStates/);
});
