import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../src/" + path, import.meta.url), "utf8");

test("runtime ignores labels and prefers block artwork while editing remains unchanged", () => {
  const code = read("components/track-canvas/trackCanvasRuntimeHitTest.ts");
  assert.match(code, /if \(editMode\) return layout\.getElement\(x, y\)/);
  assert.match(code, /layout\.blocks\.elements\.find/);
  assert.match(code, /element\.visible && element\.hitTest\(x, y\)/);
  assert.match(code, /if \(block\) return block/);
  assert.match(code, /layout\.getElements\(x, y\)\.find/);
  assert.match(code, /!\(element instanceof LabelElement\)/);
});

test("mouse click, hover and touch use the same runtime hit-testing policy", () => {
  const down = read("components/track-canvas/trackCanvasMouseDown.ts");
  const move = read("components/track-canvas/trackCanvasMouseMove.ts");
  const canvas = read("components/TrackCanvas.tsx");
  assert.match(down, /getTrackCanvasHitElement\(currentLayout, grid\.x, grid\.y, currentEditMode\)/);
  assert.match(move, /getTrackCanvasHitElement\(currentLayout, grid\.x, grid\.y, editModeRef\.current\)/);
  assert.match(canvas, /getTrackCanvasHitElement\(currentLayout, grid\.x, grid\.y, editModeRef\.current\)/);
  assert.equal((canvas.match(/getTrackCanvasHitElement\(layoutRef\.current, grid\.x, grid\.y, editModeRef\.current\)/g) ?? []).length, 2);
});
