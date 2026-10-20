import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const app = fs.readFileSync(path.join(repo, "web-ui/src/App.tsx"), "utf8");
const fw = fs.readFileSync(path.join(repo, "src/FileManagementEndpoint.cpp"), "utf8");

test("file names open entries and separate open icon is gone", () => {
  assert.doesNotMatch(app, /IconExternalLink/);
  assert.match(app, /const openEntry =/);
  assert.match(app, /onClick=\{\(\) => openEntry\(file\)\}/);
});

test("file manager uses firmware deleteAllowed policy", () => {
  assert.match(app, /deleteAllowed\?: boolean/);
  assert.match(app, /file\.deleteAllowed === false/);
  assert.match(app, /deleteCandidate/);
});

test("config files are deletable while assets and runtime files stay protected", () => {
  const start = fw.indexOf("bool FileManagementEndpoint::protectedPath");
  const end = fw.indexOf("String FileManagementEndpoint::joinPath", start);
  const protectedBody = fw.slice(start, end);

  assert.match(protectedBody, /realPath == "\/assets"/);
  assert.match(protectedBody, /realPath\.startsWith\("\/assets\/"\)/);
  assert.match(protectedBody, /realPath == "\/index\.html"/);
  assert.match(protectedBody, /realPath == "\/index\.html\.gz"/);
  assert.match(protectedBody, /realPath\.startsWith\("\/state\/"\)/);
  assert.match(protectedBody, /realPath == "\/config"/);

  assert.doesNotMatch(protectedBody, /\/config\/device-config\.json/);
  assert.doesNotMatch(protectedBody, /\/config\/automations\.json/);
  assert.doesNotMatch(protectedBody, /\/config\/signal-logic\.ndjson/);
  assert.match(fw, /entry\["deleteAllowed"\]/);
});
