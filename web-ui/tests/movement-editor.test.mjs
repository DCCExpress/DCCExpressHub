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
    /New movement/
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
    /Depart when/
  );

  assert.match(
    blockConditions,
    /Leave when/
  );

  assert.match(
    blockConditions,
    /Arrived when/
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

  const runtimeControls =
    read(
      "src/components/movement/MovementRuntimeControls.tsx"
    );

  const sidebarCard =
    read(
      "src/components/movement/MovementSidebarCard.tsx"
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
    /isTrackPowerOn\(\)/
  );

  assert.match(
    engine,
    /Track power is OFF\. Turn it on before starting Movement\./
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
    /MovementRuntimeControls/
  );

  assert.match(
    runtimeControls,
    /startMovement/
  );

  assert.match(
    runtimeControls,
    /stopMovement/
  );

  assert.match(
    runtimeControls,
    /abortMovement/
  );

  assert.match(
    runtimeControls,
    /isTrackPowerOn/
  );

  assert.match(
    runtimeControls,
    /subscribeTrackPower/
  );

  assert.match(
    runtimeControls,
    /Track power is OFF/
  );

  assert.match(
    runtimeControls,
    /!trackPowerOn/
  );

  assert.match(
    sidebarCard,
    /MovementRuntimeControls/
  );

  assert.match(
    sidebarCard,
    /useMovementRuntimeState/
  );

  assert.match(
    actionEditor,
    /Sequences/
  );

  assert.match(
    actionEditor,
    /Blocking/
  );

  assert.match(
    actionEditor,
    /Background/
  );

  assert.match(
    actionEditor,
    /value:\s*"leave"[\s\S]*label:\s*"LEAVE"/
  );

  assert.doesNotMatch(
    actionEditor,
    /Set turnout/
  );

  assert.match(
    actionEditor,
    /AudioFileInput/
  );

  assert.match(
    actionEditor,
    /allowManualInput=\{\s*false\s*\}/
  );

  assert.match(
    actionEditor,
    /audioManager\.play/
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
    /routeKey:\s*string/
  );

  assert.match(
    domain,
    /routeKey:\s*""/
  );

  assert.match(
    plan,
    /page\.routeKey\.trim/
  );

  assert.match(
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
  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  assert.match(
    engine,
    /createBlockLeaveState/
  );

  assert.match(
    engine,
    /seenOccupied/
  );

  assert.match(
    engine,
    /sensorStates\.get\([\s\S]*sensorAddress[\s\S]*\) ===[\s\S]*true/
  );

  assert.match(
    engine,
    /maybeRunBlockLeave/
  );

  assert.match(
    engine,
    /leg\.from\.key,[\s\S]*"leave"/
  );

  assert.match(
    engine,
    /runBlockLeaveFallback/
  );
});


