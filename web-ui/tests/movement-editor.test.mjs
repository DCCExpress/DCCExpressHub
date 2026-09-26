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

function read(relativePath) {
  return fs.readFileSync(
    path.join(
      webUiRoot,
      relativePath
    ),
    "utf8"
  );
}

test("Movement data is stored beside scripts, timetable and flows", () => {
  const source =
    read(
      "src/services/automationApi.ts"
    );

  assert.match(
    source,
    /movement\?: MovementDocument/
  );

  assert.match(
    source,
    /normalizeMovementDocument\(\s*payload\.movement/
  );

  assert.match(
    source,
    /export async function loadAutomationMovement/
  );

  assert.match(
    source,
    /export async function saveAutomationMovement/
  );

  assert.match(
    source,
    /saveAutomationScripts[\s\S]*current\.movement/
  );

  assert.match(
    source,
    /saveAutomationTimetable[\s\S]*current\.movement/
  );

  assert.match(
    source,
    /saveAutomationFlow[\s\S]*current\.movement/
  );
});

test("Automation panel places Movement after Flows", () => {
  const source =
    read(
      "src/components/AutomationPanel.tsx"
    );

  const flowsTab =
    source.indexOf(
      'value="flows"'
    );

  const movementTab =
    source.indexOf(
      'value="movement"'
    );

  assert.ok(
    flowsTab >= 0,
    "Flows tab missing"
  );

  assert.ok(
    movementTab >
      flowsTab,
    "Movement tab must follow Flows"
  );

  assert.match(
    source,
    /MovementPagesTable/
  );
});

test("Movement editor is split into reusable components", () => {
  const dialog =
    read(
      "src/components/movement/MovementEditorDialog.tsx"
    );

  const editor =
    read(
      "src/components/movement/MovementRouteEditor.tsx"
    );

  const row =
    read(
      "src/components/movement/MovementRouteRow.tsx"
    );

  assert.match(
    dialog,
    /MovementRouteEditor/
  );

  assert.match(
    dialog,
    /createMovementPage/
  );

  assert.match(
    dialog,
    /saveAutomationMovement/
  );

  assert.match(
    dialog,
    /loadAutomationMovement/
  );

  assert.match(
    dialog,
    /IconTrash/
  );

  assert.match(
    dialog,
    /checked=\{\s*page\.enabled/
  );

  assert.match(
    editor,
    /loadAutomationBlockCatalog/
  );

  assert.match(
    editor,
    /From block/
  );

  assert.match(
    editor,
    /To block/
  );

  assert.match(
    editor,
    /Via block/
  );

  assert.match(
    editor,
    /MovementRouteRow/
  );

  assert.match(
    row,
    /Block arrived when/
  );

  assert.match(
    row,
    /condition\.sensor/
  );

  assert.match(
    editor,
    /loadAutomationSensorCatalog/
  );

  assert.match(
    row,
    /<Select/
  );

  assert.doesNotMatch(
    row,
    /<NumberInput/
  );

  assert.match(
    row,
    /searchable=\{\s*false\s*\}/
  );
});

test("Layout project import and export preserve Movement pages", () => {
  const source =
    read(
      "src/LiteLayoutPage.tsx"
    );

  assert.match(
    source,
    /movement: MovementDocument/
  );

  assert.match(
    source,
    /normalizeMovementDocument\(\s*automations\.movement/
  );

  assert.match(
    source,
    /createEmptyMovementDocument/
  );

  assert.match(
    source,
    /loadAutomationMovement/
  );

  assert.match(
    source,
    /saveAutomationMovement\(imported\.movement\)/
  );

  assert.match(
    source,
    /<MovementEditorDialog/
  );

  assert.match(
    source,
    /movements=\{movementDocument\}/
  );
});


test("Movement cards execute SmartDispatcher with saved cruise speed", () => {
  const movement =
    read(
      "src/domain/movement.ts"
    );

  const runtime =
    read(
      "src/services/movementRuntime.ts"
    );

  const cards =
    read(
      "src/components/movement/MovementPagesTable.tsx"
    );

  const editor =
    read(
      "src/components/movement/MovementEditorDialog.tsx"
    );

  assert.match(
    movement,
    /speed: number/
  );

  assert.match(
    movement,
    /speed: 20/
  );

  assert.match(
    runtime,
    /await smartDispatcher/
  );

  assert.match(
    runtime,
    /run\.setSpeed/
  );

  assert.match(
    runtime,
    /run\.waitForBlock/
  );

  assert.match(
    runtime,
    /arrivedWhen/
  );

  assert.match(
    cards,
    /runClientScript/
  );

  assert.match(
    cards,
    /movementExecutionId/
  );

  assert.match(
    cards,
    /IconPlayerPlay/
  );

  assert.match(
    cards,
    /IconPlayerStop/
  );

  assert.match(
    cards,
    /emergencyStop/
  );

  assert.doesNotMatch(
    cards,
    /pauseClientScript/
  );

  assert.match(
    editor,
    /Cruise speed/
  );
});
