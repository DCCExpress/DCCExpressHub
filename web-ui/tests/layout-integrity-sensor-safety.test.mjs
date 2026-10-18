import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const ELEMENT_TYPES = {
  TRACK_BLOCK: "trackblock",
  TRACK_STRAIGHT: "trackstraight",
  TRACK_BRIDGE: "trackbridge",
  TRACK_DIRECTION: "trackdirection",
  TRACK_END: "trackend",
  TRACK_CORNER: "trackcorner",
  TRACK_CURVE: "trackcurve",
  TRACK_CROSSING: "trackcrossing",
  TRACK_LEVEL_CROSSING: "tracklevelcrossing",
  TRACK_SENSOR: "tracksensor",
  TRACK_TURNOUT: "trackturnout",
  TRACK_TURNOUT_LEFT: "trackturnoutleft",
  TRACK_TURNOUT_RIGHT: "trackturnoutright",
  TRACK_TURNOUT_DOUBLE: "trackturnoutdouble",
  TRACK_TURNOUT_TWO_WAY: "trackturnouttwoway",
  TRACK_TURNOUT_THREE_WAY: "trackturnouttreeway",
  BUTTON_ROUTE: "routebutton",
  BUTTON_ROUTE_EXTENDED: "extendedroutebutton",
};

function loadIntegrity() {
  const source = readFileSync(new URL("../src/services/layoutIntegrity.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  class TrackTurnoutDoubleElement {}
  class TrackTurnoutThreeWayElement {}
  class TrackSignalElement {}
  class TrackLevelCrossingElement extends TrackSignalElement {}
  const dependencies = {
    "@domain/layout/layoutDto": { INVALID_LAYOUT_ELEMENT_ID: 0 },
    "@domain/signalLogic": { validateSignalLogicDocument: () => [] },
    "@domain/layout/elementTypes": { ELEMENT_TYPES },
    "@/models/editor/core/LayoutView": { isTurnoutElement: () => false },
    "../models/editor/elements/TrackTurnoutDoubleElement": { default: TrackTurnoutDoubleElement },
    "../models/editor/elements/TrackTurnoutThreeWayElement": { TrackTurnoutThreeWayElement },
    "../models/editor/elements/TrackSignalElement": { TrackSignalElement },
    "../models/editor/elements/TrackLevelCrossingElement": { TrackLevelCrossingElement },
  };
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require: name => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports.inspectProjectIntegrity;
}

const inspect = loadIntegrity();
const block = (id, name, sensorAddress) => ({ type: "trackblock", id, name, sensorAddress });
const sensor = (id, address, type = "trackstraight") => ({ type, id, name: "element", address });
const check = (elements, knownStates) => inspect({ getAllElements: () => elements }, [], null, [], knownStates);
const messages = (report, area) => report.areas.find(item => item.area === area).issues.map(item => item.message);

test("missing or invalid block sensor addresses block automatic movement", () => {
  const report = check([
    block(1, "A1", 0), block(2, "B1", 700), sensor(3, 701),
  ], new Map([[701, false]]));
  const issues = messages(report, "Blocks");
  assert.equal(issues.length, 2);
  assert.ok(issues.some(message => message.includes("A1") && message.includes("no valid")));
  assert.ok(issues.some(message => message.includes("B1") && message.includes("#700") && message.includes("no physical")));
  assert.ok(issues.every(message => message.includes("Automatic Movement cannot start")));
});

test("two blocks cannot share one occupancy sensor, but multiple rail elements may", () => {
  const report = check([
    block(1, "A1", 1001), block(2, "A2", 1001),
    sensor(3, 1001), sensor(4, 1001, "trackcurve"),
  ], new Map([[1001, true]]));
  const issues = messages(report, "Blocks");
  assert.equal(issues.length, 1);
  assert.match(issues[0], /A1.*A2/);
  assert.match(issues[0], /#1001/);
  assert.equal(messages(report, "Sensors").length, 0);
});

test("OFF is a known safe-to-check state; only missing feedback is UNKNOWN", () => {
  const report = check([
    block(1, "A1", 1001), block(2, "B1", 1002),
    sensor(3, 1001), sensor(4, 1002, "trackturnoutright"),
    sensor(5, 1003, "tracksensor"),
  ], new Map([[1001, false], [1003, true]]));
  assert.equal(messages(report, "Blocks").length, 0);
  const unknown = messages(report, "Sensors");
  assert.equal(unknown.length, 1);
  assert.match(unknown[0], /#1002.*UNKNOWN/);
  assert.ok(!unknown[0].includes("#1001"));
  assert.equal(report.areas.find(area => area.area === "Sensors").checked, 3);
  assert.match(report.areas.find(area => area.area === "Sensors").summary, /1 UNKNOWN/);
});
