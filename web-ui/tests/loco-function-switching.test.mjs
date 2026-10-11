import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("locomotive selection restores F0–F28 from the selected DCC address only", () => {
  const panel = read("src/layout/LocoPanel.tsx");
  assert.match(panel, /const currentLocoAddress = currentLoco\?\.address \?\? null/);
  assert.match(panel, /currentAddressRef\.current = currentLocoAddress/);
  assert.match(panel, /clearRuntimeState\(\);[\s\S]*?wsClient\.getLatestLocoState\(currentLocoAddress\)/);
  assert.match(panel, /setActiveFunctions\(functionsMaskToRecord\(cached\.functionsMask \?\? 0\)\)/);
  assert.match(panel, /wsApi\.getLoco\(currentLocoAddress\)/);
  assert.match(panel, /\[currentLocoAddress, clearRuntimeState\]/);
});

test("function button grid remounts on locomotive changes and includes F28", () => {
  const panel = read("src/layout/LocoPanel.tsx");
  const grid = read("src/layout/loco-panel/LocoFunctionGrid.tsx");
  assert.match(panel, /<LocoFunctionGrid\s+key=\{currentLoco\.id\}/);
  assert.match(grid, /\{ length: 29 \}/);
  assert.match(grid, /loco\.functions\.find\(/);
  assert.match(grid, /activeFunctions\[index\]/);
});

test("Windows getLoco responds with matching cached function mask before device polling", () => {
  const hub = read("../desktop/DCCExpressHub.Net/Web/WsHub.cs");
  const block = hub.match(/case "getLoco":([\s\S]*?)case "setLocoFunction":/)?.[1];
  assert.ok(block);
  assert.match(block, /HubState\.Locos\.TryGetValue\(address, out var cached\)/);
  assert.match(block, /await Send\(ws, "locoState"/);
  assert.match(block, /functionsMask = cached\.FunctionsMask/);
  assert.match(block, /await CommandCenter\.RequestLocoAsync\(address, ct\)/);
});
