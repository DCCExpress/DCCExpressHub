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

test("automation storage preserves visualFlow while scripts and timetable are saved", () => {
  const source =
    read(
      "src/services/automationApi.ts"
    );

  assert.match(
    source,
    /visualFlow\?: AutomationFlowDocument/
  );

  assert.match(
    source,
    /saveAutomationScripts[\s\S]*current\.visualFlow/
  );

  assert.match(
    source,
    /saveAutomationTimetable[\s\S]*current\.visualFlow/
  );

  assert.match(
    source,
    /export async function saveAutomationFlow/
  );
});

test("layout automation toolbar opens the visual flow editor after the routes control", () => {
  const source =
    read(
      "src/LiteLayoutPage.tsx"
    );

  const routesButton =
    source.indexOf(
      "setRoutesOpened(true)"
    );

  const flowButton =
    source.indexOf(
      "setAutomationFlowOpened(true)"
    );

  assert.ok(
    routesButton >= 0,
    "routes button missing"
  );

  assert.ok(
    flowButton > routesButton,
    "flow editor button must follow the routes button"
  );

  assert.match(
    source,
    /<AutomationFlowDialog[\s\S]*opened=\{automationFlowOpened\}/
  );
});

test("visual flow editor supports pages, enabled state and SmartDispatcher nodes", () => {
  const editor =
    read(
      "src/components/automation/AutomationFlowDialog.tsx"
    );

  const palette =
    read(
      "src/components/automation/AutomationFlowPalette.tsx"
    );

  assert.match(
    editor,
    /const addPage/
  );

  assert.match(
    editor,
    /const deleteActivePage/
  );

  assert.match(
    editor,
    /activePage\.enabled/
  );

  assert.match(
    palette,
    /kind: "smartDispatcher"/
  );

  assert.match(
    editor,
    /arrivalRules/
  );

  assert.match(
    editor,
    /<ReactFlow/
  );
});

test("visual flow generator emits the existing smartDispatcher API", () => {
  const source =
    read(
      "src/domain/automationFlow.ts"
    );

  assert.match(
    source,
    /"await smartDispatcher\("/
  );

  assert.match(
    source,
    /run\.setSpeed/
  );

  assert.match(
    source,
    /run\.waitForBlock/
  );

  assert.match(
    source,
    /arrivedWhen/
  );
});


test("node palette is grouped into persistent collapsible categories", () => {
  const editor =
    read(
      "src/components/automation/AutomationFlowPalette.tsx"
    );

  const collapsible =
    read(
      "src/components/common/CollapsiblePanelCard.tsx"
    );

  const hook =
    read(
      "src/hooks/usePersistentCollapsedState.ts"
    );

  assert.match(
    editor,
    /const GROUPS/
  );

  assert.match(
    editor,
    /<CollapsiblePanelCard/
  );

  assert.match(
    editor,
    /dcc-express-flow-palette-/
  );

  assert.match(
    collapsible,
    /<Collapse/
  );

  assert.match(
    hook,
    /localStorage\.setItem/
  );
});

test("basic DCC command nodes generate script API calls", () => {
  const source =
    read(
      "src/domain/automationFlow.ts"
    );

  assert.match(
    source,
    /case "setSensor":[\s\S]*dcc\.setSensor/
  );

  assert.match(
    source,
    /case "setTurnout":[\s\S]*dcc\.setTurnout/
  );

  assert.match(
    source,
    /case "setAccessory":[\s\S]*dcc\.setAccessory/
  );
});


test("flow inspector has Properties and Log tabs", () => {
  const inspector =
    read(
      "src/components/automation/AutomationFlowInspector.tsx"
    );

  assert.match(
    inspector,
    /value="properties"/
  );

  assert.match(
    inspector,
    /value="log"/
  );

  assert.match(
    inspector,
    /AutomationFlowLogPanel/
  );
});

