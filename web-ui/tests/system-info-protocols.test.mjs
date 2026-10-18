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

test("one LocoNet protocol driver implements CV, POM, slots, sensors and E-STOP", () => {
  const cc = read("../desktop/DCCExpressHub.Net/CommandCenter/LocoNetCommandCenter.cs");
  assert.match(cc, /class LocoNetCommandCenter : BackgroundService, ICommandCenter/);
  assert.match(cc, /public string Type => "loconet"/);
  assert.match(cc, /ReadServiceCvAsync/);
  assert.match(cc, /WriteServiceCvAsync/);
  assert.match(cc, /ReadPomCvAsync/);
  assert.match(cc, /WritePomCvAsync/);
  assert.match(cc, /WriteAccessoryPomCvAsync/);
  assert.match(cc, /AcquireSlotAsync/);
  assert.match(cc, /SetLocoFunctionAsync/);
  assert.match(cc, /SetTurnoutAsync/);
  assert.match(cc, /SensorFeedbackChanged\?\.Invoke/);
  assert.match(cc, /EmergencyStopAsync/);
  assert.match(cc, /_transport\.SendFrameAsync\(frame, ct\)/);
  assert.match(cc, /_standardTelemetry\.ObserveReceived\(rawPacket\)/);
  assert.match(cc, /_standardTelemetry\.ObserveTransmitted\(\)/);
  assert.doesNotMatch(cc, /SerialPort|TcpClient|StreamWriter/);
  assert.doesNotMatch(cc, /Type => "loconet-serial"/);
});

test("LocoNet transports only frame packets; they do not program CVs", () => {
  const serial = read("../desktop/DCCExpressHub.Net/CommandCenter/LocoNetSerialTransport.cs");
  const tcp = read("../desktop/DCCExpressHub.Net/CommandCenter/LocoNetTcpTransport.cs");
  const transport = read("../desktop/DCCExpressHub.Net/CommandCenter/ILocoNetTransport.cs");
  assert.match(transport, /interface ILocoNetTransport/);
  for (const implementation of [serial, tcp]) {
    assert.match(implementation, /: ILocoNetTransport/);
    assert.match(implementation, /RunSessionAsync\(Action<byte\[\]> received/);
    assert.match(implementation, /SendFrameAsync\(ReadOnlyMemory<byte> frame/);
    assert.doesNotMatch(implementation, /ProgramCvAsync|SetTurnoutAsync|AcquireSlotAsync/);
  }
  assert.match(serial, /SerialPort\(Endpoint, BaudRate/);
  assert.match(serial, /received\(frame\.AsSpan\(0, count\)\.ToArray\(\)\)/);
  assert.match(tcp, /line\.StartsWith\("RECEIVE "/);
  assert.match(tcp, /"SEND " \+ string\.Join/);
});

test("both LocoNet runtime transports resolve to one command center", () => {
  const program = read("../desktop/DCCExpressHub.Net/Program.cs");
  const bridge = read("../desktop/DCCExpressHub.Net/CommandCenter/ConfiguredCommandCenter.cs");
  const ws = read("../desktop/DCCExpressHub.Net/Web/WsHub.cs");
  assert.match(program, /if \(useLocoNetSerial \|\| useLocoNetTcp\)/);
  assert.match(program, /AddSingleton<ILocoNetTransport>/);
  assert.match(program, /new LocoNetSerialTransport/);
  assert.match(program, /new LocoNetTcpTransport/);
  assert.match(program, /AddSingleton<LocoNetCommandCenter>/);
  assert.match(program, /GetRequiredService<LocoNetCommandCenter>/);
  assert.doesNotMatch(program, /AddSingleton<LocoNetSerialCommandCenter>|AddSingleton<LocoNetTcpCommandCenter>/);
  assert.match(bridge, /_inner is LocoNetCommandCenter loconet/);
  assert.match(ws, /CommandCenter\.Type,\s*"loconet"/);
  assert.match(ws, /ReadServiceCvAsync\(cv, ct\)/);
  assert.match(ws, /WriteServiceCvAsync\(cv, value, ct\)/);
  assert.match(ws, /ReadPomCvAsync\(address, cv, ct\)/);
  assert.match(ws, /WritePomCvAsync\(address, cv, value, ct\)/);
});

test("protocol-specific info panel uses connection transport rather than distinct protocol", () => {
  const source = read("src/components/SystemInfoPanel.tsx");
  const bridge = read("../desktop/DCCExpressHub.Net/CommandCenter/ConfiguredCommandCenter.cs");
  const ws = read("../desktop/DCCExpressHub.Net/Web/WsHub.cs");
  const status = read("src/domain/commandCenterTelemetry.ts");
  assert.match(source, /protocolType === "loconet" && \(transport === "serial"/);
  assert.match(source, /locoNetStandard\.rxFrames/);
  assert.match(source, /locoNetStandard\.txFrames/);
  assert.match(source, /: "NA"/);
  assert.match(ws, /GetLocoNetSerialDiagnostics\(\)/);
  assert.match(ws, /linkUptimeMs = locoNetSerial\.LinkUptimeMs/);
  assert.match(ws, /rxPackets = locoNetSerial\.RxPackets/);
  assert.match(ws, /reportedTrackPowerOn = locoNetStandard\.ReportedTrackPowerOn/);
  assert.match(bridge, /GetLocoNetStandardTelemetry/);
  assert.match(status, /locoNetSerial\?: \{/);
  assert.match(status, /locoNetStandard\?: \{/);
});

test("LocoNet power and packet diagnostics remain conservative and standardized", () => {
  const monitor = read("../desktop/DCCExpressHub.Net/CommandCenter/LocoNetStandardTelemetry.cs");
  assert.match(monitor, /checksum != 0xFF\) return/);
  assert.match(monitor, /packet\[0\] is 0x82 or 0x83/);
  assert.match(monitor, /TrackCurrentMa: null/);
  assert.match(monitor, /TrackVoltageV: null/);
  assert.match(monitor, /TemperatureC: null/);
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

test("LocoNet CV reads default to one attempt and fixed settle time", () => {
  const cc = read("../desktop/DCCExpressHub.Net/CommandCenter/LocoNetCommandCenter.cs");
  const required = [
    'config.GetValue("LocoNet:ServiceReadAttempts", 1)',
    "int attempts = !write && address == 0 ? _serviceReadAttempts : 1",
    "ServiceTrackSpacingMs = 100",
    "Task.Delay(ServiceTrackSpacingMs, CancellationToken.None)",
    "response={ResponseMs} ms",
    "response {responseMs} ms; attempts {attempt}"
  ];
  for (const phrase of required)
    assert.ok(cc.includes(phrase), "Missing CV timing guard: " + phrase);
  assert.ok(!cc.includes("_serviceRecoveryMs"), "Adaptive extra delays must stay removed");
  assert.ok(!cc.includes("const int maxAttempts = 3"), "Three hidden reads must stay removed");
});
