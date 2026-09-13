import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { load } from "./editor-test-runtime.mjs";
const { TrackElement } = await load("models/editor/core/TrackElement");
const { LayoutView } = await load("models/editor/core/LayoutView");
const { RouteButtonElement: Button } = await load("models/editor/elements/RouteButtonElement");
const { TrackStraightElement: Straight } = await load("models/editor/elements/TrackStraightElement");
const { TrackTurnoutLeftElement: Left } = await load("models/editor/elements/TrackTurnoutLeftElement");
const { TrackTurnoutRightElement: Right } = await load("models/editor/elements/TrackTurnoutRightElement");
const { TrackTurnoutTwoWayElement: TwoWay } = await load("models/editor/elements/TrackTurnoutTwoWayElement");
const { TrackCrossingElement: Crossing } = await load("models/editor/elements/TrackCrossingElement");
const { BlockElement: Block } = await load("models/editor/elements/BlockElement");
const { TrackSensorElement: Sensor } = await load("models/editor/elements/TrackSensorElement");
const { default: Double } = await load("models/editor/elements/TrackTurnoutDoubleElement");
const { TrackTurnoutThreeWayElement: ThreeWay } = await load("models/editor/elements/TrackTurnoutThreeWayElement");
const { wsApi } = await load("services/wsApi");
const { executeRouteButton } = await load("components/track-canvas/trackCanvasRouteActions");
const { executeLegacyRouteButton } = await load("services/routeButtonExecutor");

function layoutWith(...elements) {
  const layout = new LayoutView();
  layout.clearAll();
  for (const element of elements) layout.addElement(element, element.layerName);
  return layout;
}

function button(layout, ...turnouts) {
  const route = new Button(0, -5);
  layout.addElement(route);
  route.routeTurnouts = turnouts.map(turnout => ({
    turnoutId: turnout.id,
    closed: turnout.turnout1Closed ?? turnout.turnoutClosed,
    ...(turnout.turnout2Closed === undefined ? {} : { secondClosed: turnout.turnout2Closed }),
  }));
  return route;
}

test("all configured turnout components are highlighted regardless of list order", () => {
  const a = new Left(0, 0), b = new Left(0, 5);
  const first = new Straight(1, 0), second = new Straight(1, 5);
  const layout = layoutWith(a, b, first, second);
  const route = button(layout, a, b);
  for (let i = 0; i < 2; i++) {
    layout.checkRoutes();
    assert.equal(route.active, true);
    assert.equal(first.isRoute, true);
    assert.equal(second.isRoute, true);
    route.routeTurnouts.reverse();
  }
  b.turnoutClosed = !b.turnoutClosed;
  layout.checkRoutes();
  assert.equal(route.active, false);
  assert.ok(layout.getTrackElements().every(element => !element.isRoute));
});

test("block and sensor overlays inherit the physical rail route", () => {
  const turnout = new Left(0, 0);
  const rail = new Straight(1, 0), next = new Straight(2, 0);
  const block = new Block(1, 0), sensor = new Sensor(2, 0);
  const layout = layoutWith(turnout, rail, next, block, sensor);
  button(layout, turnout);
  layout.checkRoutes();
  assert.ok([rail, next, block, sensor].every(element => element.isRoute));
});

test("crossings preserve the entered line and allow independent routes through both lines", () => {
  const a = new Left(-1, 0), b = new Left(-1, -1);
  b.rotation = 315;
  const crossing = new Crossing(0, 0);
  const horizontal = new Straight(1, 0), diagonal = new Straight(1, 1);
  diagonal.rotation = 45;
  const layout = layoutWith(a, b, crossing, horizontal, diagonal);
  button(layout, a);
  layout.checkRoutes();
  assert.equal(horizontal.isRoute, true);
  assert.equal(diagonal.isRoute, false);
  assert.deepEqual(crossing.routeConnectionIndices, [0]);
  button(layout, b);
  layout.checkRoutes();
  assert.equal(horizontal.isRoute, true);
  assert.equal(diagonal.isRoute, true);
  assert.deepEqual(crossing.routeConnectionIndices.sort(), [0, 1]);
});

for (const Turnout of [Left, Right, TwoWay]) {
  test(`${Turnout.name}: both polarities and all rotations follow the selected branch`, () => {
    for (let rotation = 0; rotation < 360; rotation += 45) {
      for (const polarity of [false, true]) {
        for (const closed of [false, true]) {
          const turnout = new Turnout(0, 0);
          Object.assign(turnout, { rotation, turnoutClosedValue: polarity, turnoutClosed: closed });
          const rails = Object.entries(turnout.getConnections()).map(([side, point]) => {
            const rail = new Straight(point.x, point.y);
            rail.rotation = (Math.atan2(point.y, point.x) * 180 / Math.PI + 360) % 360;
            return [side, rail];
          });
          const layout = layoutWith(turnout, ...rails.map(([, rail]) => rail));
          button(layout, turnout);
          layout.checkRoutes();
          for (const [side, rail] of rails) {
            assert.equal(rail.isRoute, side === "entry" || side === (closed === polarity ? "straight" : "div"));
          }
        }
      }
    }
  });
}

