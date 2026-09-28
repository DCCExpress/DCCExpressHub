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

test("ESP32 DCC-EX uses one paced FIFO TX path for normal commands", () => {
  const header =
    read(
      "src/DccExBridge.h"
    );

  const source =
    read(
      "src/DccExBridge.cpp"
    );

  assert.match(
    header,
    /_commandIntervalMs\s*=\s*25/
  );

  assert.match(
    header,
    /MAX_TX_QUEUE_DEPTH\s*=\s*128/
  );

  assert.match(
    source,
    /bool DccExBridge::sendCommand\([\s\S]*enqueueCommand\([\s\S]*false\)/
  );

  assert.match(
    source,
    /void DccExBridge::processTxQueue\(\)/
  );

  assert.match(
    source,
    /_nextCommandTxAt[\s\S]*_commandIntervalMs/
  );

  assert.match(
    source,
    /void DccExBridge::loop\(\)[\s\S]*processTxQueue\(\)/
  );

  assert.match(
    source,
    /clearTxQueue\(\)[\s\S]*resetHeartbeatState\(\)/
  );
});

test("ESP32 DCC-EX ESTOP has a priority lane and blocks stale loco motion", () => {
  const bridge =
    read(
      "src/DccExBridge.cpp"
    );

  const compiled =
    read(
      "src/CompiledCommandCenter.h"
    );

  assert.match(
    bridge,
    /_priorityTxQueue/
  );

  assert.match(
    bridge,
    /if \(priority\)[\s\S]*_txQueue\.erase[\s\S]*"<t "/
  );

  assert.match(
    bridge,
    /command\.startsWith\([\s\S]*"<t "[\s\S]*!_priorityTxQueue\.empty\(\)/
  );

  assert.match(
    compiled,
    /sendPriorityCommand\([\s\S]*"<!P>"/
  );

  assert.match(
    compiled,
    /sendPriorityCommand\([\s\S]*"<!>"[\s\S]*sendPriorityCommand\([\s\S]*"<!R>"/
  );
});

test(".NET DCC-EX normal TX waits for actual worker write completion", () => {
  const source =
    read(
      "desktop/DCCExpressHub.Net/CommandCenter/DccExCommandCenter.cs"
    );

  assert.match(
    source,
    /private int _commandIntervalMs = 25/
  );

  assert.match(
    source,
    /private const int MaxQueuedCommands = 128/
  );

  assert.match(
    source,
    /private async Task RunTxQueueAsync/
  );

  assert.match(
    source,
    /public Task<bool> SendRawAsync[\s\S]*QueueRawAsync/
  );

  assert.match(
    source,
    /return await item[\s\S]*\.Completion[\s\S]*\.Task[\s\S]*\.WaitAsync\(ct\)/
  );

  assert.match(
    source,
    /await _transport\.WriteAsync\([\s\S]*item\.Command/
  );

  assert.match(
    source,
    /item\.Completion\.TrySetResult\([\s\S]*sent/
  );
});

test(".NET DCC-EX ESTOP bypasses pacing and closes the motion race", () => {
  const source =
    read(
      "desktop/DCCExpressHub.Net/CommandCenter/DccExCommandCenter.cs"
    );

  assert.match(
    source,
    /private async Task<bool> SendEmergencySequenceAsync/
  );

  assert.match(
    source,
    /Interlocked\.Increment\([\s\S]*ref _motionBarrier/
  );

  assert.match(
    source,
    /cancelOnEmergency[\s\S]*_motionBarrier/
  );

  assert.match(
    source,
    /var txHeld =[\s\S]*false[\s\S]*await _tx\.WaitAsync\(ct\)[\s\S]*txHeld =[\s\S]*true/
  );

  assert.match(
    source,
    /finally[\s\S]*if \(txHeld\)[\s\S]*_tx\.Release\(\)[\s\S]*Interlocked\.Decrement\([\s\S]*ref _motionBarrier/
  );

  assert.match(
    source,
    /SendEmergencySequenceAsync\([\s\S]*\["<!>", "<!R>"\]/
  );

  assert.doesNotMatch(
    source,
    /EmergencyStopAsync[\s\S]{0,1200}SendRawAsync/
  );
});

test("DCC-EX command interval is persisted and editable with a 25 ms default", () => {
  const espConfig =
    read(
      "src/HubConfigStore.cpp"
    );

  const espApi =
    read(
      "src/ApiServer.cpp"
    );

  const netConfig =
    read(
      "desktop/DCCExpressHub.Net/Web/CommandCenterConfigStore.cs"
    );

  const netProgram =
    read(
      "desktop/DCCExpressHub.Net/Program.cs"
    );

  const ui =
    read(
      "web-ui/src/components/CommandCenterSettingsDialog.tsx"
    );

  assert.match(
    espConfig,
    /"csbTxMs"[\s\S]*25/
  );

  assert.match(
    espApi,
    /"commandIntervalMs"/
  );

  assert.match(
    netConfig,
    /CommandIntervalMs \{ get; init; \} = 25/
  );

  assert.match(
    netProgram,
    /SetCommandIntervalMs\([\s\S]*persistedCc\.CommandIntervalMs/
  );

  assert.match(
    ui,
    /DCC-EX command interval/
  );

  assert.match(
    ui,
    /min=\{0\}[\s\S]*max=\{1000\}[\s\S]*step=\{5\}/
  );

  assert.match(
    ui,
    /Emergency stop bypasses this delay/
  );
});

test("generic command-center pacing hooks stay optional so Z21 is not forced through DCC-EX TX policy", () => {
  const contract =
    read(
      "src/ICommandCenter.h"
    );

  const z21 =
    read(
      "src/Z21CommandCenter.h"
    );

  assert.match(
    contract,
    /virtual void setCommandIntervalMs\([\s\S]*\(void\)intervalMs/
  );

  assert.match(
    contract,
    /virtual uint16_t commandIntervalMs\(\) const \{[\s\S]*return 0/
  );

  assert.doesNotMatch(
    z21,
    /commandIntervalMs|setCommandIntervalMs/
  );
});
