import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = fs.readFileSync(
  path.join(root, "src/components/TrackCanvas.tsx"),
  "utf8"
);

const pointerDown =
  source.match(
    /const handlePointerDown = \(ev: PointerEvent\) => \{[\s\S]*?const handlePointerMove/
  )?.[0] ?? "";

const pointerUp =
  source.match(
    /const handlePointerUp = \(ev: PointerEvent\) => \{[\s\S]*?const handlePointerCancel/
  )?.[0] ?? "";

test("mobile signal popup opens on pointerup, not pointerdown", () => {
  assert.doesNotMatch(
    pointerDown,
    /openSignalAspectPopover\(\s*hitElement/
  );
  assert.match(
    pointerUp,
    /hitElement instanceof TrackSignalElement[\s\S]*?openSignalAspectPopover/
  );
});

test("mobile double and three-way popups open on pointerup", () => {
  assert.match(
    pointerUp,
    /hitElement instanceof TrackTurnoutDoubleElement\s*\|\|\s*hitElement instanceof TrackTurnoutThreeWayElement/
  );
  assert.match(
    pointerUp,
    /openDoubleTurnoutPopover/
  );
});
