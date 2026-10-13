import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = file => fs.readFileSync(path.join(repoRoot, file), "utf8");
const store = read("desktop/DCCExpressHub.Net/Web/ExternalDeviceStore.cs");
const runtime = read("desktop/DCCExpressHub.Net/Web/ExternalDevicesRuntime.cs");
const api = read("desktop/DCCExpressHub.Net/Web/WatsonWebServerService.ExternalDevices.cs");
const ws = read("desktop/DCCExpressHub.Net/Web/WsRuntimeCoordinator.cs");
const layout = read("desktop/DCCExpressHub.Net/Web/LayoutRuntime.cs");
const ui = read("web-ui/src/ExternalDevicesPage.tsx");

test("external S88 bytes/groups are persisted as 1-32 groups of eight inputs", () => {
  assert.match(store, /S88Bytes\s*\{\s*get;\s*init;/);
  assert.match(store, /SensorCount\s*=\s*bytes\s+is\s+>=\s*1\s+and\s+<=\s*32\s*\?\s*bytes\s*\*\s*8/);
  assert.match(store, /device\.S88Bytes\s*==\s*0/); // legacy SensorCount-only configs
  assert.match(store, /File\.Move\(temp, _file, true\)/);
  assert.match(api, /Get\(form, "s88Bytes"\)/);
  assert.match(api, /SensorCount\s*=\s*bytes\s*\*\s*8/);
  assert.match(ui, /label="S88 bytes \/ groups"/);
  assert.match(ui, /s88Bytes: String\(draft\.s88Bytes\)/);
});

test("device configuration verifies actual adapter firmware and only writes EEPROM if necessary", () => {
  assert.match(runtime, /"STATUS"/);
  assert.match(runtime, /"--- S88Adapter STATUS ---"/);
  assert.match(runtime, /"Active S88 bytes:"/);
  assert.match(runtime, /"EEPROM saved bytes:"/);
  assert.match(runtime, /"Serial staged bytes:"/);
  assert.match(runtime, /status\.Active != config\.S88Bytes/);
  assert.match(runtime, /"SET BYTES "\s*\+\s*config\.S88Bytes/);
  assert.match(runtime, /"SAVE"/);
  assert.match(runtime, /status = await StatusAsync\(\)/);
  assert.match(runtime, /"Adapter S88 bytes were not saved\/verified\."/);
});

test("changing COM port explicitly closes old worker before new connection is started", () => {
  const stop = runtime.indexOf("existing.Value.Cancellation.Cancel();");
  const awaitStop = runtime.indexOf("await existing.Value.Running;");
  const workerStart = runtime.indexOf("MonitorAdapterAsync(device, linked.Token)");
  assert.ok(stop >= 0 && awaitStop > stop && workerStart > awaitStop);
  assert.match(runtime, /port\?\.Dispose\(\)/);
  assert.match(api, /UpsertAsync\(proposed, ctx\.Token\)[\s\S]*ApplyConfigurationAsync\(CancellationToken\.None\)/);
  assert.match(api, /RemoveAsync\(Get\(form, "id"\), ctx\.Token\)[\s\S]*ApplyConfigurationAsync\(CancellationToken\.None\)/);
  assert.match(runtime, /SensorRangeUnavailable\?\.Invoke\(config\.SensorOffset \+ 1, config\.SensorCount\)/);
  assert.match(layout, /public void InvalidateSensorRange\(/);
});

test("external feedback does not saturate the Hub with unchanged snapshots", () => {
  assert.match(runtime, /previous\s+is\s+null\s*\|\|\s*previous\[i\]\s*!=\s*values\[i\]/);
  assert.match(runtime, /SensorFeedbackChanged\?\.Invoke\(config\.SensorOffset \+ i \+ 1, values\[i\]\)/);
  assert.match(ws, /externalDevices\.SensorFeedbackChanged\s*\+=\s*OnSensorFeedbackChanged/);
  assert.match(ws, /_externalDevices\.ReplayLiveSensorStates\(\)/);
  assert.match(layout, /Changed\?\.Invoke\("sensorSnapshot", SensorSnapshot\(\)\)/);
});

test("web UI owns device operations while backend owns serial port lifetime", () => {
  for (const action of ["save", "remove", "test"]) {
    assert.match(ui, new RegExp(`/api/external-devices/${action}`));
  }
  for (const label of ["Add device", "Monitor", "Edit", "Stop", "Start", "Delete"]) {
    assert.ok(ui.includes(label), `Missing ${label}`);
  }
  assert.match(runtime, /new SerialPort\(config\.SerialPort, 115200/);
  assert.doesNotMatch(ui, /new SerialPort\(/);
});
