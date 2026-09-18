import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const output = read("src/domain/layout/signalOutput.ts");
assert.match(output, /createDefaultSignalOutputConfiguration\(\s*address = 0,/s);
assert.match(output, /address:\s*Math\.max\(0,\s*Math\.trunc\(address\)\)/s);

const editor = read("src/layout/property-panel/SignalAspectPropertyEditor.tsx");
assert.match(editor, /signal\.signalOutput\.address <= 0/);
assert.match(editor, /Configure the signal output before creating automation\./);
assert.match(editor, /Output not configured/);

const maintenance = read("src/api/signalLogicMaintenance.ts");
assert.match(maintenance, /deleteSignalAutomationById/);
assert.match(maintenance, /rawContainsSignalId/);
assert.match(maintenance, /still present after cleanup/);
assert.match(maintenance, /deleteAutomationReference/);
assert.match(maintenance, /still referenced after cleanup/);

const integrity = read("src/components/IntegrityCheckDialog.tsx");
assert.match(integrity, /deleteSignalAutomationById/);
assert.match(integrity, /deleteAutomationReference/);
assert.match(integrity, /Delete orphan signal automation/);

const element = read("src/models/editor/elements/TrackSignalElement.ts");
assert.match(element, /createDefaultSignalOutputConfiguration\(0, 2\)/);

console.log("signal cleanup regression checks: OK");
