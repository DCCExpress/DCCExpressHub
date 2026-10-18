import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const protocol = fs.readFileSync(new URL("../src/protocol.ts", import.meta.url), "utf8");
const config = fs.readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
test("JMRI uses one Vite proxy for HTTP and WebSocket", () => {
  assert.match(config, /ws: true/);
  assert.match(config, /JMRI_TARGET/);
  assert.match(protocol, /BASE = "\/jmri"/);
  assert.match(protocol, /encodeURIComponent\(name\)/);
});
test("debugger marks mutations as requiring confirmation", () => {
  assert.match(protocol, /needsWriteConfirmation/);
  assert.match(protocol, /v\.method === "get"/);
  assert.match(protocol, /v\.method === "list"/);
});
