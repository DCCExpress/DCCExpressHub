import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("mechanical counter renders configurable rolling drums", () => {
  const source = read("src/components/MechanicalCounter.tsx");
  const css = read("src/components/MechanicalCounter.css");

  assert.match(source, /digits\?: number/);
  assert.match(source, /decimals\?: number/);
  assert.match(source, /digitHeight\?: number/);
  assert.match(source, /accentFraction\?: boolean/);
  assert.match(source, /translateY\(-\$\{numeric \* 10\}%\)/);
  assert.match(source, /Intl\.NumberFormat/);
  assert.match(css, /mechanical-counter__housing/);
  assert.match(css, /mechanical-counter__digit--accent/);
  assert.match(css, /transition:[\s\S]*transform 260ms/);
  assert.match(css, /prefers-reduced-motion/);
});

test("locomotive model keeps only locomotive-specific counter calibration", () => {
  const domain = read("src/domain/domainTypes.ts");
  const settings = read("src/domain/locoCounterSettings.ts");
  const helpers = read("src/components/loco-dialog/locoDialogHelpers.ts");
  const editor = read("src/components/loco-dialog/LocoCounterSettingsPanel.tsx");

  assert.match(domain, /odometerKm\?: number/);
  assert.match(domain, /operatingHours\?: number/);
  assert.match(domain, /counterSettings\?: Partial<LocoCounterSettings>/);
  assert.match(
    domain,
    /export type LocoCounterSettings = \{[\s\S]*maxScaleSpeedKmh: number;[\s\S]*\};/
  );

  assert.doesNotMatch(
    domain,
    /export type LocoCounterSettings = \{[\s\S]*digits: number/
  );

  assert.match(settings, /maxScaleSpeedKmh:\s*120/);
  assert.doesNotMatch(settings, /digitHeight|distanceDecimals|accentFraction/);

  assert.match(helpers, /odometerKm:\s*0/);
  assert.match(helpers, /operatingHours:\s*0/);
  assert.match(helpers, /DEFAULT_LOCO_COUNTER_SETTINGS/);

  assert.match(editor, /counter_max_scale_speed/);
  assert.match(editor, /odometer_km/);
  assert.match(editor, /operating_hours/);
  assert.match(editor, /counter_display_global_hint/);

  assert.doesNotMatch(editor, /counters_enabled|counter_digits|counter_digit_height|counter_accent_fraction/);
});

test("LocoPanel uses global visibility and one Daily-or-Total value per counter", () => {
  const panel = read("src/layout/LocoPanel.tsx");
  const card = read("src/layout/loco-panel/LocoControlCard.tsx");
  const dialog = read("src/layout/loco-panel/LocoPanelSettingsDialog.tsx");
  const displaySettings = read("src/services/locoPanelCounterDisplaySettings.ts");

  assert.match(panel, /IconSettings/);
  assert.match(panel, /LocoPanelSettingsDialog/);
  assert.match(panel, /top:\s*2/);
  assert.match(panel, /counterDisplaySettings/);
  assert.doesNotMatch(panel, /toggleDailyCounters/);

  assert.match(dialog, /show_km/);
  assert.match(dialog, /show_worktime/);
  assert.match(dialog, /counter_digits/);
  assert.match(dialog, /counter_digit_height/);
  assert.match(dialog, /counter_km_decimals/);
  assert.match(dialog, /counter_worktime_decimals/);
  assert.match(dialog, /counter_accent_fraction/);
  assert.match(dialog, /counter_daily_mode/);
  assert.match(dialog, /settings\.daily/);

  assert.match(displaySettings, /showKm:\s*true/);
  assert.match(displaySettings, /showWorktime:\s*true/);
  assert.match(displaySettings, /daily:\s*false/);
  assert.match(displaySettings, /digitHeight:\s*24/);
  assert.match(displaySettings, /counter-display-settings\.v2/);
  assert.match(displaySettings, /LEGACY_STORAGE_KEY/);
  assert.match(displaySettings, /digitHeight:[\s\S]*-\s*4/);
  assert.match(displaySettings, /localStorage/);

  assert.match(card, /counterDisplaySettings\.showKm/);
  assert.match(card, /counterDisplaySettings\.showWorktime/);
  assert.match(card, /counterDisplaySettings\.daily/);
  assert.doesNotMatch(card, />\s*D\s*</);
  assert.doesNotMatch(card, /onToggleCounterDaily/);

  assert.equal(
    (card.match(/<MechanicalCounter/g) || []).length,
    3
  );

  assert.match(
    card,
    /counterDisplaySettings\.daily[\s\S]*\? dailyKm[\s\S]*: totalKm/
  );

  assert.match(
    card,
    /counterDisplaySettings\.daily[\s\S]*\? dailyHours[\s\S]*: totalHours/
  );

  assert.match(
    card,
    /resolveLocoCounterSettings/
  );

  assert.match(
    card,
    /targetSpeedKmh/
  );

  assert.match(
    card,
    /displayedSpeedKmh/
  );

  assert.match(
    card,
    /requestAnimationFrame/
  );

  assert.match(
    card,
    /digits=\{3\}/
  );

  assert.match(
    card,
    /digitHeight=\{30\}/
  );

  assert.match(
    card,
    /unit="km\/h"/
  );
});


test("frontend counter runtime only mirrors backend snapshots", () => {
  const runtime = read("src/services/locoCounterRuntime.ts");
  const app = read("src/App.tsx");

  assert.match(
    runtime,
    /wsClient\.on\([\s\S]*"locoCounterSnapshot"/
  );

  assert.match(
    runtime,
    /snapshots\.set/
  );

  assert.doesNotMatch(
    runtime,
    /setInterval|saveLocos|getLocos|elapsedHours|speedRatio/
  );

  assert.match(
    app,
    /installLocoCounterRuntime/
  );

  assert.doesNotMatch(
    app,
    /configureLocoCounterRuntime/
  );
});

test("ESP32 backend owns locomotive counter integration and checkpoint saves", () => {
  const runtime = read("../src/LocoCounterRuntime.cpp");
  const ws = read("../src/WsProtocol.cpp");
  const api = read("../src/ApiServer.cpp");

  assert.match(
    runtime,
    /elapsedMs[\s\S]*3600000\.0/
  );

  assert.match(
    runtime,
    /maxScaleSpeedKmh[\s\S]*speedRatio[\s\S]*elapsedHours/
  );

  assert.match(
    runtime,
    /dailyHours \+=/
  );

  assert.match(
    runtime,
    /dailyKm \+=/
  );

  assert.match(
    ws,
    /_locoCounters\.updateLoco/
  );

  assert.match(
    ws,
    /_locoCounters\.setTrackPower/
  );

  assert.match(
    ws,
    /wasMainOn[\s\S]*!_trackPower[\s\S]*_locoCounters\.requestSave/
  );

  assert.match(
    api,
    /_locoCounters\.requestSave/
  );

  assert.match(
    runtime,
    /_saveRequested[\s\S]*save\(\)/
  );

  assert.match(
    ws,
    /"locoCounterSnapshot"/
  );
});

test(".NET backend owns locomotive counter integration and checkpoint saves", () => {
  const runtime = read("../desktop/DCCExpressHub.Net/Web/LocoCounterRuntime.cs");
  const ws = read("../desktop/DCCExpressHub.Net/Web/WsHub.cs");
  const program = read("../desktop/DCCExpressHub.Net/Program.cs");

  assert.match(
    runtime,
    /elapsedMs[\s\S]*3_600_000\.0/
  );

  assert.match(
    runtime,
    /MaxScaleSpeedKmh[\s\S]*speedRatio[\s\S]*elapsedHours/
  );

  assert.match(
    runtime,
    /DailyHours \+=/
  );

  assert.match(
    runtime,
    /DailyKm \+=/
  );

  assert.match(
    ws,
    /LocoCounters\.UpdateLoco/
  );

  assert.match(
    ws,
    /LocoCounters\.SetTrackPower/
  );

  assert.match(
    ws,
    /wasMainOn[\s\S]*!HubState\.TrackPower[\s\S]*LocoCounters\.SaveAsync/
  );

  assert.match(
    program,
    /locoCountersSaved[\s\S]*counters\.SaveAsync/
  );

  assert.match(
    ws,
    /"locoCounterSnapshot"/
  );
});
