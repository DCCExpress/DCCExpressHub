import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { load } from "./editor-test-runtime.mjs";

const { ButtonElement } = await load("models/editor/elements/ButtonElement");
const { wsApi } = await load("services/wsApi");

test("Button exposes DCC-EX VPIN and accessory address/id", () => {
  const button = new ButtonElement(0, 0);
  const props = button.getEditableProperties();
  const output = props.find(property => property.key === "outputMode");
  assert.deepEqual(output.options.map(item => item.value), ["accessory", "extended", "vpin"]);
  button.outputMode = "vpin";
  const address = button.getEditableProperties().find(property => property.key === "address");
  assert.match(address.label, /Accessory address\/id/i);
  assert.equal(address.max, 32767);
});

test("Button VPIN ON/OFF uses <z> transport and survives serialization", () => {
  const button = new ButtonElement(0, 0);
  button.outputMode = "vpin";
  button.address = 3001;
  button.activeValue = false;
  button.offValue = true;
  const sent = [];
  const originalVpin = wsApi.setVpin;
  const originalBasic = wsApi.setBasicAccessory;
  wsApi.setVpin = (...args) => { sent.push(["vpin", ...args]); return true; };
  wsApi.setBasicAccessory = (...args) => { sent.push(["basic", ...args]); return true; };
  try {
    assert.equal(button.sendConfiguredState(true), true);
    assert.equal(button.on, true, "VPIN button lights up when the command is queued");
    assert.equal(button.sendConfiguredState(false), true);
    assert.equal(button.on, false, "VPIN button turns off on the OFF command");
    assert.deepEqual(sent, [["vpin", 3001, false], ["vpin", 3001, true]]);
    assert.equal(button.toJSON().outputMode, "vpin");
    const loaded = ButtonElement.fromJSON(button.toJSON());
    assert.equal(loaded.outputMode, "vpin");
    assert.equal(loaded.address, 3001);
    assert.equal(loaded.clone().outputMode, "vpin");
    assert.equal(button.sendConfiguredState(true), true);
    button.address = 32768;
    assert.equal(button.sendConfiguredState(true), false);
  } finally {
    wsApi.setVpin = originalVpin;
    wsApi.setBasicAccessory = originalBasic;
  }
});

test("Backend registers VPIN buttons in VPIN topology, not DCC accessory", () => {
  const runtime = readFileSync(new URL("../../desktop/DCCExpressHub.Net/Web/LayoutRuntime.cs", import.meta.url), "utf8");
  const start = runtime.indexOf('if (type == "button")');
  const end = runtime.indexOf("public RuntimeAccessory? FindAccessoryById", start);
  const section = runtime.slice(start, end);
  assert.match(section, /mode == "vpin"/);
  assert.match(section, /vpinTopology.Add/);
  assert.match(section, /RuntimeAccessoryKind.VPin/);
  assert.match(section, /basicTopology.Add/);
});

test("VPIN Button does not illuminate if the command cannot be queued", () => {
  const button = new ButtonElement(0, 0);
  button.outputMode = "vpin";
  button.address = 3010;
  const original = wsApi.setVpin;
  wsApi.setVpin = () => false;
  try {
    assert.equal(button.sendConfiguredState(true), false);
    assert.equal(button.on, false);
  } finally {
    wsApi.setVpin = original;
  }
});
