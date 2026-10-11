import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("system info panel titles come from selected command-center protocol", () => {
  const source = read("src/components/SystemInfoPanel.tsx");
  assert.match(source, /commandCenter\.type\s*\|\|\s*telemetry\?\.commandCenterType/);
  assert.match(source, /isLocoNetSerial \? "LocoNet Serial"/);
  assert.match(source, /isLocoNetTcp \? "LocoNet TCP"/);
  assert.match(source, /isZ21 \? "Z21"/);
  assert.match(source, /isDccEx \? \(transport === "serial" \? "DCC-EX Serial" : "DCC-EX TCP"\)/);
  assert.doesNotMatch(source, /DCC-EX \/ EX-CSB1/);
});

test("LocoNet must not fall through to DCC-EX version, motor or current diagnostics", () => {
  const source = read("src/components/SystemInfoPanel.tsx");
  assert.match(source, /\{isLocoNet \? \(/);
  assert.match(source, /\{isDccEx && \(/);
  assert.match(source, /tracks\.length === 0 && \(isDccEx \|\| isZ21\)/);
  assert.match(source, /\{isLocoNet && \(/);
  assert.match(source, /locoNetStandard\?\.trackCurrentMa/);
  assert.match(source, /locoNetStandard\?\.trackVoltageV/);
  assert.match(source, /locoNetStandard\?\.temperatureC/);
  assert.match(source, /locoNetStandard\.rxFrames/);
  assert.match(source, /locoNetStandard\.txFrames/);
  assert.match(source, /: "NA"/);
});

test("generic LocoNet serial and TCP drivers must not claim a specific model", () => {
  const serial = read("../desktop/DCCExpressHub.Net/CommandCenter/LocoNetSerialCommandCenter.cs");
  const tcp = read("../desktop/DCCExpressHub.Net/CommandCenter/LocoNetTcpCommandCenter.cs");
  assert.doesNotMatch(serial, /Hardware: "YD7010"/);
  assert.doesNotMatch(tcp, /Hardware: "YD7010/);
  assert.match(serial, /Interlocked\.Increment\(ref _rxPackets\)/);
  assert.match(serial, /Interlocked\.Increment\(ref _txPackets\)/);
});

test("serial LocoNet runtime diagnostics flow through backend and WebSocket", () => {
  const status = read("../desktop/DCCExpressHub.Net/Web/WsHub.cs");
  const cc = read("../desktop/DCCExpressHub.Net/CommandCenter/ConfiguredCommandCenter.cs");
  const types = read("src/domain/commandCenterTelemetry.ts");
  assert.match(status, /GetLocoNetSerialDiagnostics\(\)/);
  assert.match(status, /linkUptimeMs = locoNetSerial\.LinkUptimeMs/);
  assert.match(status, /rxPackets = locoNetSerial\.RxPackets/);
  assert.match(status, /txPackets = locoNetSerial\.TxPackets/);
  assert.match(cc, /GetLocoNetSerialDiagnostics\(\)/);
  assert.match(types, /locoNetSerial\?: \{/);
});

test("LocoNet Serial and TCP use one validated standard telemetry monitor", () => {
  const monitor = read("../desktop/DCCExpressHub.Net/CommandCenter/LocoNetStandardTelemetry.cs");
  const serial = read("../desktop/DCCExpressHub.Net/CommandCenter/LocoNetSerialCommandCenter.cs");
  const tcp = read("../desktop/DCCExpressHub.Net/CommandCenter/LocoNetTcpCommandCenter.cs");
  const bridge = read("../desktop/DCCExpressHub.Net/CommandCenter/ConfiguredCommandCenter.cs");
  const status = read("../desktop/DCCExpressHub.Net/Web/WsHub.cs");
  const contract = read("src/domain/commandCenterTelemetry.ts");
  assert.match(monitor, /checksum != 0xFF\) return/);
  assert.match(monitor, /packet\[0\] is 0x82 or 0x83/);
  assert.match(monitor, /TrackCurrentMa: null/);
  assert.match(monitor, /TrackVoltageV: null/);
  assert.match(monitor, /TemperatureC: null/);
  for (const driver of [serial, tcp]) {
    assert.match(driver, /_standardTelemetry\.ObserveReceived\(/);
    assert.match(driver, /_standardTelemetry\.ObserveTransmitted\(\)/);
    assert.match(driver, /_standardTelemetry\.Reset\(\)/);
    assert.match(driver, /StandardTelemetry => _standardTelemetry\.Snapshot\(\)/);
  }
  assert.match(bridge, /LocoNetSerialCommandCenter serial => serial\.StandardTelemetry/);
  assert.match(bridge, /LocoNetTcpCommandCenter tcp => tcp\.StandardTelemetry/);
  assert.match(status, /reportedTrackPowerOn = locoNetStandard\.ReportedTrackPowerOn/);
  assert.match(contract, /locoNetStandard\?: \{/);
});

test("all three languages define LocoNet telemetry labels", () => {
  for (const lang of ["en", "hu", "de"]) {
    const ui = JSON.parse(read(`src/i18n/ui.${lang}.json`));
    for (const key of [
      "locoNetTrackCurrent", "locoNetTrackVoltage", "locoNetTemperature",
      "locoNetReportedPower", "locoNetRxFrames", "locoNetTxFrames",
      "locoNetSensorReports", "locoNetTurnoutReports", "locoNetDiagnosticHint"
    ]) assert.ok(ui[key], `${lang} missing ${key}`);
  }
});
