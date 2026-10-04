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

test("shared automation document writes are serialized in the WebUI", () => {
  const api =
    read(
      "src/services/automationApi.ts"
    );

  assert.match(
    api,
    /let automationWriteQueue/
  );

  assert.match(
    api,
    /function enqueueAutomationWrite/
  );

  assert.match(
    api,
    /function mutateAutomationStorage/
  );

  assert.match(
    api,
    /saveAutomationScripts[\s\S]*mutateAutomationStorage/
  );

  assert.match(
    api,
    /saveAutomationTimetable[\s\S]*mutateAutomationStorage/
  );

  assert.match(
    api,
    /saveAutomationFlow[\s\S]*mutateAutomationStorage/
  );

  assert.match(
    api,
    /saveAutomationMovement[\s\S]*mutateAutomationStorage/
  );

  assert.doesNotMatch(
    api,
    /updateAutomationMovementTiming/
  );

  const backend =
    read(
      "../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs"
    );

  const coordinator =
    read(
      "../desktop/DCCExpressHub.Net/Web/AutomationStorageCoordinator.cs"
    );

  assert.match(
    backend,
    /PersistMovementTimingAsync[\s\S]*_automationStorage\.ExecuteAsync/
  );

  assert.match(
    coordinator,
    /SemaphoreSlim/
  );
});

test("ESP32 keeps a persistent previous automation snapshot", () => {
  const header =
    read(
      "../src/AutomationsEndpoint.h"
    );

  const source =
    read(
      "../src/AutomationsEndpoint.cpp"
    );

  assert.match(
    header,
    /automations\.json\.previous/
  );

  assert.match(
    source,
    /backupCurrent\(\)/
  );

  assert.match(
    source,
    /PREVIOUS_PATH/
  );

  assert.match(
    source,
    /\/api\/automations\/previous/
  );

  assert.match(
    source,
    /backupCurrent\(\)[\s\S]*_upload\.commit/
  );
});

test(".NET keeps a persistent previous automation snapshot", () => {
  const program =
    read(
      "../desktop/DCCExpressHub.Net/Program.cs"
    );

  assert.match(
    program,
    /\/api\/automations\/previous/
  );

  assert.match(
    program,
    /automations\.json\.previous/
  );

  assert.match(
    program,
    /File\.Copy\([\s\S]*finalPath[\s\S]*previousPath/
  );

  assert.match(
    program,
    /File\.Copy[\s\S]*File\.Move\(tempPath, finalPath, true\)/
  );
});


test("project export and import include timetable data", () => {
  const page =
    read(
      "src/LiteLayoutPage.tsx"
    );

  assert.match(
    page,
    /loadAutomationTimetable/
  );

  assert.match(
    page,
    /createProjectExport\([\s\S]*timetable/
  );

  assert.match(
    page,
    /normalizeTimetableEntries\([\s\S]*automations\.timetable/
  );

  assert.match(
    page,
    /saveAutomationTimetable\(imported\.timetable\)/
  );
});
