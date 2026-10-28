import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./editor-test-runtime.mjs";

const { LayoutView } = await load("models/editor/core/LayoutView");
const { RouteButtonElement } = await load("models/editor/elements/RouteButtonElement");
const { TrackTurnoutLeftElement } = await load("models/editor/elements/TrackTurnoutLeftElement");
const { TrackTurnoutThreeWayElement } = await load("models/editor/elements/TrackTurnoutThreeWayElement");
const { executeLegacyRouteButton } = await load("services/routeButtonExecutor");
const { setSwitchManModeEnabled } = await load("services/switchManModeRuntime");
const { wsApi } = await load("services/wsApi");
const { wsClient } = await load("services/wsClient");

function createRoute(...turnouts) {
  const layout = new LayoutView();
  layout.clearAll();
  for (const turnout of turnouts) layout.addElement(turnout, turnout.layerName);
  const route = new RouteButtonElement(0, -5);
  layout.addElement(route, route.layerName);
  route.routeTurnouts = turnouts.map(t => ({
    turnoutId: t.id,
    closed: true,
    ...(t.turnout2Address === undefined ? {} : { secondClosed: true }),
  }));
  return { layout, route };
}

test("SwitchMan RouteButton locks every motor before setting, without the legacy route lock", async () => {
  const one = new TrackTurnoutLeftElement(0, 0);
  one.turnoutAddress = 25;
  one.turnoutClosedValue = false;
  const pair = new TrackTurnoutThreeWayElement(1, 0);
  pair.turnout1Address = 20;
  pair.turnout2Address = 21;
  pair.turnout1ClosedValue = true;
  pair.turnout2ClosedValue = false;
  const { layout, route } = createRoute(one, pair);

  const originalSubscribe = wsClient.subscribeMessages;
  const originalSend = wsClient.send;
  const originalRouteLock = wsApi.routeLock;
  const originalRouteUnlock = wsApi.routeUnlock;
  const originalSetTurnout = wsApi.setTurnout;
  const listeners = new Set();
  const sent = [];
  const busy = [];
  let legacyCommands = 0;
  let rejectAcquisition = false;

  wsClient.subscribeMessages = listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  wsClient.send = message => {
    sent.push(message);
    if (message.type === "switchManCommand") {
      const { requestId, action } = message.data;
      queueMicrotask(() => {
        for (const listener of listeners) listener({
          type: "switchManResponse",
          data: {
            requestId, action,
            ok: !(rejectAcquisition && action === "acquire"),
            message: rejectAcquisition && action === "acquire" ? "turnout_locked" : null,
            extra: { locks: [], conflicts: [] },
          },
        });
      });
    }
    return true;
  };
  wsApi.routeLock = () => { legacyCommands++; return true; };
  wsApi.routeUnlock = () => { legacyCommands++; return true; };
  wsApi.setTurnout = () => { legacyCommands++; return true; };
  try {
    await setSwitchManModeEnabled(true);
    const succeeded = await executeLegacyRouteButton({
      routeButton: route, layout, commandCenterLocked: false,
      setBusy: value => busy.push(value),
    });
    assert.equal(succeeded, true);
    const calls = sent.filter(message => message.type === "switchManCommand");
    assert.deepEqual(calls.map(message => message.data.action), ["acquire", "set", "set", "set"]);
    assert.deepEqual(calls[0].data.addresses, [25, 20, 21]);
    assert.deepEqual(calls.slice(1).map(message => [message.data.address, message.data.closed]), [
      [25, false], [20, true], [21, false],
    ]);
    assert.equal(legacyCommands, 0);
    assert.deepEqual(busy, [true, false]);
    assert.equal(one.turnoutClosed, true);
    assert.equal(pair.turnout1Closed, true);
    assert.equal(pair.turnout2Closed, true);

    // A conflicting lock rejects the entire route, before any motor command.
    const second = new TrackTurnoutLeftElement(3, 0);
    second.turnoutAddress = 30;
    const rejected = createRoute(second);
    const before = sent.length;
    rejectAcquisition = true;
    assert.equal(await executeLegacyRouteButton({
      routeButton: rejected.route, layout: rejected.layout, commandCenterLocked: false,
    }), false);
    assert.deepEqual(
      sent.slice(before).filter(message => message.type === "switchManCommand")
        .map(message => message.data.action),
      ["acquire"]
    );
    assert.equal(second.turnoutClosed, false);
    assert.equal(legacyCommands, 0);
    rejectAcquisition = false;

    // The planner must not send a partial route if two configured elements
    // require contradictory logical states for the same DCC address.
    const duplicate = new TrackTurnoutLeftElement(4, 0);
    duplicate.turnoutAddress = 25;
    duplicate.turnoutClosedValue = true;
    const conflicting = createRoute(one, duplicate);
    const prior = sent.length;
    assert.equal(await executeLegacyRouteButton({
      routeButton: conflicting.route, layout: conflicting.layout, commandCenterLocked: false,
    }), false);
    assert.equal(sent.length, prior);
  } finally {
    rejectAcquisition = false;
    await setSwitchManModeEnabled(false);
    wsClient.subscribeMessages = originalSubscribe;
    wsClient.send = originalSend;
    wsApi.routeLock = originalRouteLock;
    wsApi.routeUnlock = originalRouteUnlock;
    wsApi.setTurnout = originalSetTurnout;
  }
});
