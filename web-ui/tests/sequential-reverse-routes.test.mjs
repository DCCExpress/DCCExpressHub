import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./editor-test-runtime.mjs";

const { includeUnambiguousReturnRoutes } = await load("services/clientRouteGraphCache");

const forwardRoute = (nodes = ["S1.1", "S1.2"]) => ({
  fromBlockId: 1,
  fromBlockName: "A",
  toBlockId: 2,
  toBlockName: "B",
  locoDirection: "forward",
  nodes,
  blockPath: [
    { id: 1, name: "A", nodeIndex: 0 },
    { id: 2, name: "B", nodeIndex: nodes.length - 1 },
  ],
  turnoutStates: [{ address: 7, closed: true }],
  edgePath: nodes.slice(1).map((to, index) => ({
    from: nodes[index],
    to,
    locoDirection: "forward",
    turnoutStates: [{ address: 7, closed: true }],
    turnoutPath: [{
      elementId: 777,
      name: "Turnout 7",
      turnoutStates: [{ address: 7, closed: true }],
    }],
  })),
});

test("a unique forward path receives the exact physical reverse route", () => {
  const original = forwardRoute(["S1.1", "S1.2", "S1.3"]);
  const routes = includeUnambiguousReturnRoutes([original]);
  assert.equal(routes.length, 2);
  const reverse = routes.find(route => route.locoDirection === "reverse");
  assert.ok(reverse);
  assert.equal(reverse.fromBlockId, 2);
  assert.equal(reverse.toBlockId, 1);
  assert.deepEqual(reverse.blockPath.map(block => block.id), [2, 1]);
  assert.deepEqual(reverse.blockPath.map(block => block.nodeIndex), [0, 2]);
  assert.deepEqual(reverse.nodes, ["S1.3", "S1.2", "S1.1"]);
  assert.deepEqual(reverse.edgePath.map(edge => [edge.from, edge.to, edge.locoDirection]), [
    ["S1.3", "S1.2", "reverse"],
    ["S1.2", "S1.1", "reverse"],
  ]);
  assert.deepEqual(reverse.turnoutStates, original.turnoutStates);
  assert.deepEqual(reverse.edgePath[0].turnoutPath, original.edgePath[1].turnoutPath);
  assert.notEqual(reverse.edgePath[0].turnoutPath, original.edgePath[1].turnoutPath);
});

test("existing reverse variants are retained without duplicates", () => {
  const forward = forwardRoute();
  const reverse = {
    ...forward,
    fromBlockId: 2,
    fromBlockName: "B",
    toBlockId: 1,
    toBlockName: "A",
    locoDirection: "reverse",
    nodes: [...forward.nodes].reverse(),
    blockPath: [...forward.blockPath].reverse(),
    edgePath: [...forward.edgePath].reverse(),
  };
  assert.equal(includeUnambiguousReturnRoutes([forward, reverse]).length, 2);
});

test("ambiguous forward alternatives do not fabricate a return route", () => {
  const first = forwardRoute(["S1.1", "S1.2"]);
  const second = forwardRoute(["S1.1", "S1.4", "S1.2"]);
  const routes = includeUnambiguousReturnRoutes([first, second]);
  assert.equal(routes.length, 2);
  assert.ok(routes.every(route => route.locoDirection === "forward"));
});

test("unknown direction and incomplete physical paths are never inverted", () => {
  const unknown = { ...forwardRoute(), locoDirection: "unknown" };
  const incomplete = { ...forwardRoute(), edgePath: [] };
  assert.equal(includeUnambiguousReturnRoutes([unknown, incomplete]).length, 2);
});

test("reverse travel can return to the source after a stop", () => {
  const route = includeUnambiguousReturnRoutes([forwardRoute()]);
  assert.ok(route.some(item =>
    item.fromBlockId === 2 && item.toBlockId === 1 &&
    item.locoDirection === "reverse" &&
    item.blockPath.map(block => block.id).join(",") === "2,1"
  ));
});