test("Next station geometry: A1 to C1 is continuous and independent of turnout list order", async () => {
  // Geometry copied from DCCExpressNext/data/layout.json, limited to station
  // rows 5..7. Use the physical turnout bits for the A1 -> B1 -> C1 path.
  const fixture = JSON.parse(await readFile(new URL("./fixtures/next-station.json", import.meta.url), "utf8"));
  const layout = LayoutView.fromJSON(fixture);
  const t10 = layout.getElementByName("T10"), t11 = layout.getElementByName("T11"), t12 = layout.getElementByName("T12");
  t10.turnoutClosed = false;
  t11.turnoutClosed = false;
  t12.turnoutClosed = true;
  const route = button(layout, t10, t11, t12);
  for (let order = 0; order < 3; order++) {
    layout.checkRoutes();
    assert.equal(route.active, true);
    for (const element of layout.track.elements.filter(element => element instanceof TrackElement)) {
      const expected = (element.y === 5 && (element.x <= 15 || element.x >= 25)) ||
        (element.y === 6 && element.x >= 16 && element.x <= 24);
      assert.equal(element.isRoute, expected, `${element.type} (${element.x},${element.y})`);
      if (expected) assert.equal(element.stateColor, "yellow");
    }
    for (const name of ["A1", "B1", "C1"]) assert.equal(layout.getElementByName(name).isRoute, true);
    route.routeTurnouts.push(route.routeTurnouts.shift());
  }
});

test("a block's visual bounds do not mask an adjacent standalone sensor", () => {
  const turnout = new Left(0, 0), block = new Block(1, 0), sensor = new Sensor(2, 0), rail = new Straight(3, 0);
  const layout = layoutWith(turnout, block, sensor, rail);
  button(layout, turnout);
  layout.checkRoutes();
  assert.ok([block, sensor, rail].every(element => element.isRoute));
});

test("crossing drawing colors only the traversed line", () => {
  const crossing = new Crossing(0, 0);
  crossing.isRoute = true;
  crossing.routeConnectionIndices = [1];
  const strokes = [];
  const ctx = new Proxy({}, {
    get: (target, name) => name === "stroke" ? () => strokes.push(target.strokeStyle) : target[name] ?? (() => {}),
  });
  crossing.draw(ctx);
  assert.deepEqual(strokes.slice(0, 3), ["black", "#e6e6e6", "yellow"]);
  crossing.occupied = true;
  assert.equal(crossing.getStateColor(false), "red");
  assert.equal(crossing.getStateColor(true), "#ff3333");
});

test("failed output does not activate the route and always releases the busy state", async () => {
  const turnout = new Left(0, 0);
  turnout.turnoutAddress = 10;
  const layout = layoutWith(turnout);
  const route = button(layout, turnout);
  route.routeTurnouts[0].closed = true;
  const originals = [wsApi.routeLock, wsApi.routeUnlock, wsApi.setTurnout];
  let unlocks = 0;
  const busy = [];
  wsApi.routeLock = () => true;
  wsApi.routeUnlock = () => { unlocks++; return true; };
  wsApi.setTurnout = () => false;
  try {
    assert.equal(await executeLegacyRouteButton({ routeButton: route, layout, commandCenterLocked: false, setBusy: value => busy.push(value) }), false);
    assert.equal(turnout.turnoutClosed, false);
    assert.equal(route.active, false);
    assert.equal(unlocks, 1);
    assert.deepEqual(busy, [true, false]);
  } finally {
    [wsApi.routeLock, wsApi.routeUnlock, wsApi.setTurnout] = originals;
  }
});

test("two-motor commands preserve both saved physical bits; incomplete routes send nothing", async () => {
  const turnout = new ThreeWay(0, 0);
  turnout.turnout1Address = 8;
  turnout.turnout2Address = 9;
  // A custom position table, not the default logical-to-physical mapping.
  turnout.rightMotor1Value = true;
  turnout.rightMotor2Value = false;
  const layout = layoutWith(turnout);
  const route = button(layout, turnout);
  route.routeTurnouts[0].closed = true;
  route.routeTurnouts[0].secondClosed = false;
  const originals = [wsApi.routeLock, wsApi.routeUnlock, wsApi.setTurnout];
  const sent = [];
  wsApi.routeLock = () => true;
  wsApi.routeUnlock = () => true;
  wsApi.setTurnout = (...args) => { sent.push(args); return true; };
  try {
    assert.equal(await executeLegacyRouteButton({ routeButton: route, layout, commandCenterLocked: false }), true);
    assert.deepEqual(sent, [[8, true], [9, false]]);
    assert.equal(route.active, true);
    delete route.routeTurnouts[0].secondClosed;
    route.routeTurnouts[0].closed = false;
    turnout.rightMotor1Value = false;
    turnout.rightMotor2Value = true;
    layout.checkRoutes();
    assert.equal(route.active, false);
    assert.equal(await executeLegacyRouteButton({ routeButton: route, layout, commandCenterLocked: false }), false);
    assert.equal(sent.length, 2);
  } finally {
    [wsApi.routeLock, wsApi.routeUnlock, wsApi.setTurnout] = originals;
  }
});

