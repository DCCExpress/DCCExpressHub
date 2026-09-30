import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("Flow supports Train Event input nodes with multi-value filters", () => {
  const domain = read("src/domain/automationFlow.ts");
  const palette = read("src/components/automation/AutomationFlowPalette.tsx");
  const props = read("src/components/automation/AutomationFlowPropertiesPanel.tsx");
  const runtime = read("src/components/automation/useAutomationFlowRuntime.ts");

  assert.match(domain, /"trainEventInput"/);
  assert.match(domain, /trainTypeFilters\?: string\[\]/);
  assert.match(domain, /trainEventTypes\?: string\[\]/);
  assert.match(domain, /trainResourceTypes\?: string\[\]/);
  assert.match(palette, /kind: "trainEventInput"/);
  assert.match(props, /MultiSelect[\s\S]*trainTypeFilters/);
  assert.match(runtime, /subscribeTrainEvents/);
  assert.match(runtime, /node\.data\.kind !== "trainEventInput"/);
  assert.match(runtime, /eventTypes\.length > 0/);
  assert.match(runtime, /trainTypes\.length > 0/);
});
