import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webUiRoot = path.resolve(here, "..");

const source = fs.readFileSync(
  path.join(webUiRoot, "src/components/AutomationPanel.tsx"),
  "utf8"
);

test("automation editor Save persists the exact updated script list", () => {
  assert.match(
    source,
    /import\s*\{[\s\S]*saveAutomationScripts[\s\S]*\}\s*from "\.\.\/services\/automationApi"/
  );

  assert.match(
    source,
    /const saveScript = async \([\s\S]*nextScriptsWithUpdate[\s\S]*await saveAutomationScripts\([\s\S]*nextScripts[\s\S]*\)/
  );

  assert.match(
    source,
    /onSave=\{[\s\S]*saveScript\([\s\S]*definition\.id/
  );
});

test("old misleading save-project-only message is not used by automation editor Save", () => {
  assert.doesNotMatch(
    source,
    /editorRemainsOpenSaveTheProjectToPersistItIn/
  );
});
