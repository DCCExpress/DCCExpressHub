import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Regression from the three-section test layout:
// S3/A1 (34..39,16) -> diverging side of turnout #10 at (40,17),
// S1/A2 (34..39,17) -> straight side, S2/B1 (41..46,17) -> entry.
// One TrackDirection must reach ALL sections regardless of turnout position.

class Point {
  constructor(x, y) { this.x = x; this.y = y; }
  isEqual(other) { return this.x === other.x && this.y === other.y; }
}
const advance = (point, degrees) => {
  const angle = (degrees * Math.PI) / 180;
  return new Point(point.x + Math.round(Math.cos(angle)), point.y + Math.round(Math.sin(angle)));
};

class Rail {
  constructor(id, x, y, rotation = 0) {
    Object.assign(this, { id, x, y, rotation, travelDirection: "unknown", trackName: "" });
    this.pos = new Point(x, y);
  }
  getNextItemXy() { return advance(this.pos, this.rotation); }
  getPrevItemXy() { return advance(this.pos, this.rotation + 180); }
  getNeighborPointPairs() { return [[this.getPrevItemXy(), this.getNextItemXy()]]; }
}
class DirectionRail extends Rail {}
class CurveRail extends Rail {
  getPrevItemXy() { return advance(this.pos, this.rotation + 225); }
}
class RightTurnout extends Rail {
  constructor(id, x, y, rotation, closed) {
    super(id, x, y, rotation);
    this.isClosed = closed;
  }
  getConnections() {
    return {
      straight: advance(this.pos, this.rotation),
      entry: advance(this.pos, this.rotation + 180),
      div: advance(this.pos, this.rotation + 45),
    };
  }
  getNextItemXy() {
    return this.isClosed ? this.getConnections().straight : this.getConnections().div;
  }
  getPrevItemXy() { return this.getConnections().entry; }
}
class ThreeWay extends Rail {}
class DoubleTurnout extends Rail {}

function loadResolver() {
  const source = readFileSync(new URL("../src/domain/railway/trackTravelDirectionResolver.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const requireMock = spec => {
    if (spec === "./topology") {
      return { TopologyDirectionElement: DirectionRail, isTopologyTurnoutElement: item => item instanceof RightTurnout };
    }
    if (spec.endsWith("TrackTurnoutDoubleElement")) {
      return { __esModule: true, default: DoubleTurnout };
    }
    if (spec.endsWith("TrackTurnoutThreeWayElement")) {
      return { TrackTurnoutThreeWayElement: ThreeWay };
    }
    throw new Error(`Unexpected dependency in direction resolver: ${spec}`);
  };
  vm.runInNewContext(javascript, { module, exports: module.exports, require: requireMock, console });
  return module.exports.TrackTravelDirectionResolver;
}

function fixture(turnoutClosed) {
  const tracks = [new DirectionRail(1, 34, 16)];
  for (let x = 35; x <= 38; x++) tracks.push(new Rail(x - 33, x, 16));
  tracks.push(new CurveRail(6, 39, 16, 180));
  tracks.push(new RightTurnout(7, 40, 17, 180, turnoutClosed));
  for (let x = 39; x >= 34; x--) tracks.push(new Rail(8 + 39 - x, x, 17));
  for (let x = 41; x <= 46; x++) tracks.push(new Rail(14 + x - 41, x, 17));
  return {
    tracks,
    getPhysicalTrackElements: () => tracks,
    getDirectionElements: () => tracks.filter(item => item instanceof DirectionRail),
    getTurnouts: () => tracks.filter(item => item instanceof RightTurnout),
    getPhysicalTrackAt: (point, from) => tracks.find(item =>
      item.x === point.x && item.y === point.y &&
      (!from || item.getNeighborPointPairs().some(pair =>
        pair.some(endpoint => endpoint.isEqual(from)))),
    ),
  };
}

for (const closed of [true, false]) {
  test(`TrackDirection reaches A1, A2, B1 through turnout #10 (closed=${closed})`, () => {
    const Resolver = loadResolver();
    const topology = fixture(closed);
    // The original topology lookup loses the third, non-selected turnout leg.
    const turnout = topology.tracks.find(item => item.id === 7);
    const missingLeg = closed ? new Point(39, 16) : new Point(39, 17);
    assert.equal(topology.getPhysicalTrackAt(turnout.pos, missingLeg), undefined);

    new Resolver(topology).resolve();
    assert.equal(topology.tracks.find(item => item.id === 1).travelDirection, "forward");
    assert.equal(topology.tracks.find(item => item.id === 6).travelDirection, "reverse");
    assert.equal(topology.tracks.find(item => item.id === 7).travelDirection, "reverse");
    for (let id = 8; id <= 19; id++) {
      assert.equal(topology.tracks.find(item => item.id === id).travelDirection, "forward", `Track #${id}`);
    }
    for (const item of topology.tracks) {
      assert.notEqual(item.travelDirection, "unknown", `Track #${item.id} was left without direction`);
    }
  });
}