test("Movement block conditions support DEPART LEAVE and ARRIVED sensor rules", () => {
  const domain =
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

  const editor =
    read(
      "src/components/movement/MovementBlockConditionsEditor.tsx"
    );

  assert.match(
    domain,
    /departWhen:\s*MovementSensorCondition\[\]/
  );

  assert.match(
    domain,
    /leaveWhen:\s*MovementSensorCondition\[\]/
  );

  assert.match(
    domain,
    /arrivedWhen:\s*MovementSensorCondition\[\]/
  );

  assert.match(
    domain,
    /candidate\.departWhen/
  );

  assert.match(
    domain,
    /candidate\.leaveWhen/
  );

  assert.match(
    plan,
    /departureRuleFor/
  );

  assert.match(
    plan,
    /leaveRuleFor/
  );

  assert.match(
    plan,
    /leaveWhenExplicit/
  );

  assert.match(
    engine,
    /waitForDepartureConditions/
  );

  assert.match(
    engine,
    /Waiting for departure/
  );

  assert.match(
    engine,
    /Waiting for leave/
  );

  assert.match(
    engine,
    /conditionsSatisfied/
  );

  assert.match(
    editor,
    /"departWhen"/
  );

  assert.match(
    editor,
    /"leaveWhen"/
  );

  assert.match(
    editor,
    /"arrivedWhen"/
  );

  assert.match(
    editor,
    /Default: depart as soon as route authority is available/
  );

  assert.match(
    editor,
    /Default: source block occupancy sensor OFF/
  );

  assert.match(
    editor,
    /Default: destination occupancy ON/
  );
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
    read(
      "src/domain/movement.ts"
    );

  const actionEditor =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  const routeRow =
    read(
      "src/components/movement/MovementRouteRow.tsx"
    );

  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  assert.match(
    domain,
    /\| "beforeDepart"/
  );

  assert.match(
    domain,
    /\| "afterLeave"/
  );

  assert.match(
    domain,
    /"beforeDepart"[\s\S]*"afterLeave"/
  );

  assert.match(
    actionEditor,
    /label:\s*"BEFORE DEPART"/
  );

  assert.match(
    actionEditor,
    /label:\s*"AFTER LEAVE"/
  );

  assert.match(
    actionEditor,
    /isSource\?: boolean/
  );

  assert.match(
    actionEditor,
    /isDestination\?: boolean/
  );

  assert.match(
    actionEditor,
    /isDestination[\s\S]*return \[[\s\S]*"arrived"/
  );

  assert.match(
    routeRow,
    /isSource=\{[\s\S]*isSource/
  );

  assert.match(
    routeRow,
    /isDestination=\{[\s\S]*isDestination/
  );

  assert.match(
    engine,
    /waitForPreDepartureAvailability/
  );

  assert.match(
    engine,
    /"beforeDepart"/
  );

  assert.match(
    engine,
    /"afterLeave"/
  );

  const preDepart =
    engine.indexOf(
      '"beforeDepart"'
    );

  const acquire =
    engine.indexOf(
      "waitForLegClearance",
      preDepart
    );

  assert.ok(
    preDepart >= 0 &&
    acquire >
      preDepart,
    "BEFORE DEPART must run before route/turnout lock acquisition"
  );

  const sourceRelease =
    engine.indexOf(
      "wsApi.setBlockRemove"
    );

  const afterLeave =
    engine.indexOf(
      '"afterLeave"',
      sourceRelease
    );

  assert.ok(
    sourceRelease >= 0 &&
    afterLeave >
      sourceRelease,
    "AFTER LEAVE must run after source block runtime release"
  );
});


test("Movement actions are draggable inside their sequence order", () => {
  const actionEditor =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  assert.match(
    actionEditor,
    /type DragEvent/
  );

  assert.match(
    actionEditor,
    /useState<string \| null>/
  );

  assert.match(
    actionEditor,
    /IconGripVertical/
  );

  assert.match(
    actionEditor,
    /draggable/
  );

  assert.match(
    actionEditor,
    /onDragStart/
  );

  assert.match(
    actionEditor,
    /onDragOver/
  );

  assert.match(
    actionEditor,
    /moveActionByOffset/
  );

  assert.match(
    actionEditor,
    /draggedActionId/
  );

  assert.match(
    actionEditor,
    /sequence\.actions\.some/
  );

  assert.match(
    actionEditor,
    /actionIndex \+ 1/
  );

  assert.match(
    actionEditor,
    /moveAction\(/
  );

  assert.match(
    actionEditor,
    /BEFORE DEPART/
  );

  assert.match(
    actionEditor,
    /AFTER LEAVE/
  );

  assert.match(
    engine,
    /execution\.page\.actions\.filter\([\s\S]*action\.when ===[\s\S]*when/
  );
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
    read(
      "src/domain/movement.ts"
    );

  const editor =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  assert.match(
    domain,
    /MovementSequenceMode/
  );

  assert.match(
    domain,
    /sequenceId:\s*string/
  );

  assert.match(
    domain,
    /sequenceMode:\s*MovementSequenceMode/
  );

  assert.match(
    domain,
    /candidate\.sequenceMode ===[\s\S]*"background"/
  );

  assert.match(
    domain,
    /legacySequenceIds/
  );

  assert.match(
    editor,
    /Sequence \{sequenceIndex \+ 1\}/
  );

  assert.match(
    editor,
    /SEQUENCE_MODE_OPTIONS/
  );

  assert.match(
    editor,
    /value:\s*"blocking"/
  );

  assert.match(
    editor,
    /value:\s*"background"/
  );

  assert.match(
    engine,
    /runActionSequence/
  );

  assert.match(
    engine,
    /startBackgroundSequence/
  );

  assert.match(
    engine,
    /execution\.backgroundTasks/
  );

  assert.match(
    engine,
    /Promise\.allSettled/
  );
});


test("Movement destination block exposes and fires APPROACH before ARRIVED", () => {
  const editor =
    read(
      "src/components/movement/MovementActionEditor.tsx"
    );

  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  assert.match(
    editor,
    /isDestination[\s\S]*"approach"[\s\S]*"arrived"/
  );

  assert.match(
    engine,
    /approachSegments/
  );

  assert.match(
    engine,
    /approachSegment/
  );

  assert.match(
    engine,
    /leg\.to\.key,[\s\S]*"approach"/
  );

  const approach =
    engine.indexOf(
      "approachSegment?.key"
    );

  const arrivalWait =
    engine.indexOf(
      "await waitForArrival",
      approach
    );

  assert.ok(
    approach >= 0,
    "Destination APPROACH action trigger missing"
  );

  assert.ok(
    arrivalWait >
      approach,
    "Destination APPROACH must be wired before arrival wait"
  );
});


test("Movement physical route highlights stable physical runtime progress", () => {
  const editor =
    read(
      "src/components/movement/MovementRouteEditor.tsx"
    );

  const row =
    read(
      "src/components/movement/MovementRouteRow.tsx"
    );

  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  const css =
    read(
      "src/styles/movementEditor.css"
    );

  assert.match(
    editor,
    /useMovementRuntimeState/
  );

  assert.match(
    editor,
    /runtimeState\.activeRouteResourceKey/
  );

  assert.doesNotMatch(
    editor,
    /runtimeState\.currentResourceKey ===[\s\S]*resource\.key/
  );

  assert.match(
    engine,
    /activeRouteResourceKey:\s*string \| null/
  );

  assert.match(
    engine,
    /function setActiveRouteResource/
  );

  assert.match(
    engine,
    /setActiveRouteResource\([\s\S]*leg\.from\.key/
  );

  assert.match(
    engine,
    /waitForResourceEntry\([\s\S]*setActiveRouteResource\([\s\S]*resource\.key/
  );

  assert.match(
    engine,
    /waitForArrival\([\s\S]*setActiveRouteResource\([\s\S]*leg\.to\.key/
  );


  assert.match(
    engine,
    /status:[\s\S]*"idle"[\s\S]*activeRouteResourceKey:[\s\S]*null/
  );

  assert.match(
    editor,
    /isCurrent=/
  );

  assert.match(
    row,
    /isCurrent:\s*boolean/
  );

  assert.match(
    row,
    /movement-route-dot[\s\S]*is-current/
  );

  assert.match(
    row,
    /movement-physical-route-card[\s\S]*is-current/
  );

  assert.match(
    css,
    /movement-route-dot\.is-current/
  );

  assert.match(
    css,
    /width:\s*34px/
  );

  assert.match(
    css,
    /mantine-color-red-8/
  );

  assert.match(
    css,
    /mantine-color-yellow-3/
  );

  assert.match(
    css,
    /movement-current-step-pulse/
  );
});


test("Movement turnout resources keep their occupancy detector and use it for progress", () => {
  const plan =
    read(
      "src/services/movementPlan.ts"
    );

  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  const row =
    read(
      "src/components/movement/MovementRouteRow.tsx"
    );

  assert.match(
    plan,
    /sensorAddress:[\s\S]*trackAddresses\.get\([\s\S]*elementId/
  );

  assert.match(
    plan,
    /detectors:[\s\S]*trackAddresses\.get\([\s\S]*elementId/
  );

  assert.match(
    engine,
    /resource\.kind ===[\s\S]*"turnout"[\s\S]*await waitForResourceEntry/
  );

  assert.match(
    engine,
    /waitForResourceEntry[\s\S]*resource\.detectors\.some/
  );

  assert.match(
    row,
    /resource\.kind ===[\s\S]*"turnout"[\s\S]*Detectors:/
  );
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
    read(
      "src/domain/movement.ts"
    );

  const api =
    read(
      "src/services/automationApi.ts"
    );

  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  const elapsed =
    read(
      "src/components/movement/MovementElapsedBadge.tsx"
    );

  const cards =
    read(
      "src/components/movement/MovementPagesTable.tsx"
    );

  const sidebar =
    read(
      "src/components/movement/MovementSidebarCard.tsx"
    );

  const editor =
    read(
      "src/components/movement/MovementEditorDialog.tsx"
    );

  assert.match(
    domain,
    /startedAt:\s*number \| null/
  );

  assert.match(
    domain,
    /stoppedAt:\s*number \| null/
  );

  assert.match(
    domain,
    /startedAt:\s*null[\s\S]*stoppedAt:\s*null/
  );

  assert.match(
    api,
    /updateAutomationMovementTiming/
  );

  assert.match(
    engine,
    /stoppedAt:\s*number \| null/
  );

  assert.match(
    engine,
    /persistMovementTiming/
  );

  assert.match(
    engine,
    /const startedAt =[\s\S]*Date\.now\(\)/
  );

  assert.match(
    engine,
    /const stoppedAt =[\s\S]*Date\.now\(\)/
  );

  assert.match(
    elapsed,
    /window\.setInterval/
  );

  assert.match(
    elapsed,
    /1000/
  );

  assert.match(
    elapsed,
    /padStart\([\s\S]*2/
  );

  assert.match(
    elapsed,
    /\(\$\{safeSeconds\} s\)/
  );

  assert.match(
    cards,
    /MovementElapsedBadge/
  );

  assert.match(
    sidebar,
    /MovementElapsedBadge/
  );

  assert.match(
    cards,
    /getMovementEngineState/
  );

  assert.match(
    editor,
    /runtime\.startedAt/
  );

  assert.match(
    editor,
    /runtime\.stoppedAt/
  );
});


test("Movement block direction triangle shows executing moving waiting error and target runtime states", () => {
  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  const runtime =
    read(
      "src/services/movementBlockRuntime.ts"
    );

  const block =
    read(
      "src/models/editor/elements/BlockElement.ts"
    );

  const canvas =
    read(
      "src/components/TrackCanvas.tsx"
    );

  assert.match(
    runtime,
    /MovementBlockRuntimePhase/
  );

  assert.match(
    runtime,
    /\| "moving"/
  );

  assert.match(
    runtime,
    /\| "executing"/
  );

  assert.match(
    runtime,
    /\| "waiting"/
  );

  assert.match(
    runtime,
    /\| "error"/
  );

  assert.match(
    engine,
    /targetBlockId:\s*number \| null/
  );

  assert.match(
    engine,
    /execution\.targetBlockId =[\s\S]*leg\.to\.blockId/
  );

  assert.match(
    engine,
    /syncMovementMotionRuntime[\s\S]*execution\.currentBlockId[\s\S]*"moving"[\s\S]*execution\.targetBlockId[\s\S]*"moving"/
  );

  assert.match(
    engine,
    /setMovementExecuting/
  );

  assert.match(
    engine,
    /for \(const action of actions\)[\s\S]*reportInfo[\s\S]*setMovementExecuting/
  );

  assert.match(
    engine,
    /physicalSpeed >[\s\S]*0/
  );

  assert.match(
    engine,
    /setMovementError/
  );

  assert.match(
    engine,
    /"departureCondition"/
  );

  assert.match(
    engine,
    /"targetBlock"/
  );

  assert.match(
    engine,
    /"segment"/
  );

  assert.match(
    engine,
    /"resourceLock"/
  );

  assert.match(
    engine,
    /"turnoutLock"/
  );

  assert.match(
    block,
    /getMovementBlockRuntime/
  );


  assert.match(
    block,
    /baseForwardRotation =[\s\S]*runtimeForwardRotation[\s\S]*\?\?[\s\S]*this\.rotation/
  );

  assert.doesNotMatch(
    block,
    /!movementRuntime[\s\S]*runtimeForwardRotation === null[\s\S]*return/
  );

  assert.match(
    block,
    /movementRuntime\.direction ===[\s\S]*"reverse"[\s\S]*180/
  );

  assert.match(
    block,
    /movementRuntime\.phase ===[\s\S]*"moving"/
  );

  assert.match(
    block,
    /movementRuntime\.phase ===[\s\S]*"moving"[\s\S]*movementRuntime\.phase ===[\s\S]*"executing"/
  );

  assert.match(
    block,
    /#a3e635/
  );

  assert.match(
    block,
    /#ffd43b/
  );

  assert.match(
    block,
    /#ff6b6b/
  );


  assert.match(
    runtime,
    /hasMovingMovementBlockRuntime[\s\S]*state\.phase ===[\s\S]*"moving"/
  );

  assert.match(
    block,
    /!movementRuntime[\s\S]*return/
  );

  assert.doesNotMatch(
    block,
    /gainsboro/
  );

  assert.match(
    block,
    /Date\.now\(\)/
  );


  assert.match(
    block,
    /const arrowLength = 6/
  );

  assert.match(
    block,
    /const arrowHalfHeight = 4/
  );

  assert.match(
    canvas,
    /subscribeMovementBlockRuntime/
  );

  assert.match(
    canvas,
    /hasMovingMovementBlockRuntime\(\)/
  );
});


test("Movement waiting indicator survives stopped-speed polling loops", () => {
  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  const runtime =
    read(
      "src/services/movementBlockRuntime.ts"
    );

  assert.match(
    runtime,
    /clearMovementBlockRuntimeByOwnerPhase/
  );

  const syncStart =
    engine.indexOf(
      "function syncMovementMotionRuntime"
    );

  const syncEnd =
    engine.indexOf(
      "function setMovementError",
      syncStart
    );

  const sync =
    engine.slice(
      syncStart,
      syncEnd
    );

  assert.match(
    sync,
    /physicalSpeed <=[\s\S]*0[\s\S]*clearMovementBlockRuntimeByOwnerPhase\([\s\S]*"moving"/
  );

  assert.doesNotMatch(
    sync,
    /physicalSpeed <=[\s\S]*0[\s\S]*clearMovementBlockRuntimeByOwner\([\s\S]*return/
  );

  assert.match(
    engine,
    /Waiting for block/
  );

  assert.match(
    engine,
    /setMovementWaiting/
  );
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
    /routeKey:[\s\S]*candidate\.key/
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