test("live HUB A1-C1: recover the missing second motor and highlight its configured physical path", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/hub-layout.json", import.meta.url), "utf8"));
  const layout = LayoutView.fromJSON(fixture);
  const route = layout.getElementByName("A1-C1");
  const original = fixture.layers.flatMap(layer => layer.elements).find(element => element.name === "A1-C1");
  assert.equal(original.routeTurnouts.find(item => item.turnoutId === 143).secondClosed, undefined);
  assert.equal(route.routeTurnouts.find(item => item.turnoutId === 143).secondClosed, false);
  const originals = [wsApi.routeLock, wsApi.routeUnlock, wsApi.setTurnout];
  const sent = [];
  wsApi.routeLock = () => true;
  wsApi.routeUnlock = () => true;
  wsApi.setTurnout = (...args) => { sent.push(args); return true; };
  try {
    assert.equal(await executeLegacyRouteButton({ routeButton: route, layout, commandCenterLocked: false }), true);
    assert.deepEqual(sent, [[32, false], [33, true], [25, true], [20, false], [21, false]]);
    assert.equal(route.active, true);
    // The saved Double table maps false/true to C-C: the horizontal line
    // leading to the C2 label, despite this button's A1-C1 name.
    for (const element of layout.track.elements) {
      const expected = (element.y === 14 && element.x <= 32) ||
        (element.y === 15 && element.x >= 33);
      assert.equal(element.isRoute, expected, `live HUB ${element.id} (${element.x},${element.y})`);
      if (expected) assert.equal(element.stateColor, "yellow");
    }
    const threeWay = layout.getElementById(143);
    threeWay.turnout2Closed = true;
    layout.checkRoutes();
    assert.equal(route.active, false);
    assert.ok(layout.track.elements.every(element => !element.isRoute));

    const other = layout.getElementByName("A1-C2");
    assert.equal(await executeLegacyRouteButton({ routeButton: other, layout, commandCenterLocked: false }), true);
    assert.equal(other.active, true);
    assert.equal(route.active, false);
    for (const element of layout.track.elements) {
      const expected = (element.y === 14 && (element.x <= 32 || element.x >= 43)) ||
        (element.y === 15 && element.x >= 33 && element.x <= 42);
      assert.equal(element.isRoute, expected, `live HUB A1-C2 ${element.id}`);
    }
  } finally {
    [wsApi.routeLock, wsApi.routeUnlock, wsApi.setTurnout] = originals;
  }
});

for (const Turnout of [Double, ThreeWay]) {
  test(`${Turnout.name}: every configured motor pair and rotation follows only its matching ports`, () => {
    for (let rotation = 0; rotation < 360; rotation += 45) {
      const turnout = new Turnout(0, 0);
      turnout.rotation = rotation;
      for (const allowed of turnout.getAllowedRoutes()) {
        turnout.turnout1Closed = allowed.turnoutStates[0].closed;
        turnout.turnout2Closed = allowed.turnoutStates[1].closed;
        const ports = turnout.getConnections();
        const rails = Object.entries(ports).map(([side, point]) => {
          const rail = new Straight(point.x, point.y);
          rail.rotation = (Math.atan2(point.y, point.x) * 180 / Math.PI + 360) % 360;
          return [side, rail];
        });
        const layout = layoutWith(turnout, ...rails.map(([, rail]) => rail));
        const route = button(layout, turnout);
        layout.checkRoutes();
        assert.equal(route.active, true);
        for (const [side, rail] of rails) {
          assert.equal(rail.isRoute, side === allowed.from || side === allowed.to, `${rotation} ${allowed.from}->${allowed.to}: ${side}`);
        }
      }
    }
  });
}

test("canvas and editor test send the same configured extended accessory aspect", async () => {
  const turnout = new Left(0, 0);
  turnout.outputMode = "extended";
  turnout.turnoutAddress = 23;
  turnout.turnoutClosedValue = true;
  turnout.turnoutClosedAspect = 7;
  turnout.turnoutOpenedAspect = 19;
  const layout = layoutWith(turnout, new Straight(1, 0));
  const route = button(layout, turnout);
  route.routeTurnouts[0].closed = true;
  const sent = [];
  const originals = [wsApi.routeLock, wsApi.routeUnlock, wsApi.setSignalAspect];
  wsApi.routeLock = () => true;
  wsApi.routeUnlock = () => true;
  wsApi.setSignalAspect = (...args) => { sent.push(args); return true; };
  try {
    await executeRouteButton(route, layout, { t: key => key, commandCenterLocked: false });
    await executeLegacyRouteButton({ routeButton: route, layout, commandCenterLocked: false });
    assert.deepEqual(sent, [[23, 7, true], [23, 7, true]]);
  } finally {
    [wsApi.routeLock, wsApi.routeUnlock, wsApi.setSignalAspect] = originals;
  }
});
