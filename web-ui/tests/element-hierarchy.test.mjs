import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { load, recordingCanvas } from "./editor-test-runtime.mjs";

const { BaseElement } = await load("models/editor/core/BaseElement");
const { TrackElement, TrackStates } = await load("models/editor/core/TrackElement");
const { TrackTurnoutElement } = await load("models/editor/elements/TrackTurnoutElement");
const { TrackMultiMotorTurnoutElement } = await load("models/editor/elements/TrackMultiMotorTurnoutElement");
const { ElementFactory } = await load("models/editor/core/ElementFactory");
const { LayoutView } = await load("models/editor/core/LayoutView");
const { buildRailwayTopologyFromLayout } = await load("domain/railway/topology");
const classes = new Map();
for (const file of await readdir(new URL("../src/models/editor/elements", import.meta.url))) {
  if (!file.endsWith("Element.ts") || ["TrackTurnoutElement.ts", "TrackMultiMotorTurnoutElement.ts"].includes(file)) continue;
  const name = file.replace(".ts", "");
  const module = await load(`models/editor/elements/${name}`);
  classes.set(name, module.default ?? module[name]);
}
const Straight = classes.get("TrackStraightElement");
const Block = classes.get("BlockElement");
const RouteButton = classes.get("RouteButtonElement");

test("all 24 factory elements share the base, preserve identity on load, and clone without an assigned ID", () => {
  assert.equal(classes.size, 24);
  for (const [name, Class] of classes) {
    const element = new Class(2, 3);
    element.id = 42;
    assert.ok(element instanceof BaseElement, name);
    assert.equal(element instanceof TrackElement, /^(Track|Block)/.test(name), name);
    const loaded = ElementFactory.create(element.toJSON());
    assert.ok(loaded instanceof Class, name);
    assert.equal(loaded.id, 42, name);
    assert.deepEqual([loaded.x, loaded.y], [2, 3], name);
    const clone = element.clone();
    assert.ok(clone instanceof Class, name);
    assert.equal(clone.id, 0, name);
    assert.notEqual(clone, element, name);
  }
});

test("the turnout bases dispatch drawing and clicks through overridden hooks", () => {
  for (const name of ["TrackTurnoutLeftElement", "TrackTurnoutRightElement", "TrackTurnoutTwoWayElement"]) {
    const element = new (classes.get(name))(0, 0);
    assert.ok(element instanceof TrackTurnoutElement);
    let closedDrawn, toggled = false;
    element.drawTurnout = (_ctx, closed) => { closedDrawn = closed; };
    element.toggle = () => { toggled = true; };
    element.draw(recordingCanvas().ctx);
    element.mouseDown({});
    assert.equal(closedDrawn, element.isClosed);
    assert.ok(toggled);
  }
  for (const name of ["TrackTurnoutDoubleElement", "TrackTurnoutThreeWayElement"]) {
    const element = new (classes.get(name))(0, 0);
    assert.ok(element instanceof TrackMultiMotorTurnoutElement);
    let drawn = false;
    element.drawTrack = () => { drawn = true; };
    element.draw(recordingCanvas().ctx);
    assert.ok(drawn);
  }
});

test("inherited coordinates use virtual grid getters and preserve centered block bounds", () => {
  class CustomGrid extends Straight {
    get GridSizeX() { return 30; }
    get GridSizeY() { return 50; }
  }
  const track = new CustomGrid(2, 3);
  assert.deepEqual([track.PositionX, track.PositionY, track.width, track.height, track.centerX, track.centerY], [60, 150, 30, 50, 75, 175]);
  track.locked = true;
  track.moveBy(1, 1);
  track.rotateRight();
  assert.deepEqual([track.x, track.y, track.rotation], [2, 3, 0]);
  const block = new Block(2, 3);
  assert.equal(block.posLeft, 40);
  assert.equal(block.centerX, 100);
  assert.equal(block.hitTest(1, 3), true);
  assert.deepEqual(block.getCollisionBounds(), { x: 2, y: 3, width: 1, height: 1 });
});

