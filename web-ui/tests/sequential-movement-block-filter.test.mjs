import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./editor-test-runtime.mjs";

const { normalizeReversals, reachableNextBlocks } =
  await load("components/routes/sequentialMovementBlockFilter");

function step(blockId, direction = "forward", waitMode = "pass") {
  return { blockId, direction, waitMode, waitSeconds: 10, minSeconds: 5, maxSeconds: 20 };
}

function route(from, to, direction, blockPath) {
  return {
    fromBlockId: from,
    toBlockId: to,
    locoDirection: direction,
    blockPath: blockPath.map((id, nodeIndex) => ({
      id,
      name: String(id),
      nodeIndex,
    })),
  };
}

const outbound = route(1, 3, "forward", [1, 2, 3]);
const returnTrip = route(3, 1, "reverse", [3, 2, 1]);
const routeTable = [outbound, returnTrip];

test("intermediate B1 and endpoint C1 are offered for an A1 -> B1 -> C1 route", () => {
  const steps = [step(1), step(0), step(0)];
  assert.deepEqual([...reachableNextBlocks(steps, 1, routeTable)].sort(), [2, 3]);
  steps[1] = step(2);
  assert.deepEqual([...reachableNextBlocks(steps, 2, routeTable)], [3]);
});

test("Reverse at C1 offers intermediate B1, then A1, without an extra C1 -> B1 entry", () => {
  const steps = normalizeReversals([
    step(1), step(2), step(3, "reverse"), step(0, "reverse"), step(0, "reverse"),
  ]);
  assert.equal(steps[2].waitMode, "fixed");
  assert.equal(steps[2].waitSeconds, 0);
  assert.deepEqual([...reachableNextBlocks(steps, 3, routeTable)].sort(), [1, 2]);
  steps[3] = step(2, "reverse");
  assert.deepEqual([...reachableNextBlocks(steps, 4, routeTable)], [1]);
});

test("reversal uses the departure block after the stop, not the previous forward prefix", () => {
  const steps = normalizeReversals([
    step(1), step(2, "reverse"), step(0, "reverse"),
  ]);
  const reverseFromB1 = route(2, 1, "reverse", [2, 1]);
  assert.equal(steps[1].waitMode, "fixed");
  assert.deepEqual([...reachableNextBlocks(steps, 2, [outbound, reverseFromB1])], [1]);
});

test("opposite-direction and disconnected routes never offer blocks", () => {
  const steps = [step(3, "reverse"), step(0, "reverse")];
  assert.deepEqual([...reachableNextBlocks(steps, 1, [outbound])], []);
  assert.deepEqual([...reachableNextBlocks(steps, 1, [route(4, 1, "reverse", [4, 2, 1])])], []);
});

test("a selected prefix constrains candidates to blocks after the last checkpoint", () => {
  const steps = [step(3, "reverse"), step(1, "reverse"), step(0, "reverse")];
  assert.deepEqual([...reachableNextBlocks(steps, 2, routeTable)], []);
  steps[1] = step(2, "reverse");
  assert.deepEqual([...reachableNextBlocks(steps, 2, routeTable)], [1]);
});

test("a step cannot immediately select its own block", () => {
  const steps = [step(3, "reverse"), step(0, "reverse")];
  assert.ok(!reachableNextBlocks(steps, 1, routeTable).has(3));
});

test("unknown track direction cannot be used as a guessed reverse route", () => {
  const steps = [step(3, "reverse"), step(0, "reverse")];
  const unknown = route(3, 1, "unknown", [3, 2, 1]);
  assert.deepEqual([...reachableNextBlocks(steps, 1, [unknown])], []);
});
