import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const layout = readFileSync(
  new URL("../../desktop/DCCExpressHub.Net/Web/LayoutRuntime.cs", import.meta.url),
  "utf8",
);
const movement = readFileSync(
  new URL("../../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs", import.meta.url),
  "utf8",
);
const dialog = readFileSync(
  new URL("../src/components/SafetyEmergencyStopDialog.tsx", import.meta.url),
  "utf8",
);

test("reed ON checks every block mapping before committing a target", () => {
  assert.match(layout, /var blocks = _blocks\s*\.Where\(block => block\.SensorAddress == address\)/);
  assert.match(layout, /blocks\.Length == 1 &&\s*blocks\[0\]\.TargetOnly/);
  assert.match(layout, /else if \(changed &&\s*\(blocks\.Length > 1 \|\|\s*\(blocks\.Length == 1 && !blocks\[0\]\.Occupied\)\)\)/);
  assert.match(layout, /UnexpectedReedSensorOn\?\.Invoke\(address\)/);
});

test("unexpected reed ON uses the existing Movement safety E-STOP pipeline", () => {
  assert.match(movement, /_layout\.UnexpectedReedSensorOn \+=\s*OnUnexpectedReedSensorOn/);
  assert.match(movement, /void OnUnexpectedReedSensorOn\(ushort sensorAddress\)/);
  assert.match(movement, /if \(blocks\.Length == 0\)\s*return;/);
  assert.match(movement, /ambiguous \? "ambiguous_reed_sensor" : "unexpected_reed_sensor"/);
  assert.match(movement, /_ = TripOccupancySafetyAsync\(trip\)/);
  assert.match(movement, /await PublishSafetyEmergencyStopAsync\(\s*trip\)/);
  assert.doesNotMatch(
    movement.match(/async Task TripOccupancySafetyAsync\([\s\S]*?\n    void EmitTrainEvent\(/)?.[0] ?? "",
    /if \(executions\.Length == 0\)\s*return;/,
    "reed safety must still request E-STOP without an active Movement",
  );
});

test("safety dialog identifies reed errors independently from occupancy", () => {
  assert.match(dialog, /ui\.safetyUnexpectedReedSensor/);
  assert.match(dialog, /ui\.safetyAmbiguousReedSensor/);
  for (const lang of ["en", "hu", "de"]) {
    const translations = JSON.parse(readFileSync(
      new URL(`../src/i18n/ui.${lang}.json`, import.meta.url),
      "utf8",
    ));
    assert.ok(translations.safetyUnexpectedReedSensor);
    assert.ok(translations.safetyAmbiguousReedSensor);
  }
});
