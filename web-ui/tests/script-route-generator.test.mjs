import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./editor-test-runtime.mjs";

const {
  filterScriptRoutes,
  generateScriptFromRoute,
  listScriptRoutes,
  scriptRouteBlockFilterOptions,
} = await load("services/scriptRouteGenerator");

const layout = {
  layers: [{
    elements: [
      { type: "trackblock", id: 1, name: "A1", sensorAddress: 1001 },
      { type: "trackblock", id: 2, name: "B1", sensorAddress: 1006 },
      { type: "trackblock", id: 3, name: "C1", sensorAddress: 1017 },
    ],
  }],
  routeTopology: {
    graph: { ready: true },
    routeTable: [{
      fromBlockId: 1,
      fromBlockName: "A1",
      toBlockId: 3,
      toBlockName: "C1",
      locoDirection: "forward",
      blockPath: [
        { id: 1, name: "A1", nodeIndex: 0 },
        { id: 2, name: "B1", nodeIndex: 2 },
        { id: 3, name: "C1", nodeIndex: 4 },
      ],
      edgePath: [
        { turnoutPath: [{ turnoutStates: [{ address: 20, closed: false }] }] },
        { turnoutPath: [{ turnoutStates: [{ address: 21, closed: true }] }] },
        { turnoutPath: [{ turnoutStates: [{ address: 25, closed: true }] }] },
        { turnoutStates: [] },
      ],
    }],
  },
};

test("route scripts use named, editable functions per block-to-block leg", () => {
  const options = listScriptRoutes(layout);
  assert.equal(options.length, 1);
  assert.match(options[0].label, /A1 → B1 → C1/);

  const code = generateScriptFromRoute(layout, options[0]);
  assert.match(code, /async function A1_to_B1\(\)/);
  assert.match(code, /async function B1_to_C1\(\)/);
  assert.match(code, /beforeStart: A1 → B1/);
  assert.match(code, /arrived: A1 → B1/);
  assert.match(code, /beforeStart: B1 → C1/);
  assert.match(code, /arrived: B1 → C1/);
  assert.match(code, /await switchMan\(\[20,21\]/);
  assert.match(code, /await switchMan\(\[25\]/);
  assert.match(code, /const SENSOR = 1006/);
  assert.match(code, /const SENSOR = 1017/);
  assert.match(code, /let proceed = await A1_to_B1\(\)/);
  assert.match(code, /if \(proceed\) proceed = await B1_to_C1\(\)/);
  assert.doesNotMatch(code, /const legs = /);
  assert.doesNotMatch(code, /for \(const leg of legs\)/);

  // Generated code is an async script body, not an independently executed module.
  assert.doesNotThrow(() => new Function("dcc", "setInfo", "switchMan", "delay",
    "return (async () => {\n" + code + "\n});"));
});

test("missing destination contact fails generation instead of producing an unsafe wait", () => {
  const invalid = structuredClone(layout);
  invalid.layers[0].elements.find(element => element.id === 3).sensorAddress = 0;
  assert.throws(
    () => generateScriptFromRoute(invalid, listScriptRoutes(invalid)[0]),
    /Missing block sensor in C1/,
  );
});

test("FROM and TO filters independently select only matching saved routes", () => {
  const input = structuredClone(layout);
  const base = input.routeTopology.routeTable[0];
  input.routeTopology.routeTable.push({
    ...structuredClone(base),
    fromBlockId: 2,
    fromBlockName: "B1",
    blockPath: base.blockPath.slice(1),
    edgePath: base.edgePath.slice(2),
  });
  input.routeTopology.routeTable.push({
    ...structuredClone(base),
    fromBlockId: 1,
    fromBlockName: "A1",
    toBlockId: 2,
    toBlockName: "B1",
    blockPath: base.blockPath.slice(0, 2),
    edgePath: base.edgePath.slice(0, 2),
  });

  const routes = listScriptRoutes(input);
  assert.equal(routes.length, 3);
  assert.deepEqual(scriptRouteBlockFilterOptions(routes, "from"), [
    { value: "1", label: "A1" },
    { value: "2", label: "B1" },
  ]);
  assert.deepEqual(scriptRouteBlockFilterOptions(routes, "to"), [
    { value: "2", label: "B1" },
    { value: "3", label: "C1" },
  ]);
  assert.equal(filterScriptRoutes(routes, null, null).length, 3);
  assert.deepEqual(filterScriptRoutes(routes, "1", null).map(route => route.path), [
    "A1 → B1 → C1", "A1 → B1",
  ]);
  assert.deepEqual(filterScriptRoutes(routes, null, "3").map(route => route.path), [
    "A1 → B1 → C1", "B1 → C1",
  ]);
  assert.deepEqual(filterScriptRoutes(routes, "1", "3").map(route => route.path), [
    "A1 → B1 → C1",
  ]);
  assert.deepEqual(filterScriptRoutes(routes, "2", "2"), []);
});
