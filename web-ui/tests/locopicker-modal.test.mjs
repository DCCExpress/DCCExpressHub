import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("LocoPicker uses a global Mantine modal", () => {
  const source = read("src/components/loco/LocoPicker.tsx");

  assert.match(source, /<Modal[\s\S]*opened=\{opened\}/);
  assert.match(source, /zIndex=\{3000\}/);
  assert.match(source, /lockScroll/);
  assert.match(source, /trapFocus/);
  assert.doesNotMatch(source, /position:\s*"absolute"/);
});

test("LocoPicker guards stale selected-loco removal", () => {
  const source = read("src/components/loco/LocoPicker.tsx");

  assert.match(source, /disabled=\{!selectedLoco\}/);
  assert.doesNotMatch(source, /locos\.find\([\s\S]*?\)!/);
});

test("all current entry points still share LocoPicker", () => {
  const locoPanel = read("src/layout/LocoPanel.tsx");
  const blockPicker = read(
    "src/components/track-canvas/TrackCanvasBlockLocoPicker.tsx"
  );
  const app = read("src/App.tsx");

  assert.match(locoPanel, /<LocoPicker/);
  assert.match(blockPicker, /<LocoPicker/);
  assert.match(app, /<LocoPanel\s+locos=\{locos\}\s+mobileViewport/);
});
