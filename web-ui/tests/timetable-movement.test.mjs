import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here =
  path.dirname(
    fileURLToPath(
      import.meta.url
    )
  );

const webUiRoot =
  path.resolve(
    here,
    ".."
  );

function read(
  relativePath
) {
  return fs.readFileSync(
    path.join(
      webUiRoot,
      relativePath
    ),
    "utf8"
  );
}

test("legacy timetable targets normalize into one action", () => {
  const api =
    read(
      "src/services/automationApi.ts"
    );

  assert.match(
    api,
    /TimetableActionDefinition/
  );

  assert.match(
    api,
    /actions:\s*TimetableActionDefinition\[\]/
  );

  assert.match(
    api,
    /candidate\.actions/
  );

  assert.match(
    api,
    /legacyScriptId/
  );

  assert.match(
    api,
    /candidate\.scriptId/
  );

  assert.match(
    api,
    /candidate\.targetId/
  );

  assert.match(
    api,
    /actions\.push\(\{[\s\S]*targetType,[\s\S]*targetId/
  );
});

test("timetable editor groups multiple actions in one schedule row", () => {
  const dialog =
    read(
      "src/components/TimetableDialog.tsx"
    );

  assert.match(
    dialog,
    /createTimetableActionId/
  );

  assert.match(
    dialog,
    /row\.actions\.map/
  );

  assert.match(
    dialog,
    /addAction\(/
  );

  assert.match(
    dialog,
    /updateAction\(/
  );

  assert.match(
    dialog,
    /deleteAction\(/
  );

  assert.match(
    dialog,
    /timetableAddAction/
  );

  assert.match(
    dialog,
    /timetableDeleteActionConfirm/
  );

  assert.match(
    dialog,
    /window\.confirm/
  );

  assert.match(
    dialog,
    /<Paper[\s\S]*withBorder/
  );

  assert.doesNotMatch(
    dialog,
    /row\.targetType/
  );

  assert.doesNotMatch(
    dialog,
    /row\.targetId/
  );
});

test("timetable scheduler launches every action in a matching row", () => {
  const scheduler =
    read(
      "src/services/timetableScheduler.ts"
    );

  assert.match(
    scheduler,
    /for\s*\([\s\S]*const action of[\s\S]*entry\.actions/
  );

  assert.match(
    scheduler,
    /action\.targetType ===[\s\S]*"movement"/
  );

  assert.match(
    scheduler,
    /this\.launchMovement\([\s\S]*entry,[\s\S]*action,[\s\S]*movement/
  );

  assert.match(
    scheduler,
    /this\.launchScript\([\s\S]*entry,[\s\S]*action,[\s\S]*script/
  );

  assert.match(
    scheduler,
    /timetableActionId:\s*[\s\S]*action\.id/
  );

  assert.match(
    scheduler,
    /startMovement\([\s\S]*movement/
  );

  assert.match(
    scheduler,
    /runClientScript\(/
  );
});

test("timetable runtime tracks each action independently", () => {
  const panel =
    read(
      "src/components/TimetablePanel.tsx"
    );

  assert.match(
    panel,
    /for\s*\([\s\S]*const action of[\s\S]*entry\.actions/
  );

  assert.match(
    panel,
    /run\.timetableActionId ===[\s\S]*action\.id/
  );

  assert.match(
    panel,
    /entry\.id[\s\S]*action\.id[\s\S]*occurrence\.absoluteMinute/
  );

  assert.match(
    panel,
    /action\.targetType/
  );
});

test("timetable dialog uses i18n instead of hardcoded Hungarian UI", () => {
  const dialog =
    read(
      "src/components/TimetableDialog.tsx"
    );

  const en =
    JSON.parse(
      read(
        "src/i18n/ui.en.json"
      )
    );

  const hu =
    JSON.parse(
      read(
        "src/i18n/ui.hu.json"
      )
    );

  const de =
    JSON.parse(
      read(
        "src/i18n/ui.de.json"
      )
    );

  assert.match(
    dialog,
    /useTranslation/
  );

  for (
    const key of [
      "timetableScheduleType",
      "timetableSchedule",
      "timetableActions",
      "timetableAddAction",
      "timetableDeleteAction",
      "timetableDeleteActionConfirm",
      "timetableAddRow",
      "timetableDeleteRow",
    ]
  ) {
    assert.equal(
      typeof en[key],
      "string",
      `English translation missing: ${key}`
    );

    assert.equal(
      typeof hu[key],
      "string",
      `Hungarian translation missing: ${key}`
    );

    assert.equal(
      typeof de[key],
      "string",
      `German translation missing: ${key}`
    );
  }

  assert.doesNotMatch(
    dialog,
    /Menetrend elmentve|Hibás menetrendi|Válassz scriptet|Új sor|Sor törlése/
  );
});

test("native automation endpoints preserve multi-action timetable fields", () => {
  const firmware =
    read(
      "../src/AutomationsEndpoint.cpp"
    );

  const dotnet =
    read(
      "../desktop/DCCExpressHub.Net/Program.cs"
    );

  assert.match(
    firmware,
    /deserializeJson\([\s\S]*document/
  );

  assert.match(
    firmware,
    /_upload\.commit\(\)/
  );

  assert.match(
    dotnet,
    /JsonDocument\.ParseAsync\(memory\)/
  );

  assert.match(
    dotnet,
    /memory\.CopyToAsync\(output\)/
  );
});


test("timetable view keeps all running rows plus the next ten scheduled rows", () => {
  const panel =
    read(
      "src/components/TimetablePanel.tsx"
    );

  assert.match(
    panel,
    /TIMETABLE_NEXT_ROW_COUNT = 10/
  );

  assert.match(
    panel,
    /TIMETABLE_LOOKAHEAD_MINUTES/
  );

  assert.match(
    panel,
    /const activeRows/
  );

  assert.match(
    panel,
    /schedulerState\.activeRuns\.map/
  );

  assert.match(
    panel,
    /nextRows\.slice\([\s\S]*0,[\s\S]*TIMETABLE_NEXT_ROW_COUNT/
  );

  assert.match(
    panel,
    /return \[[\s\S]*\.\.\.activeRows,[\s\S]*\.\.\.nextRows\.slice/
  );

  assert.match(
    panel,
    /row\.absoluteMinute/
  );

  assert.doesNotMatch(
    panel,
    /TIMETABLE_WINDOW_MINUTES/
  );
});


test("next-ten timetable view has EN HU DE text", () => {
  for (
    const language of [
      "en",
      "hu",
      "de",
    ]
  ) {
    const ui =
      JSON.parse(
        read(
          `src/i18n/ui.${language}.json`
        )
      );

    assert.equal(
      typeof ui.timetableNextRowsDescription,
      "string"
    );

    assert.equal(
      typeof ui.noUpcomingTimetableRows,
      "string"
    );
  }
});


test("timetable editor uses a fixed large scrollable layout with compact target selects", () => {
  const dialog =
    read(
      "src/components/TimetableDialog.tsx"
    );

  assert.match(
    dialog,
    /size=\{1360\}/
  );

  assert.match(
    dialog,
    /height:\s*820/
  );

  assert.match(
    dialog,
    /maxHeight:[\s\S]*100dvh/
  );

  assert.match(
    dialog,
    /<ScrollArea[\s\S]*type="always"[\s\S]*flex:\s*1/
  );

  assert.match(
    dialog,
    /tableLayout:[\s\S]*"fixed"/
  );

  assert.match(
    dialog,
    /w=\{150\}/
  );

  assert.match(
    dialog,
    /w=\{210\}/
  );

  assert.match(
    dialog,
    /w=\{125\}/
  );

  assert.match(
    dialog,
    /w=\{290\}/
  );

  assert.doesNotMatch(
    dialog,
    /label=\{[\s\S]*ui\.timetableTarget[\s\S]*searchable/
  );
});
