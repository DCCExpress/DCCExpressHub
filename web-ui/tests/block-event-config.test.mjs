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

test("blocks persist direction-aware event sensor configuration", () => {
  const dto = read("src/domain/layout/layoutDto.ts");
  const block = read("src/models/editor/elements/BlockElement.ts");

  assert.match(dto, /BlockEventConfigDto/);
  assert.match(dto, /forward:\s*BlockDirectionEventConfigDto/);
  assert.match(dto, /reverse:\s*BlockDirectionEventConfigDto/);
  assert.match(dto, /beforeArrive:\s*BlockEventSensorConditionDto\[\]/);
  assert.match(dto, /afterLeave:\s*BlockEventSensorConditionDto\[\]/);
  assert.match(dto, /eventConfig\?:\s*BlockEventConfigDto/);

  assert.match(block, /eventConfig:\s*BlockEventConfigDto\s*=\s*emptyBlockEventConfig\(\)/);
  assert.match(block, /element\.eventConfig\s*=\s*normalizeBlockEventConfig\(data\.eventConfig\)/);
  assert.match(block, /eventConfig:\s*normalizeBlockEventConfig\(this\.eventConfig\)/);
});

test("Movement uses explicit rules, then directional block events, then occupancy fallback", () => {
  const plan = read("src/services/movementPlan.ts");

  assert.match(plan, /blockEventConditionsFor/);
  assert.match(plan, /direction\s*===\s*"unknown"[\s\S]*return \[\]/);
  assert.match(plan, /"beforeArrive"/);
  assert.match(plan, /"arrived"/);
  assert.match(plan, /"beforeLeave"/);
  assert.match(plan, /"afterLeave"/);

  assert.match(
    plan,
    /explicit\.arrivedWhen\.length[\s\S]*blockEventConditionsFor\([\s\S]*"arrived"[\s\S]*destinationSensor/
  );

  assert.match(
    plan,
    /explicit\.leaveWhen\.length[\s\S]*blockEventConditionsFor\([\s\S]*"afterLeave"[\s\S]*sensors\.get/
  );

  assert.match(plan, /route\.locoDirection/);
});

test("block property editor exposes Forward and Reverse with a directional SVG", () => {
  const page = read("src/LiteLayoutPage.tsx");
  const editor = read("src/layout/property-panel/BlockEventConfigPropertyEditor.tsx");

  assert.match(page, /BlockEventConfigPropertyEditor/);
  assert.match(page, /selectedElement instanceof BlockElement/);

  assert.match(editor, /<svg/);
  assert.match(editor, /FORWARD/);
  assert.match(editor, /REVERSE/);
  assert.match(editor, /BEFORE · LEFT/);
  assert.match(editor, /AFTER · LEFT/);
  assert.match(editor, /Tabs\.Tab value="forward"/);
  assert.match(editor, /Tabs\.Tab value="reverse"/);
});
