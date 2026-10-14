import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = relative => readFileSync(new URL("../src/" + relative, import.meta.url), "utf8");

test("locomotive card route action is separate from block assignment", () => {
  const picker = read("components/loco/LocoPicker.tsx");
  assert.match(picker, /onClick=\{\(\) => onSelect\(loco\)\}/);
  assert.match(picker, /onDriveToBlock &&/);
  assert.match(picker, /event\.stopPropagation\(\)/);
  assert.match(picker, /onDriveToBlock\(loco\)/);
});

test("block click keeps assignment picker and reuses existing Drive to Block dialog", () => {
  const picker = read("components/track-canvas/TrackCanvasBlockLocoPicker.tsx");
  assert.match(picker, /opened=\{opened && driveLoco === null\}/);
  assert.match(picker, /onDriveToBlock=\{setDriveLoco\}/);
  assert.match(picker, /wsApi\.setBlock\(/);
  assert.match(picker, /<LocoTargetBlockDialog/);
  assert.match(picker, /onClose=\{\(\) => \{[\s\S]*?setDriveLoco\(null\);[\s\S]*?onClose\(\);[\s\S]*?\}\}/);
  assert.match(picker, /loco=\{driveLoco\}/);
});

test("route icon requires the card locomotive to be the block's actual loco", () => {
  const picker = read("components/loco/LocoPicker.tsx");
  const block = read("components/track-canvas/TrackCanvasBlockLocoPicker.tsx");
  assert.match(picker, /disabled=\{canDriveToBlock \? !canDriveToBlock\(loco\) : false\}/);
  assert.match(block, /selectedBlock\?\.locoAddress === loco\.address/);
  assert.match(block, /selectedBlock\.locoAddress !== loco\.address\) return/);
  assert.doesNotMatch(block, /canDriveToBlock=\{loco =>[\s\S]*?getBlockTargetLocoAddress/);
});

test("runtime canvas checks block overlay before labels and underlying track", () => {
  const canvas = read("components/TrackCanvas.tsx");
  const hitTest = read("components/track-canvas/trackCanvasRuntimeHitTest.ts");
  assert.match(canvas, /getTrackCanvasHitElement\(currentLayout, grid\.x, grid\.y, editModeRef\.current\)/);
  assert.match(hitTest, /layout\.blocks\.elements\.find/);
  assert.match(hitTest, /element\.visible && element\.hitTest\(x, y\)/);
  assert.match(hitTest, /if \(block\) return block/);
  assert.match(hitTest, /!\(element instanceof LabelElement\)/);
});
