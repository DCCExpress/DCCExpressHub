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

test("locomotive model persists mechanical counter values and settings", () => {
  const domain = read("src/domain/domainTypes.ts");
  const settings = read("src/domain/locoCounterSettings.ts");
  const helpers = read("src/components/loco-dialog/locoDialogHelpers.ts");
  const editor = read("src/components/loco-dialog/LocoCounterSettingsPanel.tsx");

  assert.match(domain, /odometerKm\?: number/);
  assert.match(domain, /operatingHours\?: number/);
  assert.match(domain, /counterSettings\?: Partial<LocoCounterSettings>/);

  assert.match(settings, /digits:\s*6/);
  assert.match(settings, /digitHeight:\s*28/);
  assert.match(settings, /distanceDecimals:\s*1/);
  assert.match(settings, /operatingHoursDecimals:\s*1/);

  assert.match(helpers, /odometerKm:\s*0/);
  assert.match(helpers, /operatingHours:\s*0/);
  assert.match(helpers, /DEFAULT_LOCO_COUNTER_SETTINGS/);

  assert.match(editor, /<MechanicalCounter/);
  assert.match(editor, /counter_digits/);
  assert.match(editor, /counter_digit_height/);
  assert.match(editor, /counter_distance_decimals/);
  assert.match(editor, /counter_hours_decimals/);
  assert.match(editor, /counter_accent_fraction/);
});

test("LocoPanel shows kilometre and operating-hour counters below speed readout", () => {
  const card = read("src/layout/loco-panel/LocoControlCard.tsx");

  const speedReadout = card.indexOf("<Title");
  const counters = card.indexOf('className="loco-mechanical-counters"');

  assert.ok(speedReadout >= 0);
  assert.ok(counters > speedReadout);

  assert.match(card, /resolveLocoCounterSettings/);
  assert.match(card, /counterSettings\.enabled/);
  assert.match(card, /loco\.odometerKm/);
  assert.match(card, /loco\.operatingHours/);
  assert.match(card, /label="KM"/);
  assert.match(card, /label="H"/);
});
