import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/services/layoutIntegrity.ts", import.meta.url),
  "utf8"
);

test("signal integrity accepts multi-motor turnouts", () => {
  assert.match(source, /TrackTurnoutThreeWayElement/);
  assert.match(source, /TrackTurnoutDoubleElement/);
  assert.match(source, /filter\(isSignalLogicTurnoutElement\)/);
});

test("signal integrity accepts occupancy-bearing normal track elements", () => {
  assert.match(source, /function isSignalLogicSensorElement/);
  assert.match(source, /return String\(element\.type\)\.startsWith\("track"\)/);
  assert.doesNotMatch(source, /instanceof TrackSensorElement/);
});

test("no address-based ID rebinding was introduced", () => {
  assert.doesNotMatch(source, /rebind/i);
  assert.match(source, /condition\.turnoutId/);
  assert.match(source, /condition\.sensorId/);
});
