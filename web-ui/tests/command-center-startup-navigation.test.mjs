import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("../src/App.tsx", import.meta.url), "utf8"
);

function resolveHash(hash) {
  const match = source.match(/function pageFromHash\(\): Page \{[\s\S]*?\n\}/);
  assert.ok(match, "pageFromHash() missing");
  const executable = match[0].replace("(): Page", "()");
  return vm.runInNewContext(
    `${executable}\npageFromHash()`,
    { window: { location: { hash } } }
  );
}

test("empty URL after first OK is Home (not command-center)", () => {
  assert.equal(resolveHash(""), "home");
  assert.equal(resolveHash("#"), "home");
  assert.equal(resolveHash("#unknown"), "home");
  assert.equal(resolveHash("#home"), "home");
  assert.equal(resolveHash("#command-center"), "command-center");
  assert.equal(resolveHash("#external-devices"), "external-devices");
});

test("initial browser page stays configuration until explicit OK", () => {
  assert.match(source, /const \[sessionStarted, setSessionStarted\] = useState<boolean \| null>\(null\)/);
  assert.match(source, /if \(!sessionStarted\)\s*return <CommandCenterStartupPage onStarted=\{startSession\} \/>/);
  assert.match(source, /const startSession = \(\) => \{\s*setSessionStarted\(true\);\s*navigateAfterStart\(\);/);
  assert.match(source, /const navigateAfterStart = \(\) => \{\s*window\.location\.hash = "";\s*setPage\("home"\)/);
});

test("hashchange cannot undo the first successful OK with stale state", () => {
  assert.match(source, /const onHashChange = \(\) => setPage\(pageFromHash\(\)\)/);
  assert.doesNotMatch(source, /setPage\(current => sessionStarted === false/);
});

test("direct hash to config never skips physical stop protocol", () => {
  assert.doesNotMatch(source, /!sessionStarted \|\| page === "command-center"/);
  assert.match(source, /fetch\("\/api\/command-center\/startup\/stop", \{ method: "POST" \}\)/);
  assert.match(source, /if \(!response\.ok \|\| !data\.ok\) throw new Error/);
  assert.match(source, /setSessionStarted\(false\);\s*window\.location\.hash = "command-center";/);
});
