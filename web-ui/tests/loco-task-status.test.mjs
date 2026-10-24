import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLocoTaskStatus, resolveLocoTaskStatus } from "../src/services/locoTaskStatus.ts";

const sequence = (status, info) => ({
  sequenceId: "s1", name: "Szabadbattyán–C1", status,
  locoAddress: 18, stepIndex: 4, stepCount: 10, info, error: null,
});
const movement = (info, startedAt = 1) => ({
  pageId: "sequence-step-s1-3",
  state: {
    status: "running", startedAt, stoppedAt: null, locoAddress: 18,
    currentBlockName: "C1", currentBlockId: 21,
    targetBlockName: "S3.2", targetBlockId: 24,
    desiredSpeed: 35, currentResourceKey: null,
    activeRouteResourceKey: null, info, error: null,
  },
});

test("sequential dwell remains active when child Movement is already idle", () => {
  const status = resolveLocoTaskStatus(18, [], [
    sequence("waiting", "Stopped at block #21 · waiting 10 s"),
  ], [], id => id === 21 ? "C1" : `#${id}`);
  assert.ok(status);
  assert.equal(formatLocoTaskStatus(status), "Stopped at C1 · waiting 10 s");
  assert.equal(status.progress, null);
});

test("live child sensor wait outranks generic Running route counter", () => {
  const status = resolveLocoTaskStatus(18,
    [movement("Waiting for S3.2")],
    [sequence("running", "Running route 4/10")], []);
  assert.ok(status);
  assert.equal(status.message, "Waiting for S3.2");
  assert.equal(status.progress, "route 4/10");
  assert.equal(formatLocoTaskStatus(status), "Waiting for S3.2 (route 4/10)");
});

test("dwell status outranks the completed child's obsolete information", () => {
  const status = resolveLocoTaskStatus(18,
    [movement("Movement completed")],
    [sequence("waiting", "Stopped at block #21 · waiting 10 s")], []);
  assert.equal(status?.message, "Stopped at block #21 · waiting 10 s");
});

test("completed sequences and terminated movements release Manual display", () => {
  assert.equal(resolveLocoTaskStatus(18, [], [sequence("completed", "Sequence completed")], []), null);
  assert.equal(resolveLocoTaskStatus(12, [movement("Waiting for S3.2")], [sequence("running", "Running route 4/10")], []), null);
});

test("ordinary Movement info remains the primary status without a sequence", () => {
  const status = resolveLocoTaskStatus(18, [movement("Waiting for B2")], [], []);
  assert.equal(status?.message, "Waiting for B2");
  assert.equal(status?.progress, null);
});

test("Train Driver pause stays visible outside sequential tasks", () => {
  const driver = {
    taskId: "driver1", movementId: "m1", locoAddress: 18,
    name: "Test", status: "paused",
    info: "Paused by train driver; speed zero requested", error: null, createdAt: 123,
  };
  const status = resolveLocoTaskStatus(18, [], [], [driver]);
  assert.equal(status?.message, driver.info);
});