test("occupancy and output properties are available immediately without prototype installation", () => {
  for (const [name, Class] of classes) {
    const properties = new Class(0, 0).getEditableProperties();
    const physicalRail = name.startsWith("Track") && !["TrackSignalElement", "TrackSensorElement"].includes(name);
    if (physicalRail) assert.equal(properties.filter(property => property.key === "address").length, 1, name);
    assert.equal(new Set(properties.map(property => property.key)).size, properties.length, name);
  }
  const double = new (classes.get("TrackTurnoutDoubleElement"))(0, 0);
  assert.ok(double.getEditableProperties().find(property => property.key === "outputMode").options.some(option => option.value === "extended"));
});

test("extended turnout aspects survive load, save and clone without startup patches", () => {
  for (const name of ["TrackTurnoutLeftElement", "TrackTurnoutRightElement", "TrackTurnoutTwoWayElement", "TrackTurnoutDoubleElement"]) {
    const Class = classes.get(name);
    const element = new Class(0, 0);
    const aspects = name.includes("Double")
      ? { turnout1ClosedAspect: 19, turnout1OpenedAspect: 23, turnout2ClosedAspect: 71, turnout2OpenedAspect: 85 }
      : { turnoutClosedAspect: 19, turnoutOpenedAspect: 23 };
    Object.assign(element, { outputMode: "extended" }, aspects);
    for (const copy of [Class.fromJSON(element.toJSON()), element.clone()]) {
      assert.equal(copy.outputMode, "extended", name);
      for (const [key, value] of Object.entries(aspects)) {
        assert.equal(copy[key], value, `${name}.${key}`);
        assert.equal(copy.toJSON()[key], value, `${name}.${key}`);
      }
    }
  }
  const TwoWay = classes.get("TrackTurnoutTwoWayElement");
  const legacy = new TwoWay(0, 0);
  legacy.outputMode = "vpin";
  assert.equal(TwoWay.fromJSON(legacy.toJSON()).outputMode, "vpin");
});

test("all rails share occupancy and route color precedence", () => {
  for (const [name, Class] of classes) {
    const element = new Class(0, 0);
    if (!(element instanceof TrackElement)) continue;
    assert.equal(element.stateColor, "#e6e6e6", name);
    element.state = TrackStates.selected;
    assert.equal(element.stateColor, "yellow", name);
    element.isRoute = true;
    element.isBusy = true;
    assert.equal(element.stateColor, "orange", name);
    element.occupied = true;
    assert.equal(element.stateColor, "#ff3333", name);
    assert.equal(element.getStateColor(false), "red", name);
  }
});

test("layout and topology use the same railway classes and exclude buttons from tracks", () => {
  const layout = new LayoutView();
  layout.clearAll();
  const rail = new Straight(0, 0), button = new RouteButton(0, 1);
  layout.addElement(rail);
  layout.addElement(button);
  assert.deepEqual(layout.getTrackElements(), [rail]);
  layout.checkRoutes();
  assert.equal("isRoute" in button, false);
  const topology = buildRailwayTopologyFromLayout({
    version: 1,
    layers: [{ id: "track", name: "Track", elements: [rail.toJSON(), button.toJSON()] }],
  });
  assert.equal(topology.getAllElements().length, 1);
  assert.ok(topology.getPhysicalTrackElements()[0] instanceof Straight);
});

// SHA-256 hashes of recorded canvas calls captured before the hierarchy refactor.
// Cover all 15 railway shapes, eight rotations and two occupancy/turnout states.
const drawingBaseline = JSON.parse(
  await readFile(
    new URL("./fixtures/element-drawing.json", import.meta.url),
    "utf8"
  )
);

for (const [name, hashes] of Object.entries(drawingBaseline)) {
  test(`${name}: canvas output matches the pre-refactor baseline`, () => {
    const Class = classes.get(name);
    let index = 0;

    for (const rotation of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const element = new Class(2, 3);
      element.rotation = rotation;

      for (const occupied of [false, true]) {
        Object.assign(element, {
          occupied,
          turnoutClosed: occupied,
          turnout1Closed: occupied,
          turnout2Closed: occupied,
        });

        const { ctx, calls } = recordingCanvas();

        element.draw(ctx, {
          locos: [],
          showOccupancySensorAddress: true,
          showSensorAddress: true,
          showSignalAddress: true,
          showTurnoutAddress: true,
        });

        const hash = createHash("sha256")
          .update(JSON.stringify(calls))
          .digest("hex");

        assert.equal(
          hash,
          hashes[index++],
          `rotation=${rotation}, occupied=${occupied}`
        );
      }
    }
  });
}