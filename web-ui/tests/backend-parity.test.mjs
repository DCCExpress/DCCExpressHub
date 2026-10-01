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

const repoRoot =
  path.resolve(
    here,
    "..",
    ".."
  );

function read(relativePath) {
  return fs.readFileSync(
    path.join(
      repoRoot,
      relativePath
    ),
    "utf8"
  );
}

function uniqueSorted(values) {
  return [
    ...new Set(values),
  ].sort();
}

function windowsTopLevelWsCommands(source) {
  const start =
    source.indexOf(
      "private async Task Handle(Guid"
    );

  const end =
    source.indexOf(
      "private async Task<(bool Ok",
      start
    );

  assert.ok(
    start >= 0 &&
    end > start,
    "Could not locate Windows WS command dispatcher"
  );

  return uniqueSorted(
    [
      ...source
        .slice(start, end)
        .matchAll(
          /case\s+"([^"]+)"/g
        ),
    ].map(
      match =>
        match[1]
    )
  );
}

function espTopLevelWsCommands(source) {
  return uniqueSorted(
    [
      ...source.matchAll(
        /strcmp\(\s*type\s*,\s*"([^"]+)"\s*\)/g
      ),
    ].map(
      match =>
        match[1]
    )
  );
}

test("ESP32 WebSocket command contract matches the Windows backend", () => {
  const windows =
    read(
      "desktop/DCCExpressHub.Net/Web/WsHub.cs"
    );

  const esp =
    read(
      "src/WsProtocol.cpp"
    );

  const windowsCommands =
    windowsTopLevelWsCommands(
      windows
    );

  /*
   * Windows-first migration: Dispatcher, Movement and Timetable runtime
   * commands are intentionally native-only until the .NET implementation is
   * stable. Keep every other WS command under strict ESP32 parity.
   */
  for (
    const windowsOnly of
    [
      "dispatcherCommand",
      "movementCommand",
      "movementAudioComplete",
      "timetableCommand",
      "timetableScriptComplete",
    ]
  ) {
    assert.ok(
      windowsCommands.includes(
        windowsOnly
      )
    );
  }

  const windowsOnly =
    new Set([
      "dispatcherCommand",
      "movementCommand",
      "movementAudioComplete",
      "timetableCommand",
      "timetableScriptComplete",
    ]);

  assert.deepEqual(
    espTopLevelWsCommands(
      esp
    ),
    windowsCommands.filter(
      command =>
        !windowsOnly.has(
          command
        )
    )
  );
});

