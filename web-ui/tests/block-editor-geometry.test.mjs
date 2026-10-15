import assert from "node:assert/strict";
import { test } from "node:test";
import { load, recordingCanvas } from "./editor-test-runtime.mjs";

const { BlockElement } = await load("models/editor/elements/BlockElement");
const { TrackStraightElement } = await load("models/editor/elements/TrackStraightElement");
const { LayoutView } = await load("models/editor/core/LayoutView");

// A block has a 3x1 artwork, but its persisted x/y is the CENTER rail cell.
// Check the actual production canvas transforms against the production hitbox,
// not just the hitbox in isolation.
test("block drawing and selection have the same bounds at all 4 rotations", () => {
  for (const rotation of [0, 90, 180, 270]) {
    const block = new BlockElement(9, 5);
    block.rotation = rotation;
    const { ctx, calls } = recordingCanvas();
    block.draw(ctx);

    const translations = calls.filter(([operation]) => operation === "translate");
    const anchor = translations[1];
    const uncenter = translations[2];
    assert.deepEqual(anchor, [
      "translate",
      block.centerX,
      block.centerY,
    ], `rotation ${rotation}: visual center must be the anchor cell`);
    assert.deepEqual(uncenter, [
      "translate",
      -block.centerX,
      -block.centerY,
    ], `rotation ${rotation}: artwork centered around its own local midpoint`);

    // Transform the four corners of the unrotated artwork into grid space.
    const theta = rotation * Math.PI / 180;
    const points = [
      [block.posLeft, block.posTop],
      [block.posRight, block.posTop],
      [block.posRight, block.posBottom],
      [block.posLeft, block.posBottom],
    ].map(([px, py]) => {
      const dx = px - block.centerX;
      const dy = py - block.centerY;
      return [
        (anchor[1] + dx * Math.cos(theta) - dy * Math.sin(theta)) / block.GridSizeX,
        (anchor[2] + dx * Math.sin(theta) + dy * Math.cos(theta)) / block.GridSizeY,
      ];
    });
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const actual = {
      x: Math.round(Math.min(...xs)),
      y: Math.round(Math.min(...ys)),
      width: Math.round(Math.max(...xs) - Math.min(...xs)),
      height: Math.round(Math.max(...ys) - Math.min(...ys)),
    };
    assert.deepEqual(actual, block.getBounds(), `rotation ${rotation}: painted artwork vs hitTest`);
    const bounds = block.getBounds();
    assert.equal(block.hitTest(bounds.x, bounds.y), true);
    assert.equal(block.hitTest(bounds.x + bounds.width, bounds.y), false);
  }
});

test("editor picks the block over its underlying rail and moves its anchor cell", () => {
  const layout = new LayoutView();
  layout.clearAll();
  const track = new TrackStraightElement(9, 5);
  const block = new BlockElement(9, 5);
  layout.addElement(track, track.layerName);
  layout.addElement(block, block.layerName);
  assert.equal(layout.getElement(9, 5), block);
  assert.equal(layout.getElement(8, 5), block);
  assert.equal(layout.getElement(11, 5), null);
  assert.equal(layout.getLayeredElement(block, 10, 5), null);
  block.moveBy(1, 0);
  assert.deepEqual([block.x, block.y], [10, 5]);
  assert.equal(layout.getElement(10, 5), block);
});

test("selected block uses one viewport transform and an outline aligned to artwork", () => {
  const block = new BlockElement(9, 5);
  block.selected = true;
  const { ctx, calls } = recordingCanvas();
  block.draw(ctx, { scale: 1.7, offsetX: 123, offsetY: -34 });

  assert.deepEqual(
    calls.filter(([operation]) => operation === "translate"),
    [
      ["translate", 123, -34],
      ["translate", block.centerX, block.centerY],
      ["translate", -block.centerX, -block.centerY],
    ],
    "Selecting a block must not apply the viewport transform twice",
  );

  assert.ok(
    calls.some(([operation, x, y, w, h]) =>
      operation === "strokeRect" &&
      x === block.posLeft && y === block.posTop &&
      w === block.width && h === block.height
    ),
    "Selection outline must cover exactly the block artwork",
  );
});
