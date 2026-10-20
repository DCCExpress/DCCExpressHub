import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webUiRoot = path.resolve(here, "..");

const canvasSource = fs.readFileSync(
  path.join(webUiRoot, "src/components/TrackCanvas.tsx"),
  "utf8"
);

const signalPopoverSource = fs.readFileSync(
  path.join(
    webUiRoot,
    "src/components/track-canvas/TrackCanvasSignalAspectPopover.tsx"
  ),
  "utf8"
);

const pointerDown =
  canvasSource.match(
    /const handlePointerDown = \(ev: PointerEvent\) => \{[\s\S]*?const handlePointerMove/
  )?.[0] ?? "";

const pointerUp =
  canvasSource.match(
    /const handlePointerUp = \(ev: PointerEvent\) => \{[\s\S]*?const handlePointerCancel/
  )?.[0] ?? "";

test("mobile popup targets are captured on pointerdown instead of executed", () => {
  assert.match(pointerDown, /pendingRuntimePopupTapRef\.current = \{/);
  assert.match(pointerDown, /canvas\.setPointerCapture\(ev\.pointerId\)/);

  assert.doesNotMatch(
    pointerDown,
    /openSignalAspectPopover\(\s*hitElement/
  );
  assert.doesNotMatch(
    pointerDown,
    /openDoubleTurnoutPopover\(\s*hitElement/
  );
});

test("mobile popup uses stored pointerdown target and opens after tap sequence", () => {
  assert.match(pointerUp, /const pendingPopupTap = pendingRuntimePopupTapRef\.current/);
  assert.match(pointerUp, /const popupElement = pendingPopupTap\.element/);
  assert.match(pointerUp, /window\.setTimeout\(\(\) => \{/);
  assert.match(pointerUp, /\}, 50\);/);
  assert.match(pointerUp, /popupElement instanceof TrackSignalElement/);
  assert.match(pointerUp, /openSignalAspectPopover/);
  assert.match(pointerUp, /openDoubleTurnoutPopover/);
});

test("touch temporarily suppresses compatibility mouse input", () => {
  assert.match(canvasSource, /const suppressMouseUntilRef = useRef\(0\)/);
  assert.match(
    canvasSource,
    /if \(Date\.now\(\) < suppressMouseUntilRef\.current\) \{[\s\S]*?handleTrackCanvasMouseDown/
  );
  assert.match(
    canvasSource,
    /suppressMouseUntilRef\.current = Date\.now\(\) \+ 1000/
  );
});

test("signal popover renders above the mobile runtime overlay", () => {
  assert.match(signalPopoverSource, /zIndex=\{2100\}/);
});
