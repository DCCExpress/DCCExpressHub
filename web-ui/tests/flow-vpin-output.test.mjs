import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("VPIN output is available and configurable in visual Flows", () => {
  const domain = read("../src/domain/automationFlow.ts");
  const palette = read("../src/components/automation/AutomationFlowPalette.tsx");
  const properties = read("../src/components/automation/AutomationFlowPropertiesPanel.tsx");
  const node = read("../src/components/automation/AutomationFlowNode.tsx");
  assert.match(domain, /\| "setVpin"/);
  assert.match(palette, /kind: "setVpin"/);
  assert.match(properties, /data.kind === "setVpin"/);
  assert.match(properties, /32767/);
  assert.match(node, /case "setVpin":/);
});

test("Flow script generation calls tracked Script VPIN API", () => {
  const domain = read("../src/domain/automationFlow.ts");
  const flowRuntime = read("../../desktop/DCCExpressHub.Net/Web/FlowRuntime.cs");
  const scriptRuntime = read("../../desktop/DCCExpressHub.Net/Web/ScriptRuntime.cs");
  assert.match(domain, /case "setVpin":[\s\S]*?await dcc\.setVpin\(/);
  assert.match(flowRuntime, /case "setVpin":[\s\S]*?"await dcc\.setVpin\("/);
  assert.match(scriptRuntime, /setVpin: \(address, active\)/);
  assert.match(scriptRuntime, /"__dccSetVpin"/);
  assert.match(scriptRuntime, /_commandCenter\.SetVPinAsync\(/);
  assert.match(scriptRuntime, /_layout\.SetVPin\(pin, active\)/);
});
