import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL("../src/" + name, import.meta.url), "utf8");

test("Drive to Block enters canvas mode without deleting the original dialog", () => {
  const picker = read("components/track-canvas/TrackCanvasBlockLocoPicker.tsx");
  assert.match(picker, /onBeginBlockSelection\(loco\)/);
  assert.match(picker, /<LocoTargetBlockDialog/);
  assert.match(picker, /blockSelectionActive/);
});
test("destinations derive from tracked source and route topology", () => {
  const canvas = read("components/TrackCanvas.tsx");
  assert.match(canvas, /getTrainTrackingState\(\)/);
  assert.match(canvas, /loadMovementRouteCandidates\(await loadAutomationMovement\(\)\)/);
  assert.match(canvas, /route\.fromBlockId === sourceId/);
  assert.match(canvas, /route\.toBlockId !== sourceId/);
  assert.match(canvas, /route\.locoDirection !== "unknown"/);
  assert.match(canvas, /"#ffd43b"/);
  assert.match(canvas, /block\.getBounds\(\)/);
});
test("yellow blocks start an authorized transient Movement; any other click cancels", () => {
  const canvas = read("components/TrackCanvas.tsx");
  assert.match(canvas, /!state\.routes\.some\(route => route\.toBlockId === hit\.id\)/);
  assert.match(canvas, /exitBlockSelection\(\)/);
  assert.match(canvas, /applyMovementRouteCandidate\(createMovementPage\(\), route\)/);
  assert.match(canvas, /startTransientMovement\(page\)/);
  assert.match(canvas, /page\.expectedLocoAddress = state\.loco\.address/);
  assert.match(canvas, /blockSelectionRef\.current && ev\.button === 0/);
});
test("Edit toolbar and E shortcut are locked until selection ends", () => {
  const page = read("LiteLayoutPage.tsx");
  const shortcuts = read("hooks/layout/useLayoutPageShortcuts.ts");
  assert.match(page, /disabled=\{blockSelectionActive\}/);
  assert.match(page, /onBlockSelectionChange=\{setBlockSelectionActive\}/);
  assert.match(page, /blockSelectionActive,\n  \}\)/);
  assert.match(shortcuts, /!blockSelectionActive/);
});

test("the throttle card Drive to Block button uses canvas selection, not the old dialog", () => {
  const card = read("layout/loco-panel/LocoControlCard.tsx");
  const canvas = read("components/TrackCanvas.tsx");
  const bridge = read("services/driveToBlockSelection.ts");
  assert.match(card, /requestDriveToBlockSelection\(loco\)/);
  assert.doesNotMatch(card, /onClick=\{\(\) => setTargetDialogOpened\(true\)\}/);
  assert.match(card, /driveSelection\.active/);
  assert.match(card, /<LocoTargetBlockDialog/);
  assert.match(canvas, /registerDriveToBlockCanvas\(loco =>/);
  assert.match(canvas, /setDriveToBlockSelectionActive\(true\)/);
  assert.match(canvas, /setDriveToBlockSelectionActive\(false\)/);
  assert.match(bridge, /if \(!handler \|\| selecting\) return false/);
});

test("destination selection hint moves to status bar and locks other layout surfaces", () => {
  const page = read("LiteLayoutPage.tsx");
  const statusIndex = page.indexOf('className="lite-status-bar"');
  const hintIndex = page.indexOf("Select yellow destination · Esc to cancel");
  assert.ok(statusIndex >= 0 && hintIndex > statusIndex);
  assert.doesNotMatch(page.slice(page.indexOf('className="lite-layout-toolbar"'), statusIndex), /Select yellow destination/);
  for (const className of [
    "lite-layout-toolbar",
    "lite-loco-panel",
    "lite-panel-resizer-left",
    "lite-panel-resizer-right",
    "lite-right-loco-panel",
    "lite-property-panel",
  ]) {
    const line = page.split("\n").find(value => value.includes('className="' + className + '"'));
    assert.ok(line?.includes("inert={blockSelectionActive}"), className + " must be inert while selecting");
  }
  assert.match(page, /wrap="nowrap" inert=\{blockSelectionActive\}/);
  assert.match(page, /color="red" variant="filled" onClick=\{\(\) => wsApi\.emergencyStop\(\)\}/);
});
