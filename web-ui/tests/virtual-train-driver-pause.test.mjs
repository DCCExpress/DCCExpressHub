import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

test("Train Driver Stop pauses rather than cancelling the Movement", () => {
  const driver = read("desktop/DCCExpressHub.Net/Web/TrainDriverRuntime.cs");
  assert.match(driver, /public bool Stop\(string taskId\)/);
  assert.match(driver, /_movement\.Hold\(current\.MovementId, PauseOwnerPrefix \+ taskId\)/);
  assert.match(driver, /Status = "paused"/);
  const movement = read("desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");
  assert.match(movement, /execution\.Moving && !IsHeld\(execution\)/);
  assert.doesNotMatch(driver, /public bool Stop\(string taskId\) => Control/);
});

test("Resume releases only the driver's hold; Movement validates dispatcher authority", () => {
  const driver = read("desktop/DCCExpressHub.Net/Web/TrainDriverRuntime.cs");
  const movement = read("desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");
  const hub = read("desktop/DCCExpressHub.Net/Web/WsHub.cs");
  assert.match(driver, /_movement\.Release\(current\.MovementId, PauseOwnerPrefix \+ taskId\)/);
  assert.match(movement, /_dispatcher\.ValidateHeldLeg/);
  assert.match(hub, /case "resume":\s*ok = TrainDriver\.Resume/);
});

test("LocoPanel controls switch without altering their fixed-height row", () => {
  const card = read("web-ui/src/layout/loco-panel/LocoControlCard.tsx");
  assert.match(card, /driver\.status === "paused"/);
  assert.match(card, /driverAction\("resume"\)/);
  assert.match(card, /driverAction\("stop"\)/);
  assert.match(card, /driverAction\("abort"\)/);
  assert.match(card, /style=\{\{ height: 42 \}\}/);
  assert.match(card, /\!\!movement \|\| \!driveSelection\.available/);
});

test("Canvas Drive to Block uses TrainDriver start rather than an unmanaged Movement", () => {
  const canvas = read("web-ui/src/components/TrackCanvas.tsx");
  assert.match(canvas, /wsApi\.request\("trainDriverCommand"/);
  assert.match(canvas, /action: "startAuto", taskId, candidates: pages/);
  assert.doesNotMatch(canvas, /startTransientMovement\(page\)/);
});

test("Drive to Block uses the locomotive's configured starting speed", () => {
  const canvas = read("web-ui/src/components/TrackCanvas.tsx");
  const tab = read("web-ui/src/components/loco-dialog/LocoGeneralTab.tsx");
  const helpers = read("web-ui/src/components/loco-dialog/locoDialogHelpers.ts");
  assert.match(canvas, /state\.loco\.cruisingSpeed \?\? 20/);
  assert.doesNotMatch(canvas, /localStorage\.getItem\("dccexpresshub\.loco-target-block\.speed"\)/);
  assert.match(tab, /loco\.cruisingSpeed \?\? 20/);
  assert.match(helpers, /cruisingSpeed: 20/);
});

test("AUTO Drive to Block sends alternatives and rejects blocked route candidates", () => {
  const canvas = read("web-ui/src/components/TrackCanvas.tsx");
  const driver = read("desktop/DCCExpressHub.Net/Web/TrainDriverRuntime.cs");
  const movement = read("desktop/DCCExpressHub.Net/Web/MovementRuntime.cs");
  const ws = read("desktop/DCCExpressHub.Net/Web/WsHub.cs");
  assert.match(canvas, /state\.routes\.filter\(route => route\.toBlockId === hit\.id\)/);
  assert.match(canvas, /candidates\.map\(route =>/);
  assert.match(driver, /EvaluateAutoRoute\(page\)/);
  assert.match(driver, /OrderBy\(item => item\.Check\.Cost\)/);
  assert.match(movement, /route_sensor_unknown/);
  assert.match(movement, /route_block_occupied_or_reserved/);
  assert.match(movement, /route_safety_sensor_not_free/);
  assert.match(movement, /route_resource_reserved/);
  assert.match(ws, /case "startAuto":/);
});