test("ESP32 implements the Windows-authoritative SwitchMan safety contract", () => {
  const windows =
    read(
      "desktop/DCCExpressHub.Net/Web/WsHub.cs"
    );

  const esp =
    read(
      "src/WsProtocol.cpp"
    );

  for (
    const action of
    [
      "snapshot",
      "acquire",
      "release",
      "forceReleaseAll",
      "set",
    ]
  ) {
    assert.match(
      windows,
      new RegExp(
        `case "${action}"`
      )
    );

    assert.match(
      esp,
      new RegExp(
        `action\\s*==\\s*"${action}"`
      )
    );
  }

  assert.match(
    esp,
    /"switchManResponse"/
  );

  assert.match(
    esp,
    /"switchManChanged"/
  );

  assert.match(
    esp,
    /sendSwitchManSnapshot\(/
  );

  assert.match(
    esp,
    /setTurnout[\s\S]*acquireManualTurnoutOperation/
  );

  assert.match(
    esp,
    /setSignalAspect[\s\S]*turnoutExtended[\s\S]*acquireManualTurnoutOperation/
  );

  assert.match(
    esp,
    /setBasicAccessory[\s\S]*!turnout->turnoutExtended[\s\S]*acquireManualTurnoutOperation/
  );

  assert.match(
    esp,
    /setVpin[\s\S]*turnoutVPin[\s\S]*acquireManualTurnoutOperation/
  );
});

test("ESP32 exposes the frontend-required HTTP parity endpoints", () => {
  const apiServer =
    read(
      "src/ApiServer.cpp"
    );

  const capabilities =
    read(
      "src/HubCapabilitiesEndpoint.cpp"
    );

  const scriptInfo =
    read(
      "src/ScriptInfoEndpoint.cpp"
    );

  const requiredRoutes = [
    "/api/command-center-config",
    "/api/command-center-test",
    "/api/command-center-info",
    "/api/layout",
    "/api/locos",
    "/api/runtime",
    "/api/status",
    "/api/emergency-stop",
    "/api/s88-status",
  ];

  for (
    const route of
    requiredRoutes
  ) {
    assert.match(
      apiServer,
      new RegExp(
        route.replace(
          /[.*+?^\${}()|[\]\\]/g,
          "\\$&"
        )
      )
    );
  }

  assert.match(
    capabilities,
    /document\["s88"\][\s\S]*false/
  );

  assert.match(
    scriptInfo,
    /"\/api\/script-info"/
  );

  assert.match(
    scriptInfo,
    /AsyncEventSource/
  );
});


test("ESP32 runtime snapshot matches the Windows authoritative state contract", () => {
  const nativeRuntime =
    read(
      "desktop/DCCExpressHub.Net/Web/LayoutRuntime.cs"
    );

  const nativeWs =
    read(
      "desktop/DCCExpressHub.Net/Web/WsHub.cs"
    );

  const espWs =
    read(
      "src/WsProtocol.cpp"
    );

  assert.match(
    nativeRuntime,
    /"runtimePhysicalSnapshot"/
  );

  assert.match(
    espWs,
    /"runtimePhysicalSnapshot"/
  );

  assert.match(
    nativeRuntime,
    /"sensorSnapshot"/
  );

  assert.match(
    espWs,
    /"sensorSnapshot"/
  );

  assert.match(
    nativeWs,
    /foreach \(var l in HubState\.Locos\.Values\)[\s\S]*"locoState"/
  );

  assert.match(
    espWs,
    /_locoCount[\s\S]*"locoState"/
  );

  assert.match(
    nativeRuntime,
    /logicalClosed/
  );

  assert.match(
    espWs,
    /data\["logicalClosed"\]/
  );

  assert.match(
    espWs,
    /data\["outputMode"\]/
  );

  assert.match(
    espWs,
    /data\["closedAspect"\]/
  );

  assert.match(
    espWs,
    /data\["openedAspect"\]/
  );
});

test("ESP32 HTTP runtime and status contracts retain Windows canonical fields", () => {
  const espApi =
    read(
      "src/ApiServer.cpp"
    );

  assert.match(
    espApi,
    /doc\["blockState"\]/
  );

  assert.match(
    espApi,
    /doc\["sensorSnapshot"\]/
  );

  assert.match(
    espApi,
    /doc\["csbTransport"\]/
  );

  assert.match(
    espApi,
    /doc\["csbSerialPort"\]/
  );

  assert.match(
    espApi,
    /doc\["csbBaudRate"\]/
  );

  assert.match(
    espApi,
    /"\/version\.json"/
  );

  assert.match(
    espApi,
    /requestSensorSnapshot\([\s\S]*false/
  );
});

test("ESP32 manual turnout lock is held until runtime state has been broadcast", () => {
  const espWs =
    read(
      "src/WsProtocol.cpp"
    );

  const turnoutStart =
    espWs.indexOf(
      '"setTurnout"'
    );

  const turnoutEnd =
    espWs.indexOf(
      '"setSignalAspect"',
      turnoutStart
    );

  const turnoutBlock =
    espWs.slice(
      turnoutStart,
      turnoutEnd
    );

  assert.ok(
    turnoutBlock.indexOf(
      "broadcastTurnoutState("
    ) >=
      0
  );

  assert.ok(
    turnoutBlock.indexOf(
      "broadcastTurnoutState("
    ) <
      turnoutBlock.lastIndexOf(
        "switchManRelease("
      ),
    "manual turnout lock must remain held through the state broadcast"
  );
});


