import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// This file lives in: <repo>/web-ui/tests/
const webUiRoot = path.resolve(here, "..");
const repoRoot = path.resolve(webUiRoot, "..");

function readWebUi(rel) {
  return fs.readFileSync(path.join(webUiRoot, rel), "utf8");
}

function readRepo(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

test("mock ESTOP toggles pause/resume and does not fake track power off", () => {
  const source = readWebUi("mock-server.mjs");

  assert.match(
    source,
    /case\s+"emergencyStop":\s*\n\s*state\.emergencyStop\s*=\s*!state\.emergencyStop;/,
    "mock emergencyStop must toggle the latched state"
  );

  const block = source.match(
    /case\s+"emergencyStop":[\s\S]*?case\s+"writeDccExDirectCommand"/
  )?.[0] ?? "";

  assert.ok(block, "emergencyStop switch block must exist");
  assert.doesNotMatch(
    block,
    /state\.power\s*=\s*false/,
    "DCC-EX PAUSE is not the same thing as track power off"
  );
});

test("root upload stays disabled in the UI", () => {
  const source = readWebUi("src/App.tsx");

  assert.match(
    source,
    /disabled=\{busy\s*\|\|\s*currentPath\s*===\s*["']\/["']\}/,
    "upload button must be disabled at virtual root"
  );
});

test("firmware backend rejects upload to virtual root", () => {
  const source = readRepo("src/FileManagementEndpoint.cpp");

  assert.match(source, /directory\s*==\s*"\/"/);
  assert.match(
    source,
    /Choose Internal Flash or SD Card before uploading/,
    "backend must reject ambiguous root uploads"
  );
});

test("common/AppModal.tsx is the only canonical AppModal", () => {
  const canonical = path.join(
    webUiRoot,
    "src/components/common/AppModal.tsx"
  );

  const legacy = path.join(
    webUiRoot,
    "src/components/AppModal.tsx"
  );

  assert.equal(
    fs.existsSync(canonical),
    true,
    "canonical common/AppModal.tsx must exist"
  );

  assert.equal(
    fs.existsSync(legacy),
    false,
    "legacy components/AppModal.tsx must be deleted"
  );

  const sourceRoot = path.join(webUiRoot, "src");
  const offenders = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (!/\.(ts|tsx)$/.test(entry.name)) {
        continue;
      }

      const content = fs.readFileSync(full, "utf8");

      const legacyImport =
        /from\s+["']\.\/AppModal["']/.test(content) ||
        /from\s+["']\.\.\/AppModal["']/.test(content) ||
        /from\s+["']@\/components\/AppModal["']/.test(content);

      if (legacyImport) {
        offenders.push(path.relative(sourceRoot, full));
      }
    }
  }

  walk(sourceRoot);

  assert.deepEqual(
    offenders,
    [],
    `stale legacy AppModal imports: ${offenders.join(", ")}`
  );
});

test("backup and generated audit artifacts are removed", () => {
  const forbidden = [
    "src/components/CommandCenterSettingsDialog.tsx.before-dialog-export-fix",
    "src/domain/clientWsCommands.ts.v6.bak",
    "src/services/wsApi.ts.v6.bak",
    "tools/i18n-audit.json",
    "tools/i18n-strings.txt",
  ];

  for (const rel of forbidden) {
    assert.equal(
      fs.existsSync(path.join(webUiRoot, rel)),
      false,
      `${rel} should be removed`
    );
  }

  const ignore = readRepo(".gitignore");

  assert.match(ignore, /\*\.bak/);
  assert.match(ignore, /\*\.before-\*/);
  assert.match(ignore, /web-ui\/tools\/i18n-audit\.json/);
  assert.match(ignore, /web-ui\/tools\/i18n-strings\.txt/);
});