test("flow runtime log subscribes to real client script log messages", () => {
  const runner =
    read(
      "src/services/clientScriptRunner.ts"
    );

  const hook =
    read(
      "src/components/automation/useAutomationFlowExecution.ts"
    );

  assert.match(
    runner,
    /export function subscribeClientScriptLog/
  );

  assert.match(
    runner,
    /emitLog\([\s\S]*message\.values/
  );

  assert.match(
    hook,
    /subscribeClientScriptLog/
  );
});

test("trigger supports manual editor inject and interval mode", () => {
  const domain =
    read(
      "src/domain/automationFlow.ts"
    );

  const palette =
    read(
      "src/components/automation/AutomationFlowPalette.tsx"
    );

  const dialog =
    read(
      "src/components/automation/AutomationFlowDialog.tsx"
    );

  assert.match(
    domain,
    /triggerMode/
  );

  assert.match(
    domain,
    /wrapWithTrigger/
  );

  assert.match(
    domain,
    /startTask/
  );

  assert.match(
    palette,
    /kind: "trigger"/
  );

  assert.match(
    dialog,
    /flowExecution\.runTest/
  );

  assert.match(
    dialog,
    /flowExecution\.run\(\)/
  );
});

test("sensor nodes are event inputs and the runtime scans enabled pages", () => {
  const domain =
    read(
      "src/domain/automationFlow.ts"
    );

  const palette =
    read(
      "src/components/automation/AutomationFlowPalette.tsx"
    );

  const properties =
    read(
      "src/components/automation/AutomationFlowPropertiesPanel.tsx"
    );

  const runtime =
    read(
      "src/components/automation/useAutomationFlowRuntime.ts"
    );

  const layoutPage =
    read(
      "src/LiteLayoutPage.tsx"
    );

  assert.match(
    domain,
    /\| "sensorInput"/
  );

  assert.match(
    domain,
    /inputNodeId\?: string/
  );

  assert.match(
    domain,
    /requestedKind ===[\s\S]*"trigger"[\s\S]*candidate\.triggerMode ===[\s\S]*"sensor"[\s\S]*"sensorInput"/
  );

  assert.match(
    domain,
    /node\.data\.kind ===[\s\S]*"waitForSensor"[\s\S]*node\.data\.kind =[\s\S]*"sensorInput"/
  );

  assert.match(
    palette,
    /kind: "sensorInput"/
  );

  assert.match(
    properties,
    /flowSensorInputDescription/
  );

  assert.match(
    runtime,
    /wsClient\.on\([\s\S]*"sensorChanged"/
  );

  assert.match(
    runtime,
    /node\.data\.kind ===[\s\S]*"sensorInput"/
  );

  assert.match(
    runtime,
    /node\.data\.triggerMode ===[\s\S]*"interval"/
  );

  assert.match(
    runtime,
    /generateAutomationFlowPageScript\([\s\S]*inputNodeId/
  );

  assert.match(
    layoutPage,
    /useAutomationFlowRuntime\([\s\S]*automationFlow/
  );
});

test("flow runtime global and page disable abort active flow executions", () => {
  const layoutPage =
    read(
      "src/LiteLayoutPage.tsx"
    );

  const runtime =
    read(
      "src/components/automation/useAutomationFlowRuntime.ts"
    );

  const cards =
    read(
      "src/components/automation/AutomationFlowsTable.tsx"
    );

  assert.match(
    layoutPage,
    /flowRuntimeEnabled/
  );

  assert.match(
    layoutPage,
    /useAutomationFlowRuntime\([\s\S]*automationFlow,[\s\S]*flowRuntimeEnabled/
  );

  assert.match(
    runtime,
    /abortAllAutomationFlowExecutions/
  );

  assert.match(
    runtime,
    /abortAutomationFlowPageExecutions/
  );

  assert.match(
    cards,
    /flowRunFlows/
  );

  assert.match(
    cards,
    /abortAllAutomationFlowExecutions/
  );

  assert.match(
    cards,
    /abortAutomationFlowPageExecutions/
  );
});

test("flow editor is split into palette, properties, log and inspector components", () => {
  const dialog =
    read(
      "src/components/automation/AutomationFlowDialog.tsx"
    );

  assert.match(
    dialog,
    /AutomationFlowPalette/
  );

  assert.match(
    dialog,
    /AutomationFlowInspector/
  );

  assert.doesNotMatch(
    dialog,
    /const renderNodeProperties/
  );
});


test("trigger injects a typed payload and downstream nodes share it", () => {
  const domain =
    read(
      "src/domain/automationFlow.ts"
    );

  const payloadEditor =
    read(
      "src/components/automation/AutomationFlowPayloadEditor.tsx"
    );

  assert.match(
    domain,
    /triggerPayloadType/
  );

  assert.match(
    domain,
    /triggerPayloadValue/
  );

  assert.match(
    domain,
    /let payload =/
  );

  assert.match(
    domain,
    /JSON\.parse/
  );

  assert.match(
    payloadEditor,
    /value:\s*"json"/
  );

  assert.match(
    payloadEditor,
    /JSON value passed to every downstream node/
  );
});

test("loco function consumes payload.locoAddress and preserves payload", () => {
  const domain =
    read(
      "src/domain/automationFlow.ts"
    );

  const palette =
    read(
      "src/components/automation/AutomationFlowPalette.tsx"
    );

  const properties =
    read(
      "src/components/automation/AutomationFlowPropertiesPanel.tsx"
    );

  assert.match(
    domain,
    /case "locoFunction"/
  );

  assert.match(
    domain,
    /payload\.locoAddress/
  );

  assert.match(
    domain,
    /dcc\.setLocoFunction\(locoAddress/
  );

  assert.match(
    palette,
    /kind: "locoFunction"/
  );

  assert.match(
    properties,
    /Uses payload\.locoAddress/
  );
});

test("play audio node supports blocking and non-blocking playback", () => {
  const domain =
    read(
      "src/domain/automationFlow.ts"
    );

  const palette =
    read(
      "src/components/automation/AutomationFlowPalette.tsx"
    );

  const properties =
    read(
      "src/components/automation/AutomationFlowPropertiesPanel.tsx"
    );

  const node =
    read(
      "src/components/automation/AutomationFlowNode.tsx"
    );

  const runner =
    read(
      "src/services/clientScriptRunner.ts"
    );

  const worker =
    read(
      "src/services/clientScriptWorker.ts"
    );

  const protocol =
    read(
      "src/services/clientScriptWorkerProtocol.ts"
    );

  assert.match(
    domain,
    /\| "playAudio"/
  );

  assert.match(
    domain,
    /audioWaitForEnd\?: boolean/
  );

  assert.match(
    domain,
    /await playAudio\(\$\{jsString\(audioName\)\}\)/
  );

  assert.match(
    domain,
    /playAudio\(\$\{jsString\(audioName\)\}\)/
  );

  assert.match(
    palette,
    /audioWaitForEnd: false/
  );

  assert.match(
    properties,
    /flowWaitForAudioEnd/
  );

  assert.match(
    node,
    /audioWaitForEnd/
  );

  assert.match(
    runner,
    /return dcc\.playAudio\(value\)/
  );

  assert.match(
    runner,
    /handleScriptAudioPlayback/
  );

  assert.match(
    worker,
    /requestAudioPlayback/
  );

  assert.match(
    worker,
    /message\.type ===\s*"audioResult"/
  );

  assert.match(
    protocol,
    /type: "audio"/
  );

  assert.match(
    protocol,
    /type: "audioResult"/
  );

  const audioManager =
    read(
      "src/services/audioManager.ts"
    );

  assert.match(
    audioManager,
    /onStopped\?: \(\) => void/
  );

  assert.match(
    audioManager,
    /audioStopCallbacks/
  );

  const abortStart =
    runner.indexOf(
      "export function abortClientScript"
    );

  const abortPost =
    runner.indexOf(
      'type: "abort"',
      abortStart
    );

  const audioStop =
    runner.indexOf(
      "stopScriptAudioRequests(",
      abortStart
    );

  assert.ok(
    abortStart >= 0 &&
    abortPost > abortStart &&
    audioStop > abortPost
  );
});

test("log node writes the current payload to the runtime log", () => {
  const domain =
    read(
      "src/domain/automationFlow.ts"
    );

  assert.match(
    domain,
    /log\([^\n]*payload\)/
  );
});


test("trigger node play button injects that specific trigger once", () => {
  const node =
    read(
      "src/components/automation/AutomationFlowNode.tsx"
    );

  const dialog =
    read(
      "src/components/automation/AutomationFlowDialog.tsx"
    );

  const domain =
    read(
      "src/domain/automationFlow.ts"
    );

  const execution =
    read(
      "src/components/automation/useAutomationFlowExecution.ts"
    );

  assert.match(
    node,
    /IconPlayerPlay/
  );

  assert.match(
    node,
    /dispatchAutomationFlowInject/
  );

  assert.match(
    dialog,
    /AUTOMATION_FLOW_INJECT_EVENT/
  );

  assert.match(
    dialog,
    /triggerNodeId:\s*detail\.triggerNodeId/
  );

  assert.match(
    domain,
    /triggerNodeId\?: string/
  );

  assert.match(
    execution,
    /"inject"/
  );
});


test("turnout node uses the layout-backed turnout selector", () => {
  const properties =
    read(
      "src/components/automation/AutomationFlowPropertiesPanel.tsx"
    );

  const editor =
    read(
      "src/components/automation/AutomationFlowTurnoutEditor.tsx"
    );

  const catalog =
    read(
      "src/services/automationTurnoutCatalog.ts"
    );

  assert.match(
    properties,
    /AutomationFlowTurnoutEditor/
  );

  assert.match(
    editor,
    /loadAutomationTurnoutCatalog/
  );

  assert.match(
    editor,
    /searchable/
  );

  assert.match(
    catalog,
    /\/api\/layout/
  );

  assert.match(
    catalog,
    /label:[\s\S]*addressLabel/
  );
});

test("turnout catalog exposes semantic simple, double and three-way states", () => {
  const catalog =
    read(
      "src/services/automationTurnoutCatalog.ts"
    );

  for (
    const state of [
      '"closed"',
      '"thrown"',
      '"oo"',
      '"oc"',
      '"co"',
      '"cc"',
      '"left"',
      '"straight"',
      '"right"',
    ]
  ) {
    assert.match(
      catalog,
      new RegExp(state)
    );
  }

  assert.match(
    catalog,
    /ooMotor1Value/
  );

  assert.match(
    catalog,
    /ccMotor2Value/
  );

  assert.match(
    catalog,
    /leftMotor1Value/
  );

  assert.match(
    catalog,
    /rightMotor2Value/
  );

  assert.match(
    catalog,
    /semanticClosed/
  );
});

test("turnout flow generation uses stored semantic commands and rejects an unconfigured new node", () => {
  const domain =
    read(
      "src/domain/automationFlow.ts"
    );

  const palette =
    read(
      "src/components/automation/AutomationFlowPalette.tsx"
    );

  assert.match(
    domain,
    /turnoutCommands/
  );

  assert.match(
    domain,
    /configured\.map/
  );

  assert.match(
    domain,
    /Set Turnout node has no configured turnout/
  );

  assert.match(
    palette,
    /turnoutAddress: 0/
  );
});


test("locomotive and block nodes are grouped separately", () => {
  const palette =
    read(
      "src/components/automation/AutomationFlowPalette.tsx"
    );

  assert.match(
    palette,
    /id: "locoBlocks"/
  );

  for (
    const kind of [
      "setLoco",
      "getBlock",
      "setBlock",
      "clearBlock",
      "getBlockTargetLoco",
      "setBlockTargetLoco",
      "clearBlockTargetLoco",
    ]
  ) {
    assert.match(
      palette,
      new RegExp(
        `kind: "${kind}"`
      )
    );
  }
});

test("block flow nodes use the layout block catalog", () => {
  const editor =
    read(
      "src/components/automation/AutomationFlowBlockEditor.tsx"
    );

  const catalog =
    read(
      "src/services/automationBlockCatalog.ts"
    );

  assert.match(
    editor,
    /loadAutomationBlockCatalog/
  );

  assert.match(
    editor,
    /searchable/
  );

  assert.match(
    catalog,
    /"trackblock"/
  );

  assert.match(
    catalog,
    /\/api\/layout/
  );
});

test("get block nodes write payload locoAddress and setters consume it", () => {
  const domain =
    read(
      "src/domain/automationFlow.ts"
    );

  assert.match(
    domain,
    /case "getBlock":[\s\S]*payload\.locoAddress = dcc\.getBlock/
  );

  assert.match(
    domain,
    /case "getBlockTargetLoco":[\s\S]*payload\.locoAddress = dcc\.getBlockTargetLoco/
  );

  assert.match(
    domain,
    /case "setBlock":[\s\S]*dcc\.setBlock/
  );

  assert.match(
    domain,
    /case "setBlockTargetLoco":[\s\S]*dcc\.setBlockTargetLoco/
  );

  assert.match(
    domain,
    /payloadLocoAddressGuard/
  );
});

test("set loco uses payload locoAddress with configured speed and direction", () => {
  const domain =
    read(
      "src/domain/automationFlow.ts"
    );

  const properties =
    read(
      "src/components/automation/AutomationFlowPropertiesPanel.tsx"
    );

  assert.match(
    domain,
    /case "setLoco"/
  );

  assert.match(
    domain,
    /dcc\.setLoco\(locoAddress/
  );

  assert.match(
    properties,
    /flowSetLocoPayloadHint/
  );

  assert.match(
    properties,
    /locoDirection/
  );
});


test("automation runtime is split into Scripts and Flows tabs", () => {
  const panel =
    read(
      "src/components/AutomationPanel.tsx"
    );

  assert.match(
    panel,
    /value="scripts"/
  );

  assert.match(
    panel,
    /value="flows"/
  );

  assert.match(
    panel,
    /AutomationScriptsTable/
  );

  assert.match(
    panel,
    /AutomationFlowsTable/
  );
});

test("automation scripts are rendered in a runtime table instead of cards", () => {
  const scripts =
    read(
      "src/components/automation/AutomationScriptsTable.tsx"
    );

  assert.match(
    scripts,
    /<Table/
  );

  assert.match(
    scripts,
    /pauseClientScript/
  );

  assert.match(
    scripts,
    /abortClientScript/
  );

  assert.match(
    scripts,
    /setAutomationFinishing/
  );

  assert.match(
    scripts,
    /wsApi\.emergencyStop/
  );
});

test("saved flows have start stop abort and edit runtime actions", () => {
  const flows =
    read(
      "src/components/automation/AutomationFlowsTable.tsx"
    );

  assert.match(
    flows,
    /visual-flow-run:/
  );

  assert.match(
    flows,
    /runClientScript/
  );

  assert.match(
    flows,
    /pauseClientScript/
  );

  assert.match(
    flows,
    /abortClientScript/
  );

  assert.match(
    flows,
    /onOpenEditor/
  );

  assert.match(
    flows,
    /generateAutomationFlowPageScript/
  );
});

test("layout page keeps saved flows synchronized with the flow editor", () => {
  const page =
    read(
      "src/LiteLayoutPage.tsx"
    );

  assert.match(
    page,
    /const \[automationFlow, setAutomationFlow\]/
  );

  assert.match(
    page,
    /flows=\{automationFlow\}/
  );

  assert.match(
    page,
    /initialPageId=\{automationFlowPageId\}/
  );

  assert.match(
    page,
    /onSaved=\{setAutomationFlow\}/
  );
});


test("flow editor side panels are resizable and persisted", () => {
  const dialog =
    read(
      "src/components/automation/AutomationFlowDialog.tsx"
    );

  const sizing =
    read(
      "src/components/automation/useAutomationFlowPanelSizes.ts"
    );

  const css =
    read(
      "src/styles/automationFlow.css"
    );

  assert.match(
    dialog,
    /automation-flow-splitter-left/
  );

  assert.match(
    dialog,
    /automation-flow-splitter-right/
  );

  assert.match(
    dialog,
    /panelSizes\.beginResize/
  );

  assert.match(
    sizing,
    /dcc-express-flow\.left-panel-width/
  );

  assert.match(
    sizing,
    /dcc-express-flow\.right-panel-width/
  );

  assert.match(
    sizing,
    /localStorage\.setItem/
  );

  assert.match(
    sizing,
    /resetWidth/
  );

  assert.match(
    css,
    /--automation-flow-left-width/
  );

  assert.match(
    css,
    /--automation-flow-right-width/
  );

  assert.match(
    css,
    /automation-flow-panel-resizing/
  );
});


test("flow edges are selectable deletable and use vertical handles", () => {
  const dialog =
    read(
      "src/components/automation/AutomationFlowDialog.tsx"
    );

  const node =
    read(
      "src/components/automation/AutomationFlowNode.tsx"
    );

  const css =
    read(
      "src/styles/automationFlow.css"
    );

  assert.match(
    dialog,
    /selectedEdgeId/
  );

  assert.match(
    dialog,
    /onEdgeClick/
  );

  assert.match(
    dialog,
    /onEdgeDoubleClick/
  );

  assert.match(
    dialog,
    /event\.key !==\s*"Delete"/
  );

  assert.match(
    dialog,
    /interactionWidth:\s*24/
  );

  assert.match(
    node,
    /Position\.Top/
  );

  assert.match(
    node,
    /Position\.Bottom/
  );

  assert.match(
    css,
    /react-flow__edge\.selected/
  );
});

test("new flow nodes are placed top to bottom by default", () => {
  const dialog =
    read(
      "src/components/automation/AutomationFlowDialog.tsx"
    );

  assert.match(
    dialog,
    /x:\s*120/
  );

  assert.match(
    dialog,
    /index \*\s*120/
  );
});


test("saved flows use reorderable enable-only runtime cards", () => {
  const flows =
    read(
      "src/components/automation/AutomationFlowsTable.tsx"
    );

  assert.match(
    flows,
    /draggable/
  );

  assert.match(
    flows,
    /IconGripVertical/
  );

  assert.match(
    flows,
    /IconArrowUp/
  );

  assert.match(
    flows,
    /IconArrowDown/
  );

  assert.match(
    flows,
    /moveDraggedPageToIndex/
  );

  assert.match(
    flows,
    /saveAutomationFlow/
  );

  assert.match(
    flows,
    /checked=\{[\s\S]*runtimeEnabled/
  );

  assert.match(
    flows,
    /checked=\{[\s\S]*page\.enabled/
  );

  assert.match(
    flows,
    /flowTriggerManualEditorOnly/
  );

  assert.match(
    flows,
    /flowSensorTriggerLabel/
  );

  assert.match(
    flows,
    /<IconEdit/
  );

  assert.doesNotMatch(
    flows,
    /IconPlayerPlay/
  );

  assert.doesNotMatch(
    flows,
    /IconPlayerPause/
  );

  assert.doesNotMatch(
    flows,
    /IconPlayerStop/
  );

  assert.doesNotMatch(
    flows,
    /<Table/
  );
});

test("automation script deletion requires confirmation", () => {
  const scripts =
    read(
      "src/components/automation/AutomationScriptsTable.tsx"
    );

  assert.match(
    scripts,
    /deleteConfirmOpened/
  );

  assert.match(
    scripts,
    /deleteScriptConfirmTitle/
  );

  assert.match(
    scripts,
    /deleteScriptConfirmMessage/
  );

  const deleteButton =
    scripts.indexOf(
      'color="red"'
    );

  assert.ok(
    deleteButton >= 0
  );

  assert.match(
    scripts,
    /setDeleteConfirmOpened\(\s*true\s*\)/
  );
});


test("automation scripts use reorderable cards with grouped runtime controls", () => {
  const scripts =
    read(
      "src/components/automation/AutomationScriptsTable.tsx"
    );

  const cardStart =
    scripts.indexOf(
      "<Card\n        withBorder"
    );

  const name =
    scripts.indexOf(
      "<TextInput",
      cardStart
    );

  const status =
    scripts.indexOf(
      "state.status.toUpperCase()",
      cardStart
    );

  const allControl =
    scripts.indexOf(
      "startWithAllDescription",
      cardStart
    );

  const infoBadge =
    scripts.indexOf(
      'info\n                  ? "blue"',
      cardStart
    );

  assert.ok(
    cardStart >= 0 &&
    name > cardStart &&
    status > name &&
    allControl > status &&
    infoBadge > allControl
  );

  assert.match(
    scripts,
    /draggable/
  );

  assert.match(
    scripts,
    /IconGripVertical/
  );

  assert.match(
    scripts,
    /IconArrowUp/
  );

  assert.match(
    scripts,
    /IconArrowDown/
  );

  assert.match(
    scripts,
    /moveDraggedScriptToIndex/
  );

  assert.match(
    scripts,
    /persistScriptOrder/
  );

  assert.match(
    scripts,
    /saveAutomationScripts/
  );

  assert.match(
    scripts,
    /<Divider\s+orientation="vertical"/
  );

  assert.doesNotMatch(
    scripts,
    /<Table/
  );

  assert.doesNotMatch(
    scripts,
    /definition\.script\.split\("\\n"\)\.length/
  );
});
