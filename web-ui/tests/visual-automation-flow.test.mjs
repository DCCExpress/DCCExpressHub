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

test("trigger supports manual test and interval run generation", () => {
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
