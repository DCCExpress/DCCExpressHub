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

const root =
  path.resolve(
    here,
    "..",
    ".."
  );

function read(relativePath) {
  return fs.readFileSync(
    path.join(
      root,
      relativePath
    ),
    "utf8"
  );
}

function exists(relativePath) {
  return fs.existsSync(
    path.join(
      root,
      relativePath
    )
  );
}

test("browser automation worker implementation is removed", () => {
  for (
    const relativePath of [
      "web-ui/src/services/clientScriptWorker.ts",
      "web-ui/src/services/clientScriptWorkerProtocol.ts",
      "web-ui/src/services/clientScriptSwitchManPrelude.ts",
      "web-ui/src/services/clientScriptSmartDispatcherPrelude.ts",
      "web-ui/src/services/clientScriptLayoutAccessoryRuntime.ts",
    ]
  ) {
    assert.equal(
      exists(
        relativePath
      ),
      false,
      relativePath
    );
  }

  const runner =
    read(
      "web-ui/src/services/clientScriptRunner.ts"
    );

  assert.doesNotMatch(
    runner,
    /new\s+Worker\s*\(/
  );

  assert.doesNotMatch(
    runner,
    /navigator\.locks/
  );

  assert.doesNotMatch(
    runner,
    /postMessage\s*\(/
  );

  assert.match(
    runner,
    /scriptRequest\s*\(/
  );

  assert.match(
    runner,
    /"automationScriptStateChanged"/
  );

  assert.match(
    runner,
    /"automationScriptLog"/
  );
});

test("browser Flow runtime is a backend log and command proxy only", () => {
  const runtime =
    read(
      "web-ui/src/components/automation/useAutomationFlowRuntime.ts"
    );

  assert.match(
    runtime,
    /"flowLog"/
  );

  assert.match(
    runtime,
    /flowCommand\s*\(/
  );

  for (
    const forbidden of [
      /"sensorChanged"/,
      /"turnoutChanged"/,
      /"accessoryChanged"/,
      /"signalAspectChanged"/,
      /"blockStateChanged"/,
      /"locoState"/,
      /setInterval\s*\(/,
      /runClientScript\s*\(/,
      /generateAutomationFlowPageScript\s*\(/,
    ]
  ) {
    assert.doesNotMatch(
      runtime,
      forbidden
    );
  }
});

test("Windows backend owns Script and Flow runtimes", () => {
  const program =
    read(
      "desktop/DCCExpressHub.Net/Program.cs"
    );

  assert.match(
    program,
    /AddSingleton<ScriptRuntime>/
  );

  assert.match(
    program,
    /AddSingleton<FlowRuntime>/
  );

  assert.match(
    program,
    /AddHostedService\(sp\s*=>\s*sp\.GetRequiredService<FlowRuntime>\(\)\)/
  );

  const project =
    read(
      "desktop/DCCExpressHub.Net/DCCExpressHub.Net.csproj"
    );

  assert.match(
    project,
    /PackageReference Include="Jint" Version="4\.16\.4"/
  );
});

test("backend ScriptRuntime uses async Jint and backend route authority", () => {
  const runtime =
    read(
      "desktop/DCCExpressHub.Net/Web/ScriptRuntime.cs"
    );

  assert.match(
    runtime,
    /ExperimentalFeature\.TaskInterop/
  );

  assert.match(
    runtime,
    /options\.CancellationToken\s*\(/
  );

  assert.match(
    runtime,
    /ICommandCenter/
  );

  assert.match(
    runtime,
    /DispatcherRuntime/
  );

  assert.match(
    runtime,
    /BuildForBlockNames\s*\(/
  );

  assert.match(
    runtime,
    /AcquireRouteAsync\s*\(/
  );

  assert.match(
    runtime,
    /AcquireLegAsync\s*\(/
  );

  assert.match(
    runtime,
    /PauseAllSaved\s*\(/
  );

  assert.match(
    runtime,
    /AbortAllSaved\s*\(/
  );
});

test("backend FlowRuntime owns event matching intervals and execution", () => {
  const runtime =
    read(
      "desktop/DCCExpressHub.Net/Web/FlowRuntime.cs"
    );

  assert.match(
    runtime,
    /_layout\.Changed\s*\+=/
  );

  assert.match(
    runtime,
    /_commandCenter\.LocoFeedbackChanged\s*\+=/
  );

  assert.match(
    runtime,
    /new\s+PeriodicTimer\s*\(/
  );

  assert.match(
    runtime,
    /_scripts\.StartSource\s*\(/
  );

  assert.match(
    runtime,
    /_scripts\.Finishing/
  );

  const mapping =
    runtime.indexOf(
      "_executionPages["
    );

  const start =
    runtime.indexOf(
      "_scripts.StartSource("
    );

  assert.ok(
    mapping >= 0 &&
    start > mapping,
    "Flow execution ownership must be registered before ScriptRuntime starts"
  );
});

test("Timetable starts scripts directly in backend ScriptRuntime", () => {
  const runtime =
    read(
      "desktop/DCCExpressHub.Net/Web/TimetableRuntime.cs"
    );

  assert.match(
    runtime,
    /readonly ScriptRuntime _scripts/
  );

  assert.match(
    runtime,
    /_scripts\.StartSaved\s*\(/
  );

  assert.doesNotMatch(
    runtime,
    /ScriptRequested/
  );

  const proxy =
    read(
      "web-ui/src/services/timetableScheduler.ts"
    );

  assert.match(
    proxy,
    /timetableCommand\s*\(/
  );

  assert.doesNotMatch(
    proxy,
    /runClientScript/
  );

  assert.doesNotMatch(
    proxy,
    /startMovement/
  );
});

test("command center disconnect safely stops active backend execution", () => {
  const hub =
    read(
      "desktop/DCCExpressHub.Net/Web/WsHub.cs"
    );

  assert.match(
    hub,
    /cc\.ConnectionChanged\s*\+=/
  );

  assert.match(
    hub,
    /if \(!connected\)[\s\S]*Movement\.StopAll\(false\)/
  );

  assert.match(
    hub,
    /if \(!connected\)[\s\S]*Scripts\.AbortAll/
  );

  assert.match(
    hub,
    /if \(!connected\)[\s\S]*Timetable\.StopScheduler\(\)/
  );
});
test("old Timetable browser-script bridge is absent", () => {
  const hub =
    read(
      "desktop/DCCExpressHub.Net/Web/WsHub.cs"
    );

  const commands =
    read(
      "web-ui/src/domain/clientWsCommands.ts"
    );

  const types =
    read(
      "web-ui/src/domain/wsTypes.ts"
    );

  for (
    const oldName of [
      "timetableScriptRequested",
      "timetableScriptStatus",
      "timetableScriptComplete",
    ]
  ) {
    assert.equal(
      hub.includes(
        oldName
      ),
      false,
      oldName
    );

    assert.equal(
      commands.includes(
        oldName
      ),
      false,
      oldName
    );

    assert.equal(
      types.includes(
        oldName
      ),
      false,
      oldName
    );
  }
});

test("backend SmartDispatcher keeps safe arrival and authority semantics", () => {
  const runtime =
    read(
      "desktop/DCCExpressHub.Net/Web/ScriptRuntime.cs"
    );

  const dispatcher =
    read(
      "desktop/DCCExpressHub.Net/Web/DispatcherRuntime.cs"
    );

  assert.match(
    runtime,
    /ParseSmartBlockSpecs\s*\(/
  );

  assert.match(
    runtime,
    /smart_dispatcher_shared_occupancy_sensor/
  );

  assert.match(
    runtime,
    /SmartArrivalConditions\s*\(/
  );

  assert.match(
    runtime,
    /leg\.To\.SensorAddress\.Value/
  );

  assert.match(
    runtime,
    /leg\.From\.SensorAddress\.Value/
  );

  assert.match(
    runtime,
    /ValidateHeldLegAuthority\s*\(/
  );

  assert.match(
    dispatcher,
    /public DispatcherAcquireResult ValidateHeldLegAuthority/
  );

  for (
    const api of [
      "stop:",
      "waitForBlock:",
      "waitForClearance:",
      "getCurrentBlock:",
      "getNextBlock:",
      "getRoute:",
      "getDesiredSpeed:",
      "__smartWaitBlocked",
    ]
  ) {
    assert.equal(
      runtime.includes(
        api
      ),
      true,
      api
    );
  }
});

test("backend audio cannot deadlock when the authoritative audio subscriber disappears", () => {
  const hub =
    read(
      "desktop/DCCExpressHub.Net/Web/WsHub.cs"
    );

  assert.match(
    hub,
    /HandleMovementAudioRequest\s*\(/
  );

  assert.match(
    hub,
    /HandleScriptAudioRequest\s*\(/
  );

  assert.match(
    hub,
    /StartAudioWait\s*\(/
  );

  assert.match(
    hub,
    /_audioSubscriberConnectionId/
  );

  assert.match(
    hub,
    /RemovePendingAudioForClientLocked\s*\(/
  );

  assert.match(
    hub,
    /CompleteFailedAudioWaits\s*\(/
  );

  assert.match(
    hub,
    /if \(Clients\.IsEmpty\)/
  );

  assert.match(
    hub,
    /Movement\.FailPendingAudio\(\)/
  );

  assert.match(
    hub,
    /Scripts\.FailPendingAudio\(\)/
  );
});
test("Automation Script and Flow WebSocket namespaces are explicit", () => {
  const hub =
    read(
      "desktop/DCCExpressHub.Net/Web/WsHub.cs"
    );

  for (
    const name of [
      "scriptCommand",
      "automationScriptStateChanged",
      "automationScriptSnapshot",
      "automationScriptLog",
      "automationScriptResponse",
      "flowCommand",
      "flowStateChanged",
      "flowLog",
      "flowResponse",
    ]
  ) {
    assert.match(
      hub,
      new RegExp(
        `"${name}"`
      )
    );
  }
});
