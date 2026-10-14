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
  assert.match(picker, /loco=\{driveLoco\}/);
});
