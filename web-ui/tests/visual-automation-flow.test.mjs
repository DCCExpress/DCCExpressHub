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
    editor,
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
