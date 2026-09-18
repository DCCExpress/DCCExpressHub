import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

const configuredHeader = fs.readFileSync(
  path.join(root, "src/ConfiguredCommandCenter.h"),
  "utf8"
);
const configuredSource = fs.readFileSync(
  path.join(root, "src/ConfiguredCommandCenter.cpp"),
  "utf8"
);
const appHeader = fs.readFileSync(
  path.join(root, "src/App.h"),
  "utf8"
);
const appSource = fs.readFileSync(
  path.join(root, "src/App.cpp"),
  "utf8"
);
const apiSource = fs.readFileSync(
  path.join(root, "src/ApiServer.cpp"),
  "utf8"
);

test("logical loco commands pass through ConfiguredCommandCenter", () => {
  assert.match(
    configuredHeader,
    /class ConfiguredCommandCenter final[\s\S]*public ICommandCenter/
  );

  assert.match(
    configuredSource,
    /bool ConfiguredCommandCenter::setLoco[\s\S]*mapDirection\([\s\S]*_inner\.setLoco/
  );
});

test("physical loco feedback is mapped back to logical direction", () => {
  assert.match(
    configuredSource,
    /void ConfiguredCommandCenter::onLocoFeedback[\s\S]*logicalFeedback\.forward[\s\S]*mapDirection/
  );
});

test("App exposes the configured wrapper to Hub subsystems", () => {
  assert.match(
    appHeader,
    /CompiledCommandCenter _physicalCommandCenter/
  );
  assert.match(
    appHeader,
    /ConfiguredCommandCenter _commandCenter/
  );
  assert.match(
    appHeader,
    /WsProtocol _wsProtocol\{[\s\S]*_commandCenter/
  );
});

test("locomotive save reloads firmware direction configuration immediately", () => {
  assert.match(
    appSource,
    /reloadLocomotiveConfiguration/
  );
  assert.match(
    apiSource,
    /_onLocomotivesSaved[\s\S]*Locomotive configuration committed but runtime reload failed/
  );
});

test("raw command path stays raw", () => {
  assert.match(
    configuredSource,
    /Raw commands intentionally bypass logical locomotive configuration/
  );
  assert.match(
    configuredSource,
    /_inner\.sendRawCommand/
  );
});
