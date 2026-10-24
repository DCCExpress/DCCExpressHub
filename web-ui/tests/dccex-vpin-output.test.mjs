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

test("turnout editor retains the VPIN mode alongside DCC basic and extended", () => {
  assert.deepEqual(
    TURNOUT_OUTPUT_MODE_OPTIONS.map(option => option.value),
    ["accessory", "extended", "vpin"]
  );
  assert.equal(normalizeTurnoutOutputMode("vpin"), "vpin");
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
