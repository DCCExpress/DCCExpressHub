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

test("Movement documents may be empty and the final Movement can be deleted", () => {
  const domain =
    read(
      "src/domain/movement.ts"
    );

  const dialog =
    read(
      "src/components/movement/MovementEditorDialog.tsx"
    );

  assert.match(
    domain,
    /pages:\s*\[\]/
  );

  assert.match(
    domain,
    /pages\[0\]\?\.id[\s\S]*""/
  );

  assert.doesNotMatch(
    domain,
    /pages\.push\([\s\S]*createMovementPage/
  );

  assert.doesNotMatch(
    dialog,
    /The last movement cannot be deleted/
  );

  assert.doesNotMatch(
    dialog,
    /document\.pages\.length <=[\s\S]*1/
  );

  assert.match(
    dialog,
    /pages\[[\s\S]*nextIndex[\s\S]*\]\?\.id[\s\S]*""/
  );

  assert.match(
    dialog,
    /movementNoConfigured/
  );

  assert.match(
    dialog,
    /movementSaveEmptyList/
  );

  assert.match(
    dialog,
    /onClick=[\s\S]*void save\(\)/
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

  const routeDialog =
    read(
      "src/components/movement/MovementRouteSelectDialog.tsx"
    );

  const routeCatalog =
    read(
      "src/services/movementRouteCatalog.ts"
    );

  const routeIdentity =
    read(
      "src/services/movementRouteIdentity.ts"
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
    /MovementSidebarCard/
  );

  assert.match(
    dialog,
    /movementNewMovement/
  );

  assert.doesNotMatch(
    dialog,
    /<Tabs/
  );

  assert.match(
    dialog,
    /MovementRouteSelectDialog/
  );

  assert.doesNotMatch(
    dialog,
    /MovementRouteSelector/
  );

  assert.match(
    dialog,
    /movementSelectRoute/
  );

  assert.match(
    dialog,
    /activeRouteNames/
  );

  assert.match(
    routeDialog,
    /loadMovementRouteCandidates/
  );

  assert.match(
    routeDialog,
    /candidates\.map/
  );

  assert.match(
    routeDialog,
    /candidate\.blockPath/
  );

  assert.match(
    routeDialog,
    /candidate\.locoDirection/
  );

  assert.match(
    routeCatalog,
    /routeTopology/
  );

  assert.match(
    routeCatalog,
    /usedRouteKeys/
  );

  assert.match(
    routeCatalog,
    /usedLegacySequences/
  );

  assert.match(
    routeCatalog,
    /applyMovementRouteCandidate/
  );

  assert.match(
    routeIdentity,
    /createMovementRouteKey/
  );

  assert.match(
    editor,
    /MovementRouteRow/
  );

  assert.match(
    row,
    /CollapsiblePanelCard/
  );

  assert.match(
    row,
    /title="Condition \/ Event"/
  );

  assert.match(
    row,
    /title="Actions"/
  );

  assert.match(
    row,
    /movement-physical-route-card/
  );

  assert.doesNotMatch(
    row,
    /movement-route-condition/
  );

  assert.doesNotMatch(
    row,
    /movement-route-actions/
  );

  const blockConditions =
    read(
      "src/components/movement/MovementBlockConditionsEditor.tsx"
    );

  assert.match(
    row,
    /MovementBlockConditionsEditor/
  );

  assert.match(
    blockConditions,
    /Approach when/
  );

  assert.match(
    blockConditions,
    /Arrived when/
  );

  assert.match(
    blockConditions,
    /Depart when/
  );

  assert.match(
    blockConditions,
    /Leave when/
  );

  const approachIndex =
    blockConditions.indexOf(
      '"Approach when"'
    );

  const arrivedIndex =
    blockConditions.indexOf(
      '"Arrived when"'
    );

  const departIndex =
    blockConditions.indexOf(
      '"Depart when"'
    );

  const leaveIndex =
    blockConditions.indexOf(
      '"Leave when"'
    );

  assert.ok(
    approachIndex >= 0 &&
    arrivedIndex >
      approachIndex &&
    departIndex >
      arrivedIndex &&
    leaveIndex >
      departIndex,
    "Block event cards must follow APPROACH -> ARRIVED -> DEPART -> LEAVE"
  );

  assert.match(
    blockConditions,
    /condition\.sensor/
  );

  assert.match(
    editor,
    /loadAutomationSensorCatalog/
  );

  assert.match(
    blockConditions,
    /<Select/
  );

  assert.doesNotMatch(
    blockConditions,
    /<NumberInput/
  );

  assert.match(
    blockConditions,
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
    read("src/domain/movement.ts");
  const engine =
    read("src/services/movementEngine.ts");
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");
  const dispatcher =
    read("../desktop/DCCExpressHub.Net/Web/DispatcherRuntime.cs");

  assert.match(movement, /actions: MovementAction\[\]/);
  assert.match(engine, /The browser no longer executes Movement/);
  assert.match(engine, /action:[\s\S]*"start"[\s\S]*pageId:[\s\S]*page\.id/);
  assert.doesNotMatch(engine, /switchManCommand|navigator\.locks|wsApi\.setLoco\(/);

  assert.match(backend, /Windows authoritative Movement executor/);
  assert.match(backend, /async Task TraverseLeg/);
  assert.match(backend, /async Task RunActions/);
  assert.match(backend, /async Task ExecuteAction/);
  assert.match(backend, /_dispatcher\.AcquireLegAsync/);
  assert.match(backend, /_commandCenter\.SetLocoAsync/);
  assert.match(dispatcher, /TryReserveLegResources/);
  assert.match(dispatcher, /SetTurnoutAsync/);
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


test("Movement generated route selector keeps used routes visible but marks them unavailable", () => {
  const catalog =
    read(
      "src/services/movementRouteCatalog.ts"
    );

  const dialog =
    read(
      "src/components/movement/MovementRouteSelectDialog.tsx"
    );

  const domain =
    read(
      "src/domain/movement.ts"
    );

  const plan =
    read(
      "src/services/movementPlan.ts"
    );

  assert.match(
    catalog,
    /document\.pages/
  );

  assert.match(
    catalog,
    /usedRouteKeys\.get/
  );

  assert.match(
    catalog,
    /usedLegacySequences\.push/
  );

  assert.match(
    catalog,
    /usedByMovementNames/
  );

  assert.match(
    catalog,
    /used:[\s\S]*usedByMovementNames\.length/
  );

  assert.match(
    catalog,
    /containsCheckpointsInOrder/
  );

  assert.match(
    dialog,
    /candidate\.used/
  );

  assert.match(
    dialog,
    /disabled=\{[\s\S]*candidate\.used/
  );

  assert.match(
    dialog,
    /movement-route-candidate-used/
  );

  assert.match(
    dialog,
    /movementRouteAlreadyUsed/
  );

  assert.match(
    domain,
    /routeRef:\s*MovementRouteRef \| null/
  );

  assert.match(
    domain,
    /routeRef:\s*null/
  );

  assert.match(
    plan,
    /page\.routeRef/
  );

  assert.doesNotMatch(
    plan,
    /createMovementRouteKey/
  );

  assert.match(
    plan,
    /Select an exact generated route/
  );
});


test("Movement editor sidebar cards expose runtime controls without changing pages", () => {
  const dialog =
    read(
      "src/components/movement/MovementEditorDialog.tsx"
    );

  const sidebar =
    read(
      "src/components/movement/MovementSidebarCard.tsx"
    );

  const controls =
    read(
      "src/components/movement/MovementRuntimeControls.tsx"
    );

  assert.match(
    dialog,
    /<MovementSidebarCard/
  );

  assert.match(
    sidebar,
    /movement-page-list-runtime/
  );

  assert.match(
    sidebar,
    /MovementRuntimeControls/
  );

  assert.match(
    controls,
    /IconPlayerPlay/
  );

  assert.match(
    controls,
    /IconPlayerStop/
  );

  assert.match(
    controls,
    /IconAlertTriangle/
  );

  assert.match(
    controls,
    /event\.stopPropagation\(\)/
  );

  assert.match(
    sidebar,
    /state\.info/
  );
});


test("Mantine modals keep the blue title bar while fullscreen editors use a slimmer header", () => {
  const css =
    read(
      "src/styles.css"
    );

  const movementDialog =
    read(
      "src/components/movement/MovementEditorDialog.tsx"
    );

  const flowDialog =
    read(
      "src/components/automation/AutomationFlowDialog.tsx"
    );

  assert.match(
    css,
    /\.mantine-Modal-header[\s\S]*min-height:\s*48px[\s\S]*var\(--mantine-primary-color-filled\)/
  );

  assert.match(
    css,
    /\.mantine-Modal-title[\s\S]*color:\s*white[\s\S]*font-weight:\s*700/
  );

  assert.match(
    css,
    /\.mantine-Modal-close[\s\S]*color:\s*white/
  );

  assert.match(
    css,
    /\.app-fullscreen-modal-header[\s\S]*min-height:\s*40px/
  );

  assert.match(
    movementDialog,
    /fullScreen[\s\S]*app-fullscreen-modal-header/
  );

  assert.match(
    flowDialog,
    /fullScreen[\s\S]*app-fullscreen-modal-header/
  );
});

test("Movement physical route uses one collapsible card instead of three columns", () => {
  const editor =
    read(
      "src/components/movement/MovementRouteEditor.tsx"
    );

  const row =
    read(
      "src/components/movement/MovementRouteRow.tsx"
    );

  const css =
    read(
      "src/styles/movementEditor.css"
    );

  assert.doesNotMatch(
    editor,
    /movement-route-grid-header/
  );

  assert.match(
    editor,
    /pageId=/
  );

  assert.match(
    row,
    /collapsedStorageKey/
  );

  assert.match(
    row,
    /defaultCollapsed/
  );

  assert.match(
    css,
    /grid-template-columns:\s*36px minmax\(0, 1fr\)/
  );

  assert.doesNotMatch(
    css,
    /movement-route-condition/
  );

  assert.doesNotMatch(
    css,
    /movement-route-actions/
  );
});


test("Movement PlayAudio uses the shared picker without manual path typing", () => {
  const actionEditor =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  const audioPicker =
    read(
      "src/layout/property-panel/AudioFilePropertyEditor.tsx"
    );

  assert.match(
    actionEditor,
    /action\.kind ===[\s\S]*"playAudio"[\s\S]*<AudioFileInput/
  );

  assert.match(
    actionEditor,
    /allowManualInput=\{\s*false\s*\}/
  );

  assert.doesNotMatch(
    actionEditor,
    /placeholder="\/sd\/audio\/file\.mp3"/
  );

  assert.match(
    audioPicker,
    /allowManualInput\?: boolean/
  );

  assert.match(
    audioPicker,
    /readOnly=\{[\s\S]*readonly[\s\S]*!allowManualInput/
  );

  assert.match(
    audioPicker,
    /disabled=\{readonly\}/
  );
});


test("Movement start is disabled and notified while track power is off", () => {
  const controls =
    read(
      "src/components/movement/MovementRuntimeControls.tsx"
    );

  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  const powerRuntime =
    read(
      "src/services/trackPowerRuntime.ts"
    );

  const commandCenter =
    read(
      "src/context/CommandCenterContext.tsx"
    );

  assert.match(
    controls,
    /disabled=\{[\s\S]*!trackPowerOn/
  );

  assert.match(
    controls,
    /notifyTrackPowerOff/
  );

  assert.match(
    controls,
    /showNotification\(/
  );

  assert.match(
    engine,
    /if \([\s\S]*!isTrackPowerOn\(\)[\s\S]*throw new Error/
  );

  assert.match(
    powerRuntime,
    /subscribeTrackPower/
  );

  assert.match(
    powerRuntime,
    /setTrackPowerRuntimeState/
  );

  assert.match(
    commandCenter,
    /data\.powerInfo\.trackVoltageOn ===[\s\S]*true/
  );
});


test("Movement Condition and Actions panels use subtle grayscale section styling", () => {
  const row =
    read(
      "src/components/movement/MovementRouteRow.tsx"
    );

  const css =
    read(
      "src/styles/movementEditor.css"
    );

  assert.match(
    row,
    /movement-collapsible-header-condition/
  );

  assert.match(
    row,
    /movement-collapsible-header-actions/
  );

  assert.match(
    row,
    /movement-collapsible-body-condition/
  );

  assert.match(
    row,
    /movement-collapsible-body-actions/
  );

  assert.match(
    css,
    /movement-collapsible-header-condition/
  );

  assert.match(
    css,
    /movement-collapsible-header-actions/
  );

  assert.match(
    css,
    /color-mix/
  );
});


test("Movement block LEAVE fires from source occupancy release", () => {
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");

  assert.match(backend, /BlockLeaveState CreateBlockLeaveState/);
  assert.match(backend, /SeenOccupied[\s\S]*TryGetSensorState/);
  assert.match(backend, /async Task MaybeRunBlockLeave/);
  assert.match(backend, /if \(occupied\)[\s\S]*state\.SeenOccupied/);
  assert.match(backend, /if \(!state\.SeenOccupied\)[\s\S]*return/);
  assert.match(backend, /leg\.From\.Key,[\s\S]*"leave"/);
  assert.match(backend, /RunBlockLeaveFallback/);
});


test("Movement default ARRIVED always comes from the block own occupancy sensor", () => {
  const plan =
    read(
      "src/services/movementPlan.ts"
    );

  const catalog =
    read(
      "src/services/movementRouteCatalog.ts"
    );

  const defaults =
    read(
      "src/services/movementRouteDefaults.ts"
    );

  assert.match(
    plan,
    /const destinationSensor =[\s\S]*sensors\.get\([\s\S]*blockId[\s\S]*\)/
  );

  assert.match(
    plan,
    /auto-arrival-\$\{blockId\}-on/
  );

  assert.match(
    plan,
    /sensor:[\s\S]*destinationSensor[\s\S]*state:\s*true/
  );

  assert.match(
    defaults,
    /current\.kind !==[\s\S]*"block"/
  );

  assert.match(
    defaults,
    /current\.sensor ===[\s\S]*null[\s\S]*\? \[\][\s\S]*sensor:[\s\S]*current\.sensor/
  );

  assert.doesNotMatch(
    catalog,
    /generatedRules/
  );

  assert.doesNotMatch(
    catalog,
    /createMovementId\(\s*"condition"\s*\)/
  );

  assert.match(
    catalog,
    /blockRules:[\s\S]*existingRules/
  );
});

test("Movement block conditions support APPROACH ARRIVED DEPART and LEAVE sensor rules", () => {
  const domain =
    read("src/domain/movement.ts");
  const plan =
    read("src/services/movementPlan.ts");
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");
  const editor =
    read("src/components/movement/MovementBlockConditionsEditor.tsx");

  assert.match(domain, /approachWhen:\s*MovementSensorCondition\[\]/);
  assert.match(domain, /departWhen:\s*MovementSensorCondition\[\]/);
  assert.match(domain, /leaveWhen:\s*MovementSensorCondition\[\]/);
  assert.match(domain, /arrivedWhen:\s*MovementSensorCondition\[\]/);
  assert.match(plan, /auto-arrival-\$\{blockId\}-on/);

  assert.match(backend, /MaybeRunBlockApproach/);
  assert.match(backend, /ConditionsSatisfied\([\s\S]*leg\.ApproachWhen/);
  assert.match(backend, /leg\.DepartWhen/);
  assert.match(backend, /leg\.LeaveWhen/);
  assert.match(backend, /while \(!ConditionsSatisfied\([\s\S]*leg\.ArrivedWhen/);

  for (const name of ["approachWhen", "departWhen", "leaveWhen", "arrivedWhen"]) {
    assert.match(editor, new RegExp(`"${name}"`));
  }
});


test("Movement stepper and PhysicalRoute headers share route-role colors", () => {
  const row =
    read(
      "src/components/movement/MovementRouteRow.tsx"
    );

  const css =
    read(
      "src/styles/movementEditor.css"
    );

  assert.match(
    row,
    /return "is-segment"/
  );

  assert.match(
    row,
    /return "is-turnout"/
  );

  assert.match(
    row,
    /return "is-from"/
  );

  assert.match(
    row,
    /return "is-to"/
  );

  assert.match(
    row,
    /return "is-via"/
  );

  assert.match(
    row,
    /resource\.kind ===[\s\S]*"turnout"[\s\S]*return "orange"/
  );

  assert.match(
    row,
    /resource\.kind ===[\s\S]*"segment"[\s\S]*return "gray"/
  );

  assert.match(
    row,
    /return "pink"/
  );

  assert.match(
    row,
    /resource\.kind ===[\s\S]*"block"[\s\S]*return "VIA"/
  );

  assert.match(
    css,
    /movement-route-dot\.is-segment/
  );

  assert.match(
    css,
    /movement-route-dot\.is-turnout/
  );

  assert.match(
    css,
    /movement-route-dot\.is-from/
  );

  assert.match(
    css,
    /movement-route-dot\.is-via/
  );

  assert.match(
    css,
    /movement-route-dot\.is-to/
  );

  assert.match(
    css,
    /movement-physical-route-header\.is-segment/
  );

  assert.match(
    css,
    /movement-physical-route-header\.is-turnout/
  );

  assert.match(
    css,
    /movement-physical-route-header\.is-from/
  );

  assert.match(
    css,
    /movement-physical-route-header\.is-via/
  );

  assert.match(
    css,
    /movement-physical-route-header\.is-to/
  );
});


test("Movement block actions support before-depart and after-leave lifecycle phases", () => {
  const domain =
    read("src/domain/movement.ts");
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");
  const actionEditor =
    read("src/components/movement/MovementActionEditor.tsx");

  assert.match(domain, /\| "beforeDepart"/);
  assert.match(domain, /\| "afterLeave"/);
  assert.match(actionEditor, /movementEventBeforeDepart/);
  assert.match(actionEditor, /movementEventAfterLeave/);

  const beforeDepart =
    backend.indexOf('"beforeDepart"');
  const acquire =
    backend.indexOf("await AcquireLeg", beforeDepart);
  assert.ok(beforeDepart >= 0 && acquire > beforeDepart);

  const sourceRelease =
    backend.indexOf("_layout.RemoveBlock");
  const afterLeave =
    backend.indexOf('"afterLeave"', sourceRelease);
  assert.ok(sourceRelease >= 0 && afterLeave > sourceRelease);
});


test("Movement actions are draggable inside their sequence order", () => {
  const editor =
    read("src/components/movement/MovementActionEditor.tsx");
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");

  assert.match(editor, /type DragEvent/);
  assert.match(editor, /IconGripVertical/);
  assert.match(editor, /draggable/);
  assert.match(editor, /moveActionByOffset/);
  assert.match(editor, /moveAction\(/);

  assert.match(backend, /execution\.Page\.Actions/);
  assert.match(backend, /action\.When/);
  assert.match(backend, /action\.SequenceId/);
});


test("Movement action drag uses a dedicated handle and darker card headers", () => {
  const actionEditor =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  const conditions =
    read(
      "src/components/movement/MovementBlockConditionsEditor.tsx"
    );

  const css =
    read(
      "src/styles/movementEditor.css"
    );

  assert.match(
    actionEditor,
    /className="movement-action-card"/
  );

  assert.match(
    actionEditor,
    /className="movement-action-card-header"/
  );

  assert.match(
    actionEditor,
    /className="movement-action-drag-handle"/
  );

  assert.match(
    actionEditor,
    /className="movement-action-card-header"[\s\S]*draggable[\s\S]*onDragStart/
  );

  assert.doesNotMatch(
    actionEditor,
    /<Card[\s\S]{0,300}\bdraggable\b/
  );

  assert.match(
    conditions,
    /movement-block-event-condition-header/
  );

  assert.match(
    css,
    /movement-action-card[\s\S]*mantine-color-blue-0/
  );

  assert.match(
    css,
    /movement-action-card-header[\s\S]*background:\s*inherit/
  );

  assert.match(
    css,
    /movement-block-event-condition-header[\s\S]*black 18%/
  );

  assert.match(
    css,
    /movement-collapsible-header-condition[\s\S]*black 20%/
  );

  assert.match(
    css,
    /movement-collapsible-header-actions[\s\S]*black 27%/
  );
});


test("Movement condition and action content use nested steppers", () => {
  const conditions =
    read(
      "src/components/movement/MovementBlockConditionsEditor.tsx"
    );

  const actions =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  const css =
    read(
      "src/styles/movementEditor.css"
    );

  assert.match(
    conditions,
    /movement-inner-step-row movement-condition-step-row/
  );

  assert.match(
    conditions,
    /sectionIndex \+ 1/
  );

  assert.match(
    conditions,
    /"arrivedWhen"[\s\S]*"departWhen"[\s\S]*"leaveWhen"/
  );

  assert.match(
    actions,
    /movement-inner-step-row movement-action-step-row/
  );

  assert.match(
    actions,
    /actionIndex \+ 1/
  );

  assert.match(
    css,
    /grid-template-columns:\s*38px minmax\(0, 1fr\)/
  );

  assert.match(
    css,
    /gap:\s*12px/
  );

  assert.match(
    css,
    /movement-inner-step-row\.is-last/
  );
});


test("Movement action sequences support blocking and background execution", () => {
  const domain =
    read("src/domain/movement.ts");
  const editor =
    read("src/components/movement/MovementActionEditor.tsx");
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");

  assert.match(domain, /MovementSequenceMode/);
  assert.match(domain, /sequenceMode:\s*MovementSequenceMode/);
  assert.match(editor, /value:\s*"blocking"/);
  assert.match(editor, /value:\s*"background"/);

  assert.match(backend, /RunActionSequence/);
  assert.match(backend, /RunActions/);
  assert.match(backend, /SequenceMode/);
  assert.match(backend, /BackgroundTasks/);
  assert.match(backend, /Task\.WhenAll/);
});


test("Movement destination block exposes and fires APPROACH before ARRIVED", () => {
  const editor =
    read("src/components/movement/MovementActionEditor.tsx");
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");

  assert.match(editor, /isDestination[\s\S]*"approach"[\s\S]*"arrived"/);
  assert.match(backend, /approachSegments/);
  assert.match(backend, /approachSegment/);

  const approach =
    backend.indexOf('"approach"');
  const arrival =
    backend.indexOf("while (!ConditionsSatisfied", approach);
  assert.ok(approach >= 0 && arrival > approach);
});


test("Movement physical route highlights stable physical runtime progress", () => {
  const editor =
    read("src/components/movement/MovementRouteEditor.tsx");
  const row =
    read("src/components/movement/MovementRouteRow.tsx");
  const engine =
    read("src/services/movementEngine.ts");
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");
  const css =
    read("src/styles/movementEditor.css");

  assert.match(editor, /runtimeState\.activeRouteResourceKey/);
  assert.match(engine, /activeRouteResourceKey:\s*string \| null/);
  assert.match(backend, /activeRouteResourceKey:/);
  assert.match(backend, /resource\.Key/);
  assert.match(backend, /leg\.To\.Key/);
  assert.match(row, /isCurrent:\s*boolean/);
  assert.match(css, /movement-route-dot\.is-current/);
});


test("Movement turnout resources keep their occupancy detector and use it for progress", () => {
  const plan =
    read("src/services/movementPlan.ts");
  const builder =
    read("../desktop/DCCExpressHub.Net/Web/MovementPlanBuilder.cs");
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");
  const row =
    read("src/components/movement/MovementRouteRow.tsx");

  assert.match(plan, /detectors:[\s\S]*trackAddresses\.get/);
  assert.match(builder, /Detectors =[\s\S]*detectors/);
  assert.match(backend, /WaitResourceEntry/);
  assert.match(backend, /ResourceEventSatisfied/);
  assert.match(row, /resource\.kind ===[\s\S]*"turnout"[\s\S]*Detectors:/);
});


test("Movement route condition sequence and action cards can all collapse", () => {
  const row =
    read(
      "src/components/movement/MovementRouteRow.tsx"
    );

  const conditions =
    read(
      "src/components/movement/MovementBlockConditionsEditor.tsx"
    );

  const actions =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  assert.match(
    row,
    /usePersistentCollapsedState/
  );

  assert.match(
    row,
    /routeCollapsed/
  );

  assert.match(
    row,
    /<Collapse[\s\S]*!routeCollapsed/
  );

  assert.match(
    conditions,
    /collapsedSections/
  );

  assert.match(
    conditions,
    /<Collapse[\s\S]*collapsedSections\.has/
  );

  assert.match(
    actions,
    /collapsedSequenceIds/
  );

  assert.match(
    actions,
    /collapsedActionIds/
  );

  assert.match(
    actions,
    /<Collapse[\s\S]*collapsedSequenceIds\.has/
  );

  assert.match(
    actions,
    /<Collapse[\s\S]*collapsedActionIds\.has/
  );
});


test("Movement stores run timing and cards show live elapsed duration", () => {
  const domain =
    read("src/domain/movement.ts");
  const api =
    read("src/services/automationApi.ts");
  const engine =
    read("src/services/movementEngine.ts");
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");
  const elapsed =
    read("src/components/movement/MovementElapsedBadge.tsx");

  assert.match(domain, /startedAt:\s*number \| null/);
  assert.match(domain, /stoppedAt:\s*number \| null/);
  assert.match(engine, /startedAt:\s*number \| null/);
  assert.match(engine, /stoppedAt:\s*number \| null/);
  assert.doesNotMatch(api, /updateAutomationMovementTiming/);
  assert.match(backend, /PersistMovementTimingAsync/);
  assert.match(backend, /target\["startedAt"\]/);
  assert.match(backend, /target\["stoppedAt"\]/);
  assert.match(elapsed, /window\.setInterval/);
});


test("Movement block direction triangle shows executing moving waiting error and target runtime states", () => {
  const runtime =
    read("src/services/movementBlockRuntime.ts");
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");
  const block =
    read("src/models/editor/elements/BlockElement.ts");
  const canvas =
    read("src/components/TrackCanvas.tsx");

  assert.match(runtime, /wsClient\.on\([\s\S]*"movementStateChanged"/);
  assert.match(runtime, /state\.currentBlockId/);
  assert.match(runtime, /state\.targetBlockId/);
  assert.match(runtime, /state\.moving[\s\S]*state\.desiredSpeed/);

  assert.match(backend, /CurrentBlockId/);
  assert.match(backend, /TargetBlockId/);
  assert.match(backend, /bool Moving/);

  assert.match(block, /getMovementBlockRuntime/);
  assert.match(block, /wsClient\.getLatestLocoState/);
  assert.match(block, /movementRuntime\?\.phase ===[\s\S]*"moving"/);
  assert.match(block, /#a3e635/);
  assert.match(block, /#ffd43b/);
  assert.match(block, /#ff6b6b/);
  assert.match(canvas, /subscribeMovementBlockRuntime/);
  assert.match(canvas, /wsClient\.on\("locoState"/);
});


test("Movement waiting indicator survives stopped-speed polling loops", () => {
  const runtime =
    read("src/services/movementBlockRuntime.ts");
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");

  assert.match(runtime, /state\.moving[\s\S]*state\.desiredSpeed[\s\S]*"moving"[\s\S]*"waiting"/);
  assert.match(runtime, /waitingReasonFor/);
  assert.match(runtime, /"route authority"/);
  assert.match(runtime, /"safety sensor"/);

  assert.match(backend, /execution\.Moving = false;[\s\S]*await ApplySpeed/);
  assert.match(backend, /Waiting for block/);
  assert.match(backend, /Waiting for route authority/);
  assert.match(backend, /Waiting for safety sensor/);
});


test("Movement editor no longer uses FROM VIA TO combobox route builder", () => {
  const dialog =
    read(
      "src/components/movement/MovementEditorDialog.tsx"
    );

  const chooser =
    read(
      "src/components/movement/MovementRouteSelectDialog.tsx"
    );

  assert.doesNotMatch(
    dialog,
    /MovementRouteSelector/
  );

  assert.doesNotMatch(
    dialog,
    /movementRouteNavigation/
  );

  assert.match(
    dialog,
    /movementSelectRoute/
  );

  assert.match(
    dialog,
    /activeRouteNames/
  );

  assert.match(
    chooser,
    /loadMovementRouteCandidates\([\s\S]*document/
  );

  assert.match(
    chooser,
    /candidate\.fromBlockName/
  );

  assert.match(
    chooser,
    /candidate\.toBlockName/
  );

  assert.match(
    chooser,
    /candidate\.blockPath/
  );
});

test("selected Movement route stores full graph block path and exact route key", () => {
  const catalog =
    read(
      "src/services/movementRouteCatalog.ts"
    );

  const plan =
    read(
      "src/services/movementPlan.ts"
    );

  assert.match(
    catalog,
    /routeRef:[\s\S]*candidate\.locoDirection/
  );

  assert.match(
    catalog,
    /viaBlockIds:[\s\S]*blockIds\.slice/
  );

  assert.match(
    plan,
    /const exact =/
  );

  assert.match(
    plan,
    /createMovementRouteKey\([\s\S]*route/
  );

  assert.match(
    plan,
    /return exact/
  );
});


test("Movement route chooser has independent clearable FROM and TO filters", () => {
  const dialog =
    read(
      "src/components/movement/MovementRouteSelectDialog.tsx"
    );

  const css =
    read(
      "src/styles/movementEditor.css"
    );

  assert.match(
    dialog,
    /fromFilter/
  );

  assert.match(
    dialog,
    /toFilter/
  );

  assert.match(
    dialog,
    /candidate\.fromBlockName[\s\S]*includes/
  );

  assert.match(
    dialog,
    /candidate\.toBlockName[\s\S]*includes/
  );

  assert.match(
    dialog,
    /setFromFilter\([\s\S]*""/
  );

  assert.match(
    dialog,
    /setToFilter\([\s\S]*""/
  );

  assert.match(
    dialog,
    /IconX/
  );

  assert.match(
    dialog,
    /movementNoRoutesMatchFilter/
  );

  assert.match(
    css,
    /movement-route-candidate-used[\s\S]*mantine-color-red-6/
  );
});


test("Movement route direction badges use distinct forward reverse and unknown colors", () => {
  const dialog =
    read(
      "src/components/movement/MovementRouteSelectDialog.tsx"
    );

  assert.match(
    dialog,
    /candidate\.locoDirection ===[\s\S]*"forward"[\s\S]*\? "blue"/
  );

  assert.match(
    dialog,
    /candidate\.locoDirection ===[\s\S]*"reverse"[\s\S]*\? "orange"/
  );

  assert.match(
    dialog,
    /: "gray"/
  );
});


test("selected Movement route auto-fills name with direction arrows between block names", () => {
  const catalog =
    read(
      "src/services/movementRouteCatalog.ts"
    );

  assert.match(
    catalog,
    /const directionArrow/
  );

  assert.match(
    catalog,
    /"forward"[\s\S]*\? "→"/
  );

  assert.match(
    catalog,
    /"reverse"[\s\S]*\? "←"/
  );

  assert.match(
    catalog,
    /: "↔"/
  );

  assert.match(
    catalog,
    /candidate\.blockPath[\s\S]*join\([\s\S]*directionArrow/
  );

  assert.doesNotMatch(
    catalog,
    /" - "/
  );

  assert.match(
    catalog,
    /name:[\s\S]*generatedName/
  );
});


test("Movement ARRIVED defaults use only the block's own occupancy sensor", () => {
  const vector =
    read(
      "src/services/movementRouteVector.ts"
    );

  const defaults =
    read(
      "src/services/movementRouteDefaults.ts"
    );

  const preview =
    read(
      "src/components/movement/MovementRouteVectorPreview.tsx"
    );

  const dialog =
    read(
      "src/components/movement/MovementEditorDialog.tsx"
    );

  const catalog =
    read(
      "src/services/movementRouteCatalog.ts"
    );

  assert.match(
    vector,
    /export function buildMovementRouteVector/
  );

  assert.match(
    vector,
    /kind:[\s\S]*"segment"/
  );

  assert.match(
    vector,
    /kind:[\s\S]*"block"/
  );

  assert.match(
    vector,
    /loadMovementPlan/
  );

  assert.match(
    vector,
    /plan\.resources\.map/
  );

  assert.match(
    vector,
    /resource\.kind ===[\s\S]*"turnout"/
  );

  assert.match(
    vector,
    /role:[\s\S]*"source"/
  );

  assert.match(
    vector,
    /"destination"/
  );

  assert.match(
    vector,
    /sensor:[\s\S]*segmentSensor/
  );

  assert.match(
    vector,
    /sensor:[\s\S]*blockSensors\.get/
  );

  assert.match(
    defaults,
    /buildMovementRouteVector/
  );

  assert.match(
    defaults,
    /current\.role ===[\s\S]*"source"/
  );

  assert.match(
    defaults,
    /current\.sensor ===[\s\S]*null[\s\S]*\? \[\][\s\S]*state:[\s\S]*true/
  );

  assert.doesNotMatch(
    defaults,
    /const previous =/
  );

  assert.doesNotMatch(
    defaults,
    /const next =/
  );

  assert.doesNotMatch(
    defaults,
    /previous\?\.sensor/
  );

  assert.doesNotMatch(
    defaults,
    /next\?\.sensor/
  );

  assert.match(
    preview,
    /loadMovementRouteVector/
  );

  assert.match(
    preview,
    /<svg/
  );

  assert.match(
    preview,
    /movement-route-vector-node/
  );

  assert.match(
    preview,
    /NO SENSOR/
  );

  assert.match(
    preview,
    /data-route-vector-key/
  );

  assert.match(
    dialog,
    /MovementRouteVectorPreview/
  );

  assert.match(
    catalog,
    /intermediateArrivalDefaults/
  );

  assert.doesNotMatch(
    catalog,
    /generatedRules/
  );
});


test("Movement physical plan reloads when exact route key changes", () => {
  const editor =
    read(
      "src/components/movement/MovementRouteEditor.tsx"
    );

  assert.match(
    editor,
    /const routeSignature =[\s\S]*page\.routeRef/
  );
});


test("Movement route vector merges only an identical single-sensor segment into its block", () => {
  const vector =
    read(
      "src/services/movementRouteVector.ts"
    );

  const preview =
    read(
      "src/components/movement/MovementRouteVectorPreview.tsx"
    );

  assert.match(
    vector,
    /segment\.detectors\.length !==[\s\S]*1/
  );

  assert.match(
    vector,
    /resource\.sensorAddress ===[\s\S]*detector/
  );

  assert.match(
    vector,
    /matchingBlocks\.length !==[\s\S]*1/
  );

  assert.match(
    vector,
    /hiddenSegmentKeys\.add\([\s\S]*segment\.key/
  );

  assert.match(
    vector,
    /mergedSegmentNamesByBlockKey/
  );

  assert.match(
    vector,
    /visibleResources =[\s\S]*!hiddenSegmentKeys\.has/
  );

  assert.match(
    vector,
    /mergedSegmentNames:[\s\S]*mergedSegmentNamesByBlockKey\.get/
  );

  assert.match(
    preview,
    /SEG:\$\{item\.mergedSegmentNames\.join\(","\)\}/
  );

  assert.match(
    preview,
    /movementBlockUpper[\s\S]*mergedSegments/
  );
});

test("Movement vector keeps physical sensors while selected nodes expose a configurable Safety tab", () => {
  const domain =
    read(
      "src/domain/movement.ts"
    );

  const vector =
    read(
      "src/services/movementRouteVector.ts"
    );

  const preview =
    read(
      "src/components/movement/MovementRouteVectorPreview.tsx"
    );

  const routeEditor =
    read(
      "src/components/movement/MovementRouteEditor.tsx"
    );

  const focused =
    read(
      "src/components/movement/MovementSelectedResourceEditor.tsx"
    );

  const safetyEditor =
    read(
      "src/components/movement/MovementSafetyEditor.tsx"
    );

  const safety =
    read(
      "src/services/movementSafety.ts"
    );

  assert.match(
    domain,
    /export type MovementSafetyRule/
  );

  assert.match(
    domain,
    /ignoredSensors:\s*number\[\]/
  );

  assert.match(
    domain,
    /safetyRules:\s*MovementSafetyRule\[\]/
  );

  assert.match(
    vector,
    /sensors: number\[\]/
  );

  assert.doesNotMatch(
    vector,
    /safetySensors/
  );

  assert.match(
    preview,
    /DET \$\{item\.sensors/
  );

  assert.match(
    preview,
    /OCC \$\{item\.sensors/
  );

  assert.doesNotMatch(
    preview,
    /SAFETY|MUST BE FREE|safetySensors/
  );

  assert.match(
    safety,
    /export function movementLegSafetySensors/
  );

  assert.match(
    safety,
    /export function movementLegIgnoredSafetySensors/
  );

  assert.match(
    safety,
    /export function movementLegEffectivePathSafetySensors/
  );

  assert.match(
    routeEditor,
    /const selectedSafetyLeg =/
  );

  assert.match(
    routeEditor,
    /movementLegSafetySensors\([\s\S]*selectedSafetyLeg/
  );

  assert.match(
    routeEditor,
    /updateIgnoredSafetySensors/
  );

  assert.match(
    focused,
    /resource\.kind ===[\s\S]*"block"[\s\S]*value="safety"/
  );

  assert.match(
    focused,
    /resource\.kind ===[\s\S]*"block"[\s\S]*<MovementSafetyEditor/
  );

  assert.match(
    focused,
    /key={[\s\S]*resource\.key[\s\S]*}[\s\S]*defaultValue="conditions"/
  );

  assert.match(
    safetyEditor,
    /movementCheckSensor/
  );

  assert.match(
    safetyEditor,
    /movementSafetyRequiredOff/
  );

  assert.match(
    safetyEditor,
    /IGNORED/
  );
});

test("Movement runtime honors ignored safety sensors but keeps logical target block checks", () => {
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");
  const script =
    read("src/services/movementExecutionScript.ts");
  const routeCatalog =
    read("src/services/movementRouteCatalog.ts");

  assert.match(backend, /EffectiveSafetySensors\([\s\S]*execution\.Page,[\s\S]*leg/);
  assert.match(backend, /TargetBlockBasicallyFree/);
  assert.match(backend, /!block\.HasRuntimeState/);
  assert.match(backend, /SafetyFree/);

  assert.match(script, /IGNORED_BY_SAFETY_OVERRIDE/);
  assert.match(script, /movementLegEffectivePathSafetySensors/);
  assert.match(routeCatalog, /safetyRules:\s*\[\]/);
});

test("Movement intermediate ARRIVED restores cruise only after safety readiness, then ARRIVED actions may override desired speed", () => {
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");
  const script =
    read("src/services/movementExecutionScript.ts");

  assert.match(backend, /var mayKeepRolling =[\s\S]*next\.DepartWhen/);
  assert.match(backend, /TargetBlockBasicallyFree\([\s\S]*next/);
  assert.match(backend, /EffectiveSafetySensors\([\s\S]*execution\.Page,[\s\S]*next/);
  assert.match(backend, /execution\.DesiredSpeed =[\s\S]*execution\.Page\.Speed/);
  assert.match(backend, /execution\.Moving =[\s\S]*mayKeepRolling/);

  const policy =
    backend.indexOf("var mayKeepRolling");
  const arrived =
    backend.indexOf('"arrived"', policy);
  assert.ok(policy >= 0 && arrived > policy);

  assert.match(backend, /case "speed":[\s\S]*execution\.DesiredSpeed =/);
  assert.match(script, /safety\/departure readiness wins before cruise resync/);
});

test("Movement route vector preview is styled by type and prepared for future item clicks", () => {
  const preview =
    read(
      "src/components/movement/MovementRouteVectorPreview.tsx"
    );

  const css =
    read(
      "src/styles/movementEditor.css"
    );

  assert.match(
    preview,
    /onItemClick\?:/
  );

  assert.match(
    preview,
    /selectedKey\?:/
  );

  assert.match(
    preview,
    /movementSourceBlock/
  );

  assert.match(
    preview,
    /movementDestination/
  );

  assert.match(
    preview,
    /SEGMENT/
  );

  assert.match(
    preview,
    /TURNOUT/
  );

  assert.match(
    preview,
    /turnoutStates/
  );

  assert.match(
    css,
    /movement-route-vector-node\.is-source/
  );

  assert.match(
    css,
    /movement-route-vector-node\.is-block/
  );

  assert.match(
    css,
    /movement-route-vector-node\.is-destination/
  );

  assert.match(
    css,
    /movement-route-vector-node\.is-segment/
  );

  assert.match(
    css,
    /movement-route-vector-node\.is-turnout/
  );

  assert.match(
    css,
    /movement-route-vector-node\.is-no-sensor/
  );
});


test("Movement SVG selection opens one focused resource editor and keeps legacy cards hidden", () => {
  const dialog =
    read(
      "src/components/movement/MovementEditorDialog.tsx"
    );

  const routeEditor =
    read(
      "src/components/movement/MovementRouteEditor.tsx"
    );

  const focused =
    read(
      "src/components/movement/MovementSelectedResourceEditor.tsx"
    );

  const vector =
    read(
      "src/services/movementRouteVector.ts"
    );

  assert.match(
    dialog,
    /selectedRouteVectorKey/
  );

  assert.match(
    dialog,
    /onItemClick=[\s\S]*setSelectedRouteVectorKey/
  );

  assert.match(
    dialog,
    /selectedResourceKey=[\s\S]*selectedRouteVectorKey/
  );

  assert.match(
    vector,
    /`segment:\$\{nodeName\}`/
  );

  assert.match(
    routeEditor,
    /const SHOW_LEGACY_ROUTE_CARDS =[\s\S]*false/
  );

  assert.match(
    routeEditor,
    /SHOW_LEGACY_ROUTE_CARDS &&/
  );

  assert.match(
    routeEditor,
    /MovementRouteRow/
  );

  assert.match(
    routeEditor,
    /selectedResourceKey/
  );

  assert.match(
    routeEditor,
    /plan\.resources\.find/
  );

  assert.match(
    routeEditor,
    /MovementSelectedResourceEditor/
  );

  assert.match(
    focused,
    /<Tabs/
  );

  assert.match(
    focused,
    /value="conditions"/
  );

  assert.match(
    focused,
    /Conditions \/ Events/
  );

  assert.match(
    focused,
    /value="actions"/
  );
});


test("Focused Movement Actions tab preserves sequence-capable action editor", () => {
  const focused =
    read(
      "src/components/movement/MovementSelectedResourceEditor.tsx"
    );

  const actions =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  assert.match(
    focused,
    /MovementActionEditor/
  );

  assert.match(
    focused,
    /resourceKey=[\s\S]*resource\.key/
  );

  assert.match(
    actions,
    /type SequenceGroup/
  );

  assert.match(
    actions,
    /sequenceId/
  );

  assert.match(
    actions,
    /MovementSequenceMode/
  );

  assert.match(
    actions,
    /blocking/
  );

  assert.match(
    actions,
    /background/
  );
});


test("Movement direction marker is hidden on idle empty blocks but shown on active target blocks", () => {
  const block =
    read(
      "src/models/editor/elements/BlockElement.ts"
    );

  assert.match(
    block,
    /const occupied =[sS]*hasAssignedLoco[sS]*sensorOccupied/
  );

  assert.match(
    block,
    /const inTransit =[sS]*!occupied[sS]*runtimeTransitLocoAddress > 0/
  );

  assert.match(
    block,
    /occupied \|\|[sS]*inTransit/
  );

  assert.match(
    block,
    /movementRuntime\.phase ===[sS]*"moving"/
  );

  assert.match(
    block,
    /#a3e635/
  );
});


test("Movement final ARRIVED blocking sequences run before the automatic stop", () => {
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");

  const finalLeg =
    backend.indexOf("if (finalLeg)");
  const arrived =
    backend.indexOf('"arrived"', finalLeg);
  const stop =
    backend.indexOf("execution.Moving = false", arrived);
  const applyStop =
    backend.indexOf("await ApplySpeed", stop);

  assert.ok(
    finalLeg >= 0 &&
    arrived > finalLeg &&
    stop > arrived &&
    applyStop > stop,
    "final ARRIVED actions must run before automatic stop"
  );
});



test("Movement never guesses forward when route direction is unknown", () => {
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");

  assert.match(
    backend,
    /if \(plan\.Direction is not \("forward" or "reverse"\)\)[\s\S]*movement_direction_unknown/
  );
  assert.match(
    backend,
    /Forward =[\s\S]*plan\.Direction == "forward"/
  );
});


test("Configured command centers apply locomotive direction inversion", () => {
  const windows =
    read(
      "../desktop/DCCExpressHub.Net/CommandCenter/ConfiguredCommandCenter.cs"
    );

  const esp32 =
    read(
      "../src/ConfiguredCommandCenter.cpp"
    );

  assert.match(
    windows,
    /MapDirection\(int address,bool forward\)=>LocomotiveDirectionInverted\(address\)\?!forward:forward/
  );

  assert.match(
    windows,
    /SetLocoAsync\(address,speed,MapDirection\(address,forward\),ct\)/
  );

  assert.match(
    esp32,
    /const bool physicalForward =[\s\S]*mapDirection\([\s\S]*address,[\s\S]*forward/
  );

  assert.match(
    esp32,
    /_inner\.setLoco\([\s\S]*address,[\s\S]*speed,[\s\S]*physicalForward/
  );
});


test("New Movement sequences and actions never default to a driving speed command", () => {
  const editor =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  const domain =
    read(
      "src/domain/movement.ts"
    );

  assert.match(
    domain,
    /kind: MovementActionKind = "log"/
  );

  assert.doesNotMatch(
    editor,
    /createMovementAction\([\s\S]*resourceKey,[\s\S]*when,[\s\S]*"speed",[\s\S]*sequenceId/
  );

  assert.doesNotMatch(
    editor,
    /createMovementAction\([\s\S]*resourceKey,[\s\S]*current\.when,[\s\S]*"speed",[\s\S]*current\.id/
  );

  assert.match(
    editor,
    /createMovementAction\([\s\S]*resourceKey,[\s\S]*when,[\s\S]*"log",[\s\S]*sequenceId/
  );

  assert.match(
    editor,
    /createMovementAction\([\s\S]*resourceKey,[\s\S]*current\.when,[\s\S]*"log",[\s\S]*current\.id/
  );
});


test("Target locomotive arrows use broadcast live loco state on secondary clients", () => {
  const block =
    read(
      "src/models/editor/elements/BlockElement.ts"
    );

  const canvas =
    read(
      "src/components/TrackCanvas.tsx"
    );

  assert.match(
    block,
    /getBlockTargetLocoAddress\(this\.id\)/
  );

  assert.match(
    block,
    /getLatestLocoState\([\s\S]*displayLocoAddress/
  );

  assert.match(
    block,
    /const liveDirection =[\s\S]*liveLocoState\?\.direction/
  );

  assert.doesNotMatch(
    block,
    /const liveDirection =[\s\S]*this\.locoAddress > 0[\s\S]*liveLocoState\?\.direction/
  );

  assert.match(
    block,
    /const liveMoving =[\s\S]*liveLocoState !==[\s\S]*null[\s\S]*liveLocoState\.speed >/
  );

  assert.doesNotMatch(
    block,
    /const liveMoving =[\s\S]*this\.locoAddress > 0/
  );

  assert.match(
    canvas,
    /getBlockTargetLocoAddress/
  );

  assert.match(
    canvas,
    /const displayLocoAddress =[\s\S]*element\.locoAddress > 0[\s\S]*getBlockTargetLocoAddress\([\s\S]*element\.id/
  );

  assert.match(
    canvas,
    /getLatestLocoState\([\s\S]*displayLocoAddress[\s\S]*\?\.speed/
  );
});

test("Block direction blinking follows live locomotive runtime state", () => {
  const block =
    read(
      "src/models/editor/elements/BlockElement.ts"
    );

  const canvas =
    read(
      "src/components/TrackCanvas.tsx"
    );

  assert.match(
    block,
    /wsClient\.getLatestLocoState\([\s\S]*displayLocoAddress/
  );

  assert.match(
    block,
    /liveLocoState\.speed >[\s\S]*0/
  );

  assert.match(
    canvas,
    /wsClient\.on\("locoState",[\s\S]*invalidate\(\)/
  );

  assert.match(
    canvas,
    /wsClient\.getLatestLocoState\([\s\S]*element\.locoAddress[\s\S]*\?\.speed/
  );

  assert.match(
    canvas,
    /liveLocoMoving/
  );

  assert.match(
    canvas,
    /hasMovingMovementBlockRuntime\(\) \|\|[\s\S]*liveLocoMoving/
  );
});


test("Movement arms the requested logical direction at zero speed before departure", () => {
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");

  assert.match(backend, /async Task ArmDirection/);
  assert.match(backend, /execution\.Moving = false/);
  assert.match(backend, /await ApplySpeed\(execution, force: true\)/);
  assert.match(backend, /await Task\.Delay\(150, execution\.Cancellation\.Token\)/);
  assert.match(backend, /await ArmDirection\(execution\)[\s\S]*RunActions/);
});


test("Movements tab exposes global Stop All, Abort All and Emergency Stop controls", () => {
  const table =
    read(
      "src/components/movement/MovementPagesTable.tsx"
    );

  assert.match(
    table,
    />\s*Stop All\s*</
  );

  assert.match(
    table,
    />\s*Abort All\s*</
  );

  assert.match(
    table,
    /Emergency Stop/
  );

  assert.match(
    table,
    /Clear E-Stop/
  );

  assert.match(
    table,
    /subscribeMovementEngineState/
  );

  assert.match(
    table,
    /activeCount/
  );
});


test("Global Movement abort requests E-STOP at most once", () => {
  const engine =
    read("src/services/movementEngine.ts");
  const table =
    read("src/components/movement/MovementPagesTable.tsx");
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");

  assert.match(engine, /export function abortAllMovements/);
  assert.match(engine, /"abortAll"/);
  assert.match(table, /abortAllMovements\(\)/);
  assert.doesNotMatch(table, /abortMovement\([\s\S]*false/);

  assert.match(backend, /async Task EnsureEmergencyStopAsync/);
  assert.match(backend, /EmergencyPauseStateKnown[\s\S]*EmergencyPaused/);
  assert.match(backend, /if \([\s\S]*_hubState\.EmergencyStop[\s\S]*\)[\s\S]*return;/);
  assert.match(backend, /_commandCenter\.EmergencyStopAsync/);
});


test("Movement action WHEN choices are event tabs with sequence-only creation", () => {
  const editor =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  assert.match(
    editor,
    /<Tabs[\s\S]*value=\{[\s\S]*selectedWhen/
  );

  assert.match(
    editor,
    /options\.map\([\s\S]*<Tabs\.Tab/
  );

  assert.match(
    editor,
    /sequence\.when ===[\s\S]*selectedWhen/
  );

  assert.doesNotMatch(
    editor,
    /label="WHEN"/
  );

  assert.match(
    editor,
    /movementAddBlockingSequence/
  );

  assert.match(
    editor,
    /addSequence\([\s\S]*"blocking"/
  );

  assert.match(
    editor,
    /movementAddBackgroundSequence/
  );

  assert.match(
    editor,
    /addSequence\([\s\S]*"background"/
  );

  assert.match(
    editor,
    /createMovementAction\([\s\S]*resourceKey,[\s\S]*selectedWhen,[\s\S]*"log",[\s\S]*sequenceId,[\s\S]*mode/
  );

  assert.match(
    editor,
    /visibleSequences\.map/
  );
});


test("Movement action event tabs strongly highlight the selected event", () => {
  const editor =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  const css =
    read(
      "src/styles/movementEditor.css"
    );

  assert.match(
    editor,
    /className="movement-action-event-tabs"/
  );

  assert.ok(
    css.includes(
      ".movement-action-event-tabs .mantine-Tabs-tab[data-active]"
    )
  );

  assert.ok(
    css.includes(
      "border-bottom-color: var(--mantine-color-yellow-5)"
    )
  );

  assert.ok(
    css.includes(
      "var(--mantine-color-violet-7)"
    )
  );
});

test("Movement action event tabs follow physical event order for each resource kind", () => {
  const editor =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  const approach =
    editor.indexOf(
      '"approach"'
    );

  const arrived =
    editor.indexOf(
      '"arrived"',
      approach
    );

  assert.ok(
    approach >= 0 &&
    arrived > approach,
    "Block action tabs must expose APPROACH before ARRIVED"
  );

  assert.match(
    editor,
    /"beforeDepart"[\s\S]*"depart"[\s\S]*"leave"[\s\S]*"afterLeave"/
  );

  assert.match(
    editor,
    /kind ===[\s\S]*"turnout"[\s\S]*"approach"[\s\S]*"leave"/
  );

  assert.match(
    editor,
    /"enter"[\s\S]*"leave"/
  );
});


test("Movement sequence mode is fixed by its add button", () => {
  const actionEditor =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  assert.match(
    actionEditor,
    /hasBlockingSequence/
  );

  assert.match(
    actionEditor,
    /hasBackgroundSequence/
  );

  assert.match(
    actionEditor,
    /movementAddBlockingSequence/
  );

  assert.match(
    actionEditor,
    /movementAddBackgroundSequence/
  );

  assert.match(
    actionEditor,
    /movementBlockingSequence/
  );

  assert.match(
    actionEditor,
    /movementBackgroundSequence/
  );

  assert.match(
    actionEditor,
    /sequence\.when ===[\s\S]*selectedWhen[\s\S]*sequence\.mode ===[\s\S]*mode/
  );

  assert.doesNotMatch(
    actionEditor,
    /SEQUENCE_MODE_OPTIONS/
  );

  assert.doesNotMatch(
    actionEditor,
    /label="MODE"/
  );
});


test("Movement editor uses the current in-memory route graph while runtime keeps saved layout authority", () => {
  const layoutPage =
    read("src/LiteLayoutPage.tsx");
  const dialog =
    read("src/components/movement/MovementEditorDialog.tsx");
  const selector =
    read("src/components/movement/MovementRouteSelectDialog.tsx");
  const routeEditor =
    read("src/components/movement/MovementRouteEditor.tsx");
  const cache =
    read("src/services/clientRouteGraphCache.ts");
  const engine =
    read("src/services/movementEngine.ts");
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");

  assert.match(layoutPage, /<MovementEditorDialog[\s\S]*layout=\{layout\}/);
  assert.match(dialog, /layout:[\s\S]*LayoutView/);
  assert.match(selector, /createCurrentClientLayoutSnapshot/);
  assert.match(routeEditor, /loadMovementPlan/);
  assert.match(cache, /createCurrentClientLayoutSnapshot/);

  assert.match(engine, /pageId:[\s\S]*page\.id/);
  assert.doesNotMatch(engine, /loadMovementPlan\(/);
  assert.doesNotMatch(engine, /createCurrentClientLayoutSnapshot/);

  assert.match(backend, /LoadSavedMovementPage\([\s\S]*pageId/);
  assert.match(backend, /plan = _planBuilder\.Build\(page\)/);
});


test("New Movement station blocks get blocking dwell defaults only on first route selection", () => {
  const catalog =
    read(
      "src/services/movementRouteCatalog.ts"
    );

  assert.match(
    catalog,
    /applyNewMovementDefaults[\s\S]*page\.routeRef[\s\S]*page\.actions\.length/
  );

  assert.match(
    catalog,
    /block\.blockType !==[\s\S]*"station"/
  );

  assert.match(
    catalog,
    /createMovementAction\\([\\s\\S]*"beforeDepart"[\\s\\S]*"delay"[\s\S]*"blocking"/
  );

  assert.match(
    catalog,
    /fixedWait\.delayMs =[\s\S]*10000/
  );

  assert.match(
    catalog,
    /createMovementAction\\([\\s\\S]*"beforeDepart"[\\s\\S]*"randomDelay"[\s\S]*"blocking"/
  );

  assert.match(
    catalog,
    /randomWait\.minDelayMs =[\s\S]*0/
  );

  assert.match(
    catalog,
    /randomWait\.maxDelayMs =[\s\S]*5000/
  );
});


test("Automation panel remembers the active Scripts Flows Movement tab", () => {
  const source =
    read(
      "src/components/AutomationPanel.tsx"
    );

  assert.match(
    source,
    /dcc-express-hub\.automation\.activeTab/
  );

  assert.match(
    source,
    /useState<AutomationPanelTab>\(\s*loadAutomationPanelTab/
  );

  assert.match(
    source,
    /localStorage\.getItem/
  );

  assert.match(
    source,
    /localStorage\.setItem/
  );

  assert.match(
    source,
    /value=\{[\s\S]*activeTab[\s\S]*\}[\s\S]*onChange=\{[\s\S]*changeTab/
  );
});


test("Movement keeps contextual event help inline and loads general help from localized static HTML", () => {
  const actionEditor =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  const editorDialog =
    read(
      "src/components/movement/MovementEditorDialog.tsx"
    );

  assert.match(
    actionEditor,
    /eventHelpKey\(\s*selectedWhen/
  );

  assert.doesNotMatch(
    actionEditor,
    /IconQuestionMark/
  );

  assert.match(
    editorDialog,
    /movement-editor-header-help/
  );

  assert.match(
    editorDialog,
    /\/help\/movement\.\$\{helpLanguage\}\.html/
  );

  assert.match(
    editorDialog,
    /movement-help-frame/
  );

  for (
    const language of
    ["hu", "en", "de"]
  ) {
    const html =
      read(
        `public/help/movement.${language}.html`
      );

    assert.match(
      html,
      /<!doctype html>/i
    );

    assert.match(
      html,
      /Safety|Biztonsági|Sicherheit/i
    );
  }
});


test("Movement supports random audio and DCC accessory actions", () => {
  const domain =
    read("src/domain/movement.ts");
  const backend =
    read("../desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");
  const editor =
    read("src/components/movement/MovementActionEditor.tsx");
  const script =
    read("src/services/movementExecutionScript.ts");

  for (const kind of ["randomPlay", "setAccessory", "setExtendedAccessory"]) {
    assert.match(domain, new RegExp(`"${kind}"`));
    assert.match(editor, new RegExp(`"${kind}"`));
  }

  assert.match(backend, /case "randomPlay":[\s\S]*Random\.Shared\.Next/);
  assert.match(backend, /case "setAccessory":[\s\S]*SetBasicAccessoryAction/);
  assert.match(backend, /case "setExtendedAccessory":[\s\S]*SetExtendedAccessoryAction/);
  assert.match(script, /RANDOM_1_TO_10/);
  assert.match(script, /SET_BASIC_ACCESSORY/);
  assert.match(script, /SET_EXTENDED_ACCESSORY/);
});


test("WebSocket sensor state is sticky for late Movement subscribers", () => {
  const wsClient =
    read(
      "src/services/wsClient.ts"
    );

  assert.match(
    wsClient,
    /latestSensorStates/
  );

  assert.match(
    wsClient,
    /message\.type === "sensorChanged"[\s\S]*latestSensorStates\.set/
  );

  assert.match(
    wsClient,
    /message\.type === "sensorSnapshot"[\s\S]*latestSensorStates\.set/
  );

  assert.match(
    wsClient,
    /type === "sensorChanged"[\s\S]*latestSensorStates/
  );

  assert.match(
    wsClient,
    /type ===[\s\S]*"sensorSnapshot"[\s\S]*latestSensorStates/
  );

  assert.match(
    wsClient,
    /latestSensorStates\.clear\(\)/
  );
});
