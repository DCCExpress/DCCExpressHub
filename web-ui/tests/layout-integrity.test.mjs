import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./editor-test-runtime.mjs";

const { LayoutView } = await load("models/editor/core/LayoutView");
const { RouteButtonElement } = await load("models/editor/elements/RouteButtonElement");
const { default: TrackTurnoutDoubleElement } = await load("models/editor/elements/TrackTurnoutDoubleElement");
const { TrackTurnoutThreeWayElement } = await load("models/editor/elements/TrackTurnoutThreeWayElement");
const { inspectProjectIntegrity } = await load("services/layoutIntegrity");

test("route integrity accepts Double and ThreeWay turnouts", () => {
  const layout = new LayoutView();
  layout.clearAll();

  const doubleTurnout = new TrackTurnoutDoubleElement(0, 0);
  const threeWayTurnout = new TrackTurnoutThreeWayElement(4, 0);
  const route = new RouteButtonElement(0, 4);

  layout.addElement(doubleTurnout, doubleTurnout.layerName);
  layout.addElement(threeWayTurnout, threeWayTurnout.layerName);
  layout.addElement(route, route.layerName);

  route.routeTurnouts = [
    {
      turnoutId: doubleTurnout.id,
      closed: false,
      secondClosed: false,
    },
    {
      turnoutId: threeWayTurnout.id,
      closed: true,
      secondClosed: false,
    },
  ];

  const report = inspectProjectIntegrity(
    layout,
    [],
    null
  );

  const routeArea = report.areas.find(
    area => area.area === "Route buttons"
  );

  assert.ok(routeArea);
  assert.equal(routeArea.checked, 1);
  assert.deepEqual(
    routeArea.issues.filter(issue => issue.level === "error"),
    []
  );
});
