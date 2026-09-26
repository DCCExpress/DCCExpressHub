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

test("legacy timetable scriptId rows normalize to script targets", () => {
  const api =
    read(
      "src/services/automationApi.ts"
    );

  assert.match(
    api,
    /TimetableTargetType/
  );

  assert.match(
    api,
    /targetType:[\s\S]*TimetableTargetType/
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
    /targetType ===[\s\S]*"script"[\s\S]*legacyScriptId/
  );
});

test("timetable editor offers read-only script or Movement target selection", () => {
  const dialog =
    read(
      "src/components/TimetableDialog.tsx"
    );

  assert.match(
    dialog,
    /movements:\s*MovementPage\[\]/
  );

  assert.match(
    dialog,
    /value:[\s\S]*"script"[\s\S]*label:[\s\S]*"Script"/
  );

  assert.match(
    dialog,
    /value:[\s\S]*"movement"[\s\S]*label:[\s\S]*"Movement"/
  );

  assert.match(
    dialog,
    /row\.targetType/
  );

  assert.match(
    dialog,
    /row\.targetId/
  );

  assert.match(
    dialog,
    /movementOptions/
  );

  assert.match(
    dialog,
    /scriptOptions/
  );

  assert.doesNotMatch(
    dialog,
    /row\.scriptId/
  );
});

test("timetable scheduler launches and tracks Movements as first-class targets", () => {
  const scheduler =
    read(
      "src/services/timetableScheduler.ts"
    );

  assert.match(
    scheduler,
    /private movements:\s*MovementPage\[\]/
  );

  assert.match(
    scheduler,
    /entry\.targetType ===[\s\S]*"movement"/
  );

  assert.match(
    scheduler,
    /this\.launchMovement/
  );

  assert.match(
    scheduler,
    /startMovement\([\s\S]*movement/
  );

  assert.match(
    scheduler,
    /subscribeMovementEngineState/
  );

  assert.match(
    scheduler,
    /getMovementEngineState/
  );

  assert.match(
    scheduler,
    /targetType:[\s\S]*"movement"/
  );

  assert.match(
    scheduler,
    /Movement "[^"]*" is already active|Movement "\$\{movement\.name\}" is already active/
  );
});

test("timetable runtime receives Movement definitions and labels mixed targets", () => {
  const panel =
    read(
      "src/components/TimetablePanel.tsx"
    );

  const layout =
    read(
      "src/LiteLayoutPage.tsx"
    );

  assert.match(
    panel,
    /movements:\s*MovementPage\[\]/
  );

  assert.match(
    panel,
    /timetableScheduler\.configure\([\s\S]*scripts,[\s\S]*movements,[\s\S]*timetable/
  );

  assert.match(
    panel,
    /row\.targetType ===[\s\S]*"movement"/
  );

  assert.match(
    layout,
    /<TimetablePanel[\s\S]*movements=\{movementDocument\.pages\}/
  );

  assert.match(
    layout,
    /<TimetableDialog[\s\S]*movements=\{movementDocument\.pages\}/
  );
});

test("native automation endpoints preserve generic timetable target fields", () => {
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
