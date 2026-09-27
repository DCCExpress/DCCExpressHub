import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT =
  path.resolve(
    import.meta.dirname,
    ".."
  );

function read(relativePath) {
  return fs.readFileSync(
    path.join(
      ROOT,
      relativePath
    ),
    "utf8"
  );
}

test("loco dialog exposes reusable fleet statistics table", () => {
  const dialog =
    read(
      "src/components/loco-dialog/LocoDialogContent.tsx"
    );

  const stats =
    read(
      "src/components/loco-dialog/LocoStatisticsTable.tsx"
    );

  assert.match(
    dialog,
    /Tabs\.Tab value="statistics"/
  );

  assert.match(
    dialog,
    /<LocoStatisticsTable[\s\S]*locos=\{locos\}/
  );

  assert.match(
    stats,
    /readonly Loco\[\]/
  );

  assert.match(
    stats,
    /getLocoCounterSnapshot/
  );

  assert.match(
    stats,
    /subscribeLocoCounterRuntime/
  );
});

test("fleet statistics report daily and total distance and worktime", () => {
  const stats =
    read(
      "src/components/loco-dialog/LocoStatisticsTable.tsx"
    );

  assert.match(
    stats,
    /statistics_daily_km/
  );

  assert.match(
    stats,
    /statistics_total_km/
  );

  assert.match(
    stats,
    /statistics_daily_hours/
  );

  assert.match(
    stats,
    /statistics_total_hours/
  );

  assert.match(
    stats,
    /runtime\?\.dailyKm/
  );

  assert.match(
    stats,
    /runtime\?\.totalKm[\s\S]*loco\.odometerKm/
  );

  assert.match(
    stats,
    /runtime\?\.dailyHours/
  );

  assert.match(
    stats,
    /runtime\?\.totalHours[\s\S]*loco\.operatingHours/
  );
});

test("fleet statistics include an aggregate footer", () => {
  const stats =
    read(
      "src/components/loco-dialog/LocoStatisticsTable.tsx"
    );

  assert.match(
    stats,
    /rows\.reduce/
  );

  assert.match(
    stats,
    /statistics_total/
  );

  assert.match(
    stats,
    /totals\.dailyKm/
  );

  assert.match(
    stats,
    /totals\.totalKm/
  );

  assert.match(
    stats,
    /totals\.dailyHours/
  );

  assert.match(
    stats,
    /totals\.totalHours/
  );
});


test("fleet statistics include locomotive images summary cards and metric chart", () => {
  const stats =
    read(
      "src/components/loco-dialog/LocoStatisticsTable.tsx"
    );

  assert.match(
    stats,
    /LocoImage/
  );

  assert.match(
    stats,
    /SimpleGrid/
  );

  assert.match(
    stats,
    /statistics_chart_title/
  );

  assert.match(
    stats,
    /SegmentedControl/
  );

  assert.match(
    stats,
    /dailyKm/
  );

  assert.match(
    stats,
    /totalKm/
  );

  assert.match(
    stats,
    /dailyHours/
  );

  assert.match(
    stats,
    /totalHours/
  );

  assert.match(
    stats,
    /Progress/
  );

  assert.match(
    stats,
    /statistics_image/
  );
});
