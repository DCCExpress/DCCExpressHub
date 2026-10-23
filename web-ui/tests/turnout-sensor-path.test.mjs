import assert from "node:assert/strict";
import { test } from "node:test";
import { collectTurnoutSensorPaths } from "../src/services/turnoutSensorPath.ts";

const layout = {
  layers: [{
    elements: [
      { id: 30, type: "trackturnoutleft", address: 1021, turnoutAddress: 30 },
      { id: 31, type: "trackturnoutright", address: 1021, turnoutAddress: 31 },
      { id: 32, type: "trackturnouttwoway", address: 1022, turnoutAddress: 32 },
      { id: 33, type: "trackturnouttreeway", address: 0, turnoutAddress: 33 },
      { id: 34, type: "trackstraight", address: 1999 },
    ],
  }],
};

test("connected #30/#31 share one #1021 occupancy region", () => {
  assert.deepEqual(collectTurnoutSensorPaths(layout, [{
    turnoutPath: [{ elementId: 30 }, { elementId: 31 }],
  }]), [[1021]]);
});

test("turnout chain keeps different sensors in physical order", () => {
  assert.deepEqual(collectTurnoutSensorPaths(layout, [{
    turnoutPath: [{ elementId: 30 }, { elementId: 31 }, { elementId: 32 }, { elementId: 33 }],
  }, {
    turnoutPath: [{ elementId: 32 }, { elementId: 31 }, { elementId: 30 }],
  }]), [[1021, 1022], [1022, 1021]]);
});

test("accessory addresses, unvisited turnouts and unrelated track are excluded", () => {
  assert.deepEqual(collectTurnoutSensorPaths(layout, [{
    turnoutPath: [{ elementId: 33 }, { elementId: 34 }],
  }, {
    turnoutPath: [{ elementId: 30 }, { elementId: 32 }, { elementId: 31 }],
  }, {
    turnoutPath: [],
  }]), [[], [1021, 1022, 1021], []]);
});
