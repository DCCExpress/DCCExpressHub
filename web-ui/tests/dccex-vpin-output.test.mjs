import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { load } from "./editor-test-runtime.mjs";

const { wsApi } = await load("services/wsApi");
const {
  sendTurnoutOutput,
  TURNOUT_OUTPUT_MODE_OPTIONS,
} = await load("services/layoutOutput");
const {
  normalizeTurnoutOutputMode,
} = await load("models/editor/turnout/turnoutAccessoryHelpers");
const { TrackSignalElement } = await load("models/editor/elements/TrackSignalElement");
const { createDefaultSignalOutputConfiguration } = await load("domain/layout/signalOutput");

test("turnout editor hides direct VPIN but preserves existing layouts and signal VPIN", () => {
  assert.deepEqual(
    TURNOUT_OUTPUT_MODE_OPTIONS.map(option => option.value),
    ["accessory", "extended", "dccex-turnout"]
  );
  assert.equal(normalizeTurnoutOutputMode("vpin"), "vpin");
  assert.equal(normalizeTurnoutOutputMode("dccex-turnout"), "dccex-turnout");
  assert.equal(normalizeTurnoutOutputMode("extended"), "extended");
  assert.equal(normalizeTurnoutOutputMode(undefined), "accessory");
});

test("VPIN turnout sends binary state without emitting an accessory command", () => {
  const sent = [];
  const oldVpin = wsApi.setVpin;
  const oldTurnout = wsApi.setTurnout;
  wsApi.setVpin = (...args) => { sent.push(["vpin", ...args]); return true; };
  wsApi.setTurnout = (...args) => { sent.push(["accessory", ...args]); return true; };
  try {
    assert.equal(sendTurnoutOutput("vpin", 4096, true), true);
    assert.equal(sendTurnoutOutput("vpin", 4096, false), true);
    assert.equal(sendTurnoutOutput("accessory", 4096, true), false);
    assert.equal(sendTurnoutOutput("vpin", 32768, true), false);
    assert.deepEqual(sent, [["vpin", 4096, true], ["vpin", 4096, false]]);
  } finally {
    wsApi.setVpin = oldVpin;
    wsApi.setTurnout = oldTurnout;
  }
});

test("signal states map consecutive DCC-EX VPINs to HIGH and LOW", () => {
  const sent = [];
  const oldVpin = wsApi.setVpin;
  const oldBasic = wsApi.setBasicAccessory;
  wsApi.setVpin = (...args) => { sent.push(["vpin", ...args]); return true; };
  wsApi.setBasicAccessory = (...args) => { sent.push(["basic", ...args]); return true; };
  try {
    const signal = new TrackSignalElement(0, 0);
    const config = createDefaultSignalOutputConfiguration(3001, 2);
    config.protocol = "vpin";
    signal.setSignalOutput(config);
    signal.sendState(config.states[0]);
    assert.deepEqual(sent, [
      ["vpin", 3001, true],
      ["vpin", 3002, false],
    ]);
    signal.setValue(3001, false, "vpin");
    signal.setValue(3002, true, "vpin");
    assert.equal(signal.currentStateIndex, 1);
  } finally {
    wsApi.setVpin = oldVpin;
    wsApi.setBasicAccessory = oldBasic;
  }
});

test("legacy VPIN signals are loaded with VPIN output mode", () => {
  const original = new TrackSignalElement(0, 0).toJSON();
  delete original.signalOutput;
  original.outputMode = "vpin";
  original.address = 3001;
  const migrated = TrackSignalElement.fromJSON(original);
  assert.equal(migrated.signalOutput.protocol, "vpin");
  assert.equal(migrated.signalOutput.address, 3001);
});

test("Windows signal automation uses VPIN output transport, not a DCC accessory", () => {
  const source = fs.readFileSync(
    new URL("../../desktop/DCCExpressHub.Net/Web/SignalAutomationEngine.cs", import.meta.url),
    "utf8"
  );
  const runtime = fs.readFileSync(
    new URL("../../desktop/DCCExpressHub.Net/Web/LayoutRuntime.cs", import.meta.url),
    "utf8"
  );
  assert.match(source, /mode == "vpin"/);
  assert.match(source, /SetVPinAsync\(address, active\)/);
  assert.match(source, /_runtime\.SetVPin\(address, active\)/);
  assert.match(runtime, /SignalVPin = signalVPin/);
  assert.match(runtime, /AddRange\(vpinTopology, address, outputCount\)/);
});

test("native DCC-EX turnout sends T ID commands for both physical bit states", () => {
  const sent = [];
  const oldNative = wsApi.setDccExTurnout;
  const oldBasic = wsApi.setTurnout;
  wsApi.setDccExTurnout = (...args) => { sent.push(["T", ...args]); return true; };
  wsApi.setTurnout = (...args) => { sent.push(["basic", ...args]); return true; };
  try {
    assert.equal(sendTurnoutOutput("dccex-turnout", 1, true), true);
    assert.equal(sendTurnoutOutput("dccex-turnout", 1, false), true);
    assert.equal(sendTurnoutOutput("dccex-turnout", 32767, true), true);
    assert.equal(sendTurnoutOutput("dccex-turnout", 32768, true), false);
    assert.deepEqual(sent, [
      ["T", 1, true],
      ["T", 1, false],
      ["T", 32767, true],
    ]);
  } finally {
    wsApi.setDccExTurnout = oldNative;
    wsApi.setTurnout = oldBasic;
  }
});

test("unsaved native turnout tests do not require a saved runtime binding, but retain SwitchMan locks", () => {
  const hub = fs.readFileSync(
    new URL("../../desktop/DCCExpressHub.Net/Web/WsHub.cs", import.meta.url),
    "utf8"
  );
  const start = hub.indexOf('case "setDccExTurnout":');
  const end = hub.indexOf('case "setSignalAspect":', start);
  assert.ok(start >= 0 && end > start);
  const handler = hub.slice(start, end);
  assert.match(handler, /AcquireManualTurnoutOperation\(ws, address, ct, 32767\)/);
  assert.match(handler, /SetDccExTurnoutAsync\(address, thrown, ct\)/);
  assert.doesNotMatch(handler, /TurnoutDccExId != true/);
  assert.match(handler, /saved\?\.TurnoutDccExId == true/);
  assert.match(hub, /ushort maxAddress = 2048/);
  const locks = fs.readFileSync(
    new URL("../../desktop/DCCExpressHub.Net/Web/SwitchManManager.cs", import.meta.url),
    "utf8"
  );
  assert.match(locks, /x is >= 1 and <= 32767/);
});
