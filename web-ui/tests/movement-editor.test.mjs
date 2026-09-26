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

  const selector =
    read(
      "src/components/movement/MovementRouteSelector.tsx"
    );

  const navigation =
    read(
      "src/services/movementRouteNavigation.ts"
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
    /movement-editor-sidebar/
  );

  assert.match(
    dialog,
    /movement-page-list-card/
  );

  assert.match(
    dialog,
    /New movement/
  );

  assert.doesNotMatch(
    dialog,
    /<Tabs/
  );

  assert.match(
    dialog,
    /MovementRouteSelector/
  );

  assert.match(
    selector,
    /FROM BLOCK/
  );

  assert.match(
    selector,
    /VIA BLOCK/
  );

  assert.match(
    selector,
    /TO BLOCK/
  );

  assert.match(
    selector,
    /Add block/
  );

  assert.match(
    selector,
    /nextByBlockId/
  );

  assert.match(
    selector,
    /slice\(\s*0,\s*viaIndex/
  );

  assert.match(
    navigation,
    /routeTable/
  );

  assert.match(
    navigation,
    /blockIds\[\s*index \+ 1/
  );

  assert.match(
    navigation,
    /locoDirection/
  );

  assert.match(
    navigation,
    /mergeDirection/
  );

  assert.match(
    navigation,
    /getMovementSequenceDirections/
  );

  assert.match(
    navigation,
    /getCompatibleMovementNextBlockIds/
  );

  assert.match(
    selector,
    /getCompatibleMovementNextBlockIds/
  );

  assert.match(
    selector,
    /direction mismatch/
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


test("Movement uses a dedicated physical-route engine with JMRI-style actions", () => {
  const movement =
    read(
      "src/domain/movement.ts"
    );

  const plan =
    read(
      "src/services/movementPlan.ts"
    );

  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  const cards =
    read(
      "src/components/movement/MovementPagesTable.tsx"
    );

  const actionEditor =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  const routeEditor =
    read(
      "src/components/movement/MovementRouteEditor.tsx"
    );

  assert.match(
    movement,
    /actions: MovementAction\[\]/
  );

  assert.match(
    movement,
    /\| "approach"/
  );

  assert.match(
    movement,
    /\| "randomDelay"/
  );

  assert.match(
    plan,
    /kind:\s*"segment"/
  );

  assert.match(
    plan,
    /kind:\s*"turnout"/
  );

  assert.match(
    plan,
    /turnoutPath/
  );

  assert.match(
    plan,
    /trackAddressMap/
  );

  assert.match(
    engine,
    /export async function startMovement/
  );

  assert.match(
    engine,
    /switchManCommand/
  );

  assert.match(
    engine,
    /"acquire"/
  );

  assert.match(
    engine,
    /"set"/
  );

  assert.match(
    engine,
    /"release"/
  );

  assert.match(
    engine,
    /dcc-express-movement-segment/
  );

  assert.match(
    engine,
    /runActions/
  );

  assert.match(
    engine,
    /wsApi\.setLoco/
  );

  assert.doesNotMatch(
    engine,
    /wsApi\.setTurnout/
  );

  assert.match(
    engine,
    /tryAcquireAndSetTurnouts/
  );

  assert.match(
    engine,
    /createBlockTargetLocoMarker/
  );

  assert.match(
    engine,
    /setOptimisticBlockTargetLoco/
  );

  assert.match(
    engine,
    /wsApi\.setBlock\(/
  );

  assert.match(
    engine,
    /wsApi\.setBlockRemove\(/
  );

  assert.match(
    engine,
    /Target \$\{leg\.to\.name\}: loco/
  );

  assert.doesNotMatch(
    engine,
    /smartDispatcher/
  );

  assert.match(
    cards,
    /startMovement/
  );

  assert.match(
    cards,
    /stopMovement/
  );

  assert.match(
    cards,
    /abortMovement/
  );

  assert.match(
    actionEditor,
    /WHEN → WHAT/
  );

  assert.doesNotMatch(
    actionEditor,
    /Set turnout/
  );

  assert.match(
    routeEditor,
    /plan\.resources/
  );

  assert.match(
    routeEditor,
    /topology v/
  );
});


test("backend actual block assignment replaces target-only markers", () => {
  const dotnet =
    read(
      "../desktop/DCCExpressHub.Net/Web/LayoutRuntime.cs"
    );

  const esp32 =
    read(
      "../src/LayoutRuntime.cpp"
    );

  assert.match(
    dotnet,
    /TargetOnly/
  );

  assert.match(
    dotnet,
    /else if \(target\.LocoId != locoId \|\| target\.LocoAddress != locoAddress\)[\s\S]*target\.LocoId = locoId;[\s\S]*target\.LocoAddress = locoAddress;/
  );

  assert.match(
    esp32,
    /targetOnly\(\)/
  );

  assert.match(
    esp32,
    /else if \(target->locoId != locoId \|\| target->locoAddress != locoAddress\)[\s\S]*target->locoId = locoId;[\s\S]*target->locoAddress = locoAddress;/
  );
});


test("Movement route selector rejects reverse-direction continuation", () => {
  const navigation =
    read(
      "src/services/movementRouteNavigation.ts"
    );

  assert.match(
    navigation,
    /current ===[\s\S]*"unknown"[\s\S]*return next/
  );

  assert.match(
    navigation,
    /next ===[\s\S]*"unknown"[\s\S]*return current/
  );

  assert.match(
    navigation,
    /current ===[\s\S]*next[\s\S]*\?[\s\S]*current[\s\S]*:[\s\S]*null/
  );

  assert.match(
    navigation,
    /getMovementSequenceDirections\([\s\S]*\[\s*\.\.\.sequence,[\s\S]*option\.blockId/
  );
});
