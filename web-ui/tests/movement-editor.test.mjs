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
    navigation,
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
    /moveDraggedActionToIndex/
  );

  assert.match(
    actionEditor,
    /moveActionByOffset/
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
    /movement-action-card-header[\s\S]*black 24%/
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
      'leg.to.key,\n          "approach"'
    );

  const arrived =
    engine.indexOf(
      'leg.to.key,\n      "arrived"'
    );

  assert.ok(
    approach >= 0,
    "Destination APPROACH action trigger missing"
  );

  assert.ok(
    arrived >= 0,
    "Destination ARRIVED action trigger missing"
  );
});
