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

test("blocks persist independent Forward and Reverse physical sensor groups", () => {
  const dto = read("src/domain/layout/layoutDto.ts");
  const block = read("src/models/editor/elements/BlockElement.ts");

  assert.match(dto, /BlockEventConfigDto/);
  assert.match(dto, /forward:\s*BlockDirectionEventConfigDto/);
  assert.match(dto, /reverse:\s*BlockDirectionEventConfigDto/);
  assert.match(dto, /arrival:\s*BlockEventSensorConditionDto\[\]/);
  assert.match(dto, /arrived:\s*BlockEventSensorConditionDto\[\]/);
  assert.match(dto, /leave:\s*BlockEventSensorConditionDto\[\]/);
  assert.doesNotMatch(dto, /beforeArrive:\s*BlockEventSensorConditionDto\[\]/);
  assert.doesNotMatch(dto, /beforeLeave:\s*BlockEventSensorConditionDto\[\]/);

  assert.match(block, /candidate\.arrival\s*\?\?\s*candidate\.beforeArrive/);
  assert.match(block, /candidate\.leave\s*\?\?/);
  assert.match(block, /eventConfig:\s*normalizeBlockEventConfig\(this\.eventConfig\)/);
});

test("Movement maps block sensor groups to physical lifecycle boundaries", () => {
  const plan = read("src/services/movementPlan.ts");

  assert.match(plan, /blockEventConditionsFor/);
  assert.match(plan, /"arrival"/);
  assert.match(plan, /"arrived"/);
  assert.match(plan, /"leave"/);
  assert.match(plan, /afterLeaveRuleFor/);
  assert.match(plan, /state:\s*false/);
  assert.match(plan, /route\.locoDirection/);
});

test("block property editor exposes exactly Arrival, Arrived and Leave per direction", () => {
  const page = read("src/LiteLayoutPage.tsx");
  const editor = read("src/layout/property-panel/BlockEventConfigPropertyEditor.tsx");

  assert.match(page, /BlockEventConfigPropertyEditor/);
  assert.match(page, /selectedElement instanceof BlockElement/);

  assert.match(editor, /SENSOR_GROUP_ORDER/);
  assert.match(editor, /"arrival"/);
  assert.match(editor, /"arrived"/);
  assert.match(editor, /"leave"/);
  assert.match(editor, /Tabs\.Tab value="forward"/);
  assert.match(editor, /Tabs\.Tab value="reverse"/);
  assert.match(editor, /<Switch/);
  assert.match(editor, /checked=\{condition\.state\}/);
});
