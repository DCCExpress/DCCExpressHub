# DCCExpressHub – Automation Script API

## 1. Basics

DCCExpressHub automation scripts run as asynchronous JavaScript. This allows waiting operations to use `await` while keeping the UI responsive and preserving Pause / Resume / Abort behavior.

### Custom async function

```js
async function runTrain() {
  dcc.setLoco(18, 30, "forward");
  await delay(1000);
  dcc.setLoco(18, 0, "forward");
}

await runTrain();
```

### `await delay(ms)`

Non-blocking delay.

```js
await delay(1000);
```

### `await Promise.all([...])`

Runs multiple asynchronous operations in parallel and waits until all of them complete.

```js
await Promise.all([
  task1(),
  task2(),
]);
```

### `setInfo(message)`

Displays a temporary status message on the running automation card.

```js
setInfo("Locomotive is departing for block B1");
```

Clear the message:

```js
setInfo("");
```

### `log(value, ...)`

Writes values to the browser console together with the automation name.

```js
log("P101 reached the next point", 33);
```

### `element`

Read-only safe context of the automation element that is running the script.

```js
log(element.id, element.name);
```

---

## 2. Automation Control – Running / Finishing

### `isRunning()`

Returns `true` while Automation Control is in normal running mode.

Typical loop:

```js
while (isRunning()) {
  await runSequence();
}
```

If Finishing mode is enabled while `runSequence()` is already running, the current sequence may complete, but another cycle will not start.

### `isFinishing()`

Returns `true` while the global Finishing mode is active.

```js
if (isFinishing()) {
  return;
}
```

### Recommended cyclic script

```js
async function runSequence() {
  setInfo("A -> B");
  dcc.setLoco(18, 30, "forward");
  await dcc.waitForSensor(33, true);

  setInfo("B -> A");
  dcc.setLoco(18, 30, "reverse");
  await dcc.waitForSensor(20, true);
}

while (isRunning()) {
  await runSequence();
}

dcc.setLoco(18, 0, "forward");
setInfo("Finished");
```

---

# 3. SwitchMan – turnout section locking

`switchMan()` reserves a group of turnouts **atomically, using all-or-none locking**.

```text
1. request the complete turnout group
2. if any turnout is busy -> wait
3. when every turnout is free -> lock all of them at once
4. run the callback
5. automatically release the reservation when the callback finishes
```

When the callback completes normally, throws an exception, or is cooperatively aborted, the `finally` path attempts to release the reservation.

## 3.1 Simple SwitchMan example

```js
await switchMan([10, 11], async sw => {
  setInfo("Setting turnout section");

  await sw.setTurnout(10, true);
  await sw.setTurnout(11, false);

  setInfo("Departing");
  dcc.setLoco(18, 30, "forward");

  await dcc.waitForSensor(33, true);
});
```

After the callback finishes, turnouts `10` and `11` are automatically released.

## 3.2 `sw.setTurnout(address, closed)`

Only a turnout owned by the current SwitchMan scope can be operated.

```js
await sw.setTurnout(10, true);
```

Logical `closed` state:

```js
true   // CLOSED
false  // THROWN
```

This throws an error if the scope owns only `[10, 11]`:

```js
await sw.setTurnout(25, true);
```

## 3.3 Two consecutive turnout sections

```js
await switchMan([10, 11], async sw => {
  await sw.setTurnout(10, true);
  await sw.setTurnout(11, false);

  dcc.setLoco(18, 30, "forward");
  await dcc.waitForSensor(33, true);
});

await dcc.waitForSensor(40, true);

await switchMan([20, 21, 22], async sw => {
  await sw.setTurnout(20, false);
  await sw.setTurnout(21, true);
  await sw.setTurnout(22, true);

  await dcc.waitForSensor(55, true);
});

dcc.setLoco(18, 0, "forward");
```

## 3.4 Two scripts competing for the same turnout

P101:

```js
await switchMan([10, 11], async sw => {
  // ...
});
```

P202:

```js
await switchMan([11, 12], async sw => {
  // ...
});
```

If P101 owns `[10, 11]`, P202 waits. When P101 releases its section, P202 may atomically acquire `[11, 12]`.

While waiting, the script information may show for example:

```text
Waiting for turnout section: 11 (P101)
```

> The current runtime may display this message in Hungarian depending on the implementation/UI language. The behavior is the same.

## 3.5 Timeout

By default, SwitchMan waits **indefinitely**.

```js
await switchMan([10, 11], async sw => {
  await sw.setTurnout(10, true);
  await sw.setTurnout(11, false);
}, 30000);
```

This waits for at most 30 seconds.

```js
await switchMan([10, 11], async sw => {
  // ...
}, 0);
```

`0` means immediate timeout if the entire turnout group is not currently available.

The maximum accepted timeout is currently `600000 ms` (10 minutes).

## 3.6 Finishing + SwitchMan

```js
async function runCycle() {
  await switchMan([10, 11], async sw => {
    await sw.setTurnout(10, true);
    await sw.setTurnout(11, false);

    dcc.setLoco(18, 30, "forward");
    await dcc.waitForSensor(33, true);
  });

  await switchMan([20, 21], async sw => {
    await sw.setTurnout(20, false);
    await sw.setTurnout(21, true);

    await dcc.waitForSensor(55, true);
  });
}

while (isRunning()) {
  await runCycle();
}

dcc.setLoco(18, 0, "forward");
```

When Finishing mode is enabled, an already-started cycle may complete, but a new cycle will not begin.

## 3.7 Important SwitchMan rules

- Reservation of the complete turnout group is atomic.
- Nested overlapping SwitchMan scopes inside the same script are not allowed.
- For example, starting `[11, 12]` inside an active `[10, 11]` scope throws an error because the script would otherwise wait on its own lock.
- Inside a SwitchMan callback, use `await sw.setTurnout(...)` for turnouts owned by that scope.
- Normal `dcc.setTurnout(...)` does not inherit the ownership of the SwitchMan scope.
- The backend lock is the final authoritative protection.
- The flashing red turnout indicator in the WebUI is only a visual representation; the real lock lives in the backend.

---

# 4. RouteButton

### `await setRoute(name)`

Executes a RouteButton by name. The default delay between route turnout steps is 250 ms.

```js
await setRoute("Entrance 1");
```

### `await setRoute(name, delayMs)`

Uses a custom delay between route steps.

```js
await setRoute("Entrance 1", 100);
```

> When operating turnouts already reserved by SwitchMan, prefer `sw.setTurnout()` from inside the SwitchMan scope. A normal route command may be rejected by the backend if it attempts to operate a locked turnout.

---

# 5. Locomotives and power

## `dcc.setLoco(address, speed, direction)`

Sets locomotive speed and direction.

- address: `1..10239`
- speed: `0..126`
- direction: `"forward"` or `"reverse"`

```js
dcc.setLoco(18, 30, "forward");
```

Stop:

```js
dcc.setLoco(18, 0, "forward");
```

## `dcc.setLocoFunction(address, function, active)`

Controls functions F0–F28.

```js
dcc.setLocoFunction(18, 0, true);
dcc.setLocoFunction(18, 2, false);
```

## `dcc.setPower(on)`

Main track power.

```js
dcc.setPower(true);
dcc.setPower(false);
```

## `dcc.setProgrammingPower(on)`

Programming track power.

```js
dcc.setProgrammingPower(true);
```

## `dcc.emergencyStop()`

Sends an immediate emergency stop.

```js
dcc.emergencyStop();
```

---

# 6. Sensors

From the script API point of view, a sensor is a unified sensor. It does not matter whether the state comes from S88, `<Q>`, or another backend source.

## `dcc.getSensor(address)`

Returns the locally cached sensor state.

```js
const occupied = dcc.getSensor(33);

if (occupied) {
  log("Sensor 33 is occupied");
}
```

## `dcc.setSensor(address, on)`

Sets a sensor runtime state through the Hub API.

```js
dcc.setSensor(33, true);
```

## `dcc.waitForSensor(address, on, timeoutMs?)`

Event-driven wait for a sensor state.

Without timeout, it waits indefinitely:

```js
await dcc.waitForSensor(33, true);
```

10-second timeout:

```js
await dcc.waitForSensor(33, true, 10000);
```

Wait until the section becomes clear:

```js
await dcc.waitForSensor(33, false);
```

The supplied wait timeout is currently `1..600000 ms`.

---

# 7. Turnouts

The normal turnout API uses the logical turnout configuration defined in the Layout.

## `dcc.getTurnout(address)`

Returns the current logical turnout state.

```js
const closed = dcc.getTurnout(20);
```

## `dcc.isClosed(address)`

```js
if (dcc.isClosed(20)) {
  log("CLOSED");
}
```

## `dcc.isThrown(address)`

```js
if (dcc.isThrown(20)) {
  log("THROWN");
}
```

## `dcc.setTurnout(address, closed)`

```js
dcc.setTurnout(20, true);   // CLOSED
dcc.setTurnout(20, false);  // THROWN
```

## `dcc.setClosed(address)`

```js
dcc.setClosed(20);
```

## `dcc.setThrown(address)`

```js
dcc.setThrown(20);
```

## `dcc.waitForTurnout(address, closed, timeoutMs?)`

```js
await dcc.waitForTurnout(20, true);
```

With timeout:

```js
await dcc.waitForTurnout(20, true, 10000);
```

## `dcc.waitForClosed(address, timeoutMs?)`

```js
await dcc.waitForClosed(20);
```

## `dcc.waitForThrown(address, timeoutMs?)`

```js
await dcc.waitForThrown(20);
```

---

# 8. Signals

The high-level signal API uses logical signal states configured in the Layout.

## `dcc.getSignalState(address)`

```js
const state = dcc.getSignalState(100);
log(state);
```

## `dcc.isSignalState(address, stateName)`

```js
if (dcc.isSignalState(100, "Slow")) {
  log("Signal is showing Slow");
}
```

## Color-state checks

```js
dcc.isRed(100);
dcc.isGreen(100);
dcc.isYellow(100);
dcc.isWhite(100);
```

## `dcc.setSignalState(address, stateName)`

```js
dcc.setSignalState(100, "Slow");
```

## Color-state setters

```js
dcc.setRed(100);
dcc.setGreen(100);
dcc.setYellow(100);
dcc.setWhite(100);
```

## `dcc.waitForSignalState(address, stateName, timeoutMs?)`

```js
await dcc.waitForSignalState(100, "Slow");
```

With timeout:

```js
await dcc.waitForSignalState(100, "Slow", 10000);
```

## Color-state waits

```js
await dcc.waitForRed(100);
await dcc.waitForGreen(100);
await dcc.waitForYellow(100);
await dcc.waitForWhite(100);
```

Each may receive an optional `timeoutMs` argument.

## `dcc.setSignalAspect(address, aspect)`

Low-level explicit DCC extended signal aspect.

- signal address: `1..2048`
- aspect: `0..255`

```js
dcc.setSignalAspect(100, 16);
```

If the Layout contains a configured logical signal state, new scripts should generally prefer `setSignalState()` / `setRed()` / `setGreen()` and similar helpers.

---

# 9. Blocks

A block can be addressed by name or by numeric Layout ID.

## `dcc.getBlock(blockName)`

Returns the DCC locomotive address currently assigned to the block, or `0`.

```js
const loco = dcc.getBlock("A1");

if (loco === 18) {
  log("Locomotive 18 is in A1");
}
```

## `dcc.setBlock(blockName, locoAddress)`

```js
dcc.setBlock("A2", 18);
```

## `dcc.clearBlock(blockName)`

```js
dcc.clearBlock("A2");
```

## `dcc.resetBlocks()`

Clears all runtime block-to-locomotive assignments.

```js
dcc.resetBlocks();
```

## `dcc.getBlockTargetLoco(blockName)`

Returns the locomotive address currently marked as heading toward the block, or `0`.

```js
const target = dcc.getBlockTargetLoco("A2");
```

## `dcc.setBlockTargetLoco(blockName, locoAddress)`

```js
dcc.setBlockTargetLoco("A2", 18);
```

## `dcc.clearBlockTargetLoco(blockName)`

```js
dcc.clearBlockTargetLoco("A2");
```

---

# 10. Other DCC / output operations

## `dcc.setAccessory(address, active)`

Low-level basic DCC accessory setter.

```js
dcc.setAccessory(100, true);
```

## `dcc.sendRaw("<DCC-EX command>")`

Sends a raw DCC-EX command.

```js
dcc.sendRaw("<s>");
```

For new scripts, prefer a higher-level `dcc.*` API whenever one exists.

---

# 11. Audio playback

## `playAudio(name)`

Plays an MP3 file from the SD card audio directory.

Pass only the base filename, without path or `.mp3` extension:

```js
playAudio("mav_szignal");
```

---

# 12. Complete simple train movement example

```js
setInfo("P101 ready to depart");

await switchMan([10, 11], async sw => {
  setInfo("Setting P101 turnout section");

  await sw.setTurnout(10, true);
  await sw.setTurnout(11, false);

  dcc.setGreen(100);

  dcc.setBlockTargetLoco("B2", 18);

  setInfo("P101 departing");
  dcc.setLoco(18, 30, "forward");

  await dcc.waitForSensor(33, true, 30000);

  dcc.setLoco(18, 0, "forward");
  dcc.setRed(100);

  dcc.clearBlockTargetLoco("B2");
  dcc.setBlock("B2", 18);

  setInfo("P101 arrived in B2");
});
```

---

# 13. Complete cyclic train movement with Finishing support

```js
async function AtoB() {
  await switchMan([10, 11], async sw => {
    setInfo("A -> B turnout section");

    await sw.setTurnout(10, true);
    await sw.setTurnout(11, false);

    dcc.setLoco(18, 30, "forward");

    await dcc.waitForSensor(33, true);
    dcc.setLoco(18, 0, "forward");
  });
}

async function BtoA() {
  await switchMan([20, 21], async sw => {
    setInfo("B -> A turnout section");

    await sw.setTurnout(20, false);
    await sw.setTurnout(21, true);

    dcc.setLoco(18, 30, "reverse");

    await dcc.waitForSensor(20, true);
    dcc.setLoco(18, 0, "reverse");
  });
}

while (isRunning()) {
  await AtoB();

  if (isFinishing()) {
    break;
  }

  await BtoA();
}

setInfo("P101 finished");
```

---

# 14. Recommended Quick Help API – short list

## JavaScript / runtime

```text
async function name()
await delay(ms)
await Promise.all([...])
isFinishing()
isRunning()
log(value, ...)
setInfo(message)
playAudio(name)
```

## SwitchMan

```text
await switchMan([turnouts], async sw => { ... })
await switchMan([turnouts], async sw => { ... }, timeoutMs)
await sw.setTurnout(address, closed)
```

## Route

```text
await setRoute(name)
await setRoute(name, delayMs)
```

## Dispatcher / Task Manager

```text
await dispatcher([blocks], async (loco, dir) => { ... }, options?)
await smartDispatcher([blocks], async (loco, dir, run) => { ... }, options?)
startTask(name, taskFunction)
isTaskRunning(name)
getTaskState(name)
```

## Blocks

```text
dcc.clearBlock(blockName)
dcc.clearBlockTargetLoco(blockName)
dcc.getBlock(blockName)
dcc.getBlockTargetLoco(blockName)
dcc.resetBlocks()
dcc.setBlock(blockName, locoAddress)
dcc.setBlockTargetLoco(blockName, locoAddress)
```

## Sensors

```text
dcc.getSensor(address)
dcc.setSensor(address, on)
dcc.waitForSensor(address, on, timeoutMs?)
```

## Turnouts

```text
dcc.getTurnout(address)
dcc.isClosed(address)
dcc.isThrown(address)
dcc.setClosed(address)
dcc.setThrown(address)
dcc.setTurnout(address, closed)
dcc.waitForClosed(address, timeoutMs?)
dcc.waitForThrown(address, timeoutMs?)
dcc.waitForTurnout(address, closed, timeoutMs?)
```

## Signals

```text
dcc.getSignalState(address)
dcc.isGreen(address)
dcc.isRed(address)
dcc.isSignalState(address, stateName)
dcc.isWhite(address)
dcc.isYellow(address)
dcc.setGreen(address)
dcc.setRed(address)
dcc.setSignalAspect(address, aspect)
dcc.setSignalState(address, stateName)
dcc.setWhite(address)
dcc.setYellow(address)
dcc.waitForGreen(address, timeoutMs?)
dcc.waitForRed(address, timeoutMs?)
dcc.waitForSignalState(address, stateName, timeoutMs?)
dcc.waitForWhite(address, timeoutMs?)
dcc.waitForYellow(address, timeoutMs?)
```

## Power / locomotive / low level

```text
dcc.emergencyStop()
dcc.sendRaw("<DCC-EX command>")
dcc.setAccessory(address, active)
dcc.setLoco(address, speed, "forward|reverse")
dcc.setLocoFunction(address, function, active)
dcc.setPower(on)
dcc.setProgrammingPower(on)
```

---

# 15. Advanced / compatibility API still present in the runtime

These APIs genuinely exist in the worker runtime, but they are **not part of the recommended Quick Help API**.

## `dcc.setTurnoutRaw(address, closed)`

Low-level turnout command that does not use the Layout logical turnout configuration.

```js
dcc.setTurnoutRaw(20, true);
```

For new scripts, normally prefer:

```js
dcc.setTurnout(20, true);
```

or, inside a SwitchMan scope:

```js
await sw.setTurnout(20, true);
```

## `dcc.block(blockId, locoId, locoAddress?)`

Lower-level block assignment API. For normal automation scripts, prefer `setBlock()` / `clearBlock()`.

---

# 16. Legacy aliases

The following aliases are still available for runtime compatibility:

```text
dcc.power(on)
dcc.programmingPower(on)
dcc.loco(address, speed, direction)
dcc.locoFunction(address, function, active)
dcc.turnout(address, closed)
dcc.sensor(address, on)
dcc.accessory(address, active)
dcc.signal(address, aspect)
dcc.raw(command)
```

For new scripts, use the explicit API names instead:

```text
dcc.setPower(...)
dcc.setProgrammingPower(...)
dcc.setLoco(...)
dcc.setLocoFunction(...)
dcc.setTurnout(...)
dcc.setSensor(...)
dcc.setAccessory(...)
dcc.setSignalAspect(...)
dcc.sendRaw(...)
```

---

# 17. Short rules

1. Use `await` when waiting for sensor, turnout, or signal state changes.
2. Omitting the timeout from `waitFor*()` generally means waiting indefinitely.
3. Use `switchMan()` for conflict-safe turnout section reservation.
4. Inside a SwitchMan scope, operate reserved turnouts with `await sw.setTurnout()`.
5. For cyclic automations, control the outer loop with `isRunning()` / `isFinishing()`.
6. Prefer high-level logical APIs over raw DCC commands whenever possible.
7. S88 / `<Q>` / other sensor sources all use the same script sensor API.
8. Emergency stop is directly available as `dcc.emergencyStop()`.
9. Before using Dispatcher, generate the route graph and save it together with the Layout.
10. For repeated concurrent Dispatcher attempts, use the single-flight `startTask()` Task Manager.


---

# 18. Dispatcher – graph-based route and block reservation

`dispatcher()` selects exactly one physical route from the saved Layout route graph, reserves the affected blocks, configures and locks required turnouts through SwitchMan when necessary, and then delegates the actual train movement to the script callback.

## 18.1 Basic usage

```js
const result = await dispatcher(
  ["A1", "B1", "C1"],
  async (loco, dir) => {
    dcc.setLoco(loco, 20, dir);
    await dcc.waitForSensor(1020, true);
    dcc.setLoco(loco, 0, dir);
  }
);
```

Callback parameters:

- `loco`: DCC locomotive address assigned to the source block;
- `dir`: `"forward"` or `"reverse"` direction resolved from the route graph.

Possible Dispatcher result statuses:

```text
completed
empty
blocked
```

## 18.2 The block list is a checkpoint list

The supplied blocks do not have to contain every physical block on the route.

If the full route is:

```text
A1 -> B2 -> C3 -> D4
```

this is also valid:

```js
await dispatcher(["A1", "B2", "D4"], async (loco, dir) => {
  // ...
});
```

Checkpoints must appear in the same order as in the complete route. The first and last blocks are always the requested route endpoints.

No matching route:

```text
dispatcher_route_not_found
```

More than one matching physical route:

```text
dispatcher_route_ambiguous
```

Dispatcher deliberately does not auto-select between alternatives. Add enough intermediate checkpoint blocks to reduce the match set to exactly one route.

## 18.3 Block reservation rules

The source block:

- may be physically occupied because the train starts there;
- provides the locomotive address through its actual block assignment;
- must not already contain a target-locomotive marker.

Every route block after the source must simultaneously satisfy:

```text
actual loco == 0
target loco == 0
occupancy sensor == false
```

Before movement begins, Dispatcher writes target-locomotive markers to every downstream route block and performs a second safety check to ensure the state did not change during reservation.

Overlapping Dispatcher routes are serialized with Web Locks. Overlapping active Dispatcher routes inside the same script are not allowed.

## 18.4 Turnouts

When the selected route requires turnout changes, Dispatcher automatically uses SwitchMan.

The turnout states stored in the route graph are applied and the SwitchMan scope remains held for the complete Dispatcher callback.

If the turnout section is currently locked, that Dispatcher attempt returns `blocked`, allowing the Task Manager / scheduler to retry later.

## 18.5 Successful commit and rollback

When the callback completes successfully:

1. actual + target state is cleared from every route block before the destination;
2. the destination target marker is cleared;
3. the destination actual block assignment is set to the Dispatcher locomotive.

If the callback throws or is aborted, Dispatcher **does not pretend the train arrived**. It only removes target markers created by that Dispatcher attempt.

## 18.6 Options

```js
await dispatcher(
  ["A1", "B1", "C1"],
  async (loco, dir) => {
    // ...
  },
  {
    timeoutMs: 30000,
    setDelayMs: 250,
    blockPollMs: 250,

    onEmpty: async dir => {
      log("A1 is empty", dir);
    },

    onBlocked: async (loco, dir, conflicts) => {
      log("Route blocked", loco, dir, conflicts);
    },
  }
);
```

- `timeoutMs`: timeout for waiting on block locks; omitted means no explicit Dispatcher timeout, maximum `600000 ms`;
- `setDelayMs`: delay between turnout operations, default `250 ms`;
- `blockPollMs`: block-lock retry interval, default `250 ms`, range `25..5000 ms`;
- `onEmpty(dir)`: called when the source block contains no locomotive;
- `onBlocked(loco, dir, conflicts)`: called for block or turnout conflicts.

If `onEmpty` is omitted, an empty source block throws `dispatcher_empty_source`.

---

# 19. Task Manager – concurrent single-flight tasks

`startTask()` lets an automation scheduler run independent async tasks concurrently without starting the same named task more than once at the same time.

## 19.1 `startTask(name, taskFunction)`

```js
startTask("A1_TO_C1", A1toC1);
```

The call returns immediately while the task continues in the background.

Only one instance of the same task name can run at a time. If it is already running:

```text
started = false
reason = "already-running"
```

While Finishing mode is active, new tasks are not started:

```text
started = false
reason = "finishing"
```

Already running tasks are still allowed to finish their current work.

## 19.2 `isTaskRunning(name)`

```js
if (isTaskRunning("A1_TO_C1")) {
  log("A1_TO_C1 is still running");
}
```

## 19.3 `getTaskState(name)`

```js
const state = getTaskState("A1_TO_C1");
log(state);
```

The state includes:

```text
name
running
status
runCount
startedAt
finishedAt
lastResult
lastError
```

Task Manager records and logs background task errors so they do not become unhandled Promise rejections.

---

# 20. Complete Dispatcher + Task Manager example

```js
const SENSOR_A1 = 1001;
const SENSOR_B1 = 1006;
const SENSOR_B2 = 1007;
const SENSOR_C1 = 1020;

const SPEED = 20;
const HORN_FUNCTION = 2;

async function horn(loco) {
  dcc.setLocoFunction(loco, HORN_FUNCTION, true);
  await delay(700);
  dcc.setLocoFunction(loco, HORN_FUNCTION, false);
}

async function A1toC1() {
  await dispatcher(
    ["A1", "B1", "C1"],

    async (loco, dir) => {
      setInfo(`Loco ${loco}: A1 -> B1 -> C1`);

      dcc.setLoco(loco, SPEED, dir);

      await dcc.waitForSensor(SENSOR_B1, true);

      log(`Loco ${loco}: B1`);

      await horn(loco);

      dcc.setLoco(loco, 25, dir);

      await dcc.waitForSensor(SENSOR_C1, true);

      log(`Loco ${loco}: C1`);

      dcc.setLoco(loco, 0, dir);
    },

    {
      onEmpty: async () => {
        log("A1 -> C1: no locomotive in A1");
      },

      onBlocked: async (loco, dir, conflicts) => {
        log("A1 -> C1: blocked", loco, conflicts);
      }
    }
  );
}

async function C1toA1() {
  await dispatcher(
    ["C1", "B2", "A1"],

    async (loco, dir) => {
      setInfo(`Loco ${loco}: C1 -> B2 -> A1`);

      dcc.setLoco(loco, SPEED, dir);

      await dcc.waitForSensor(SENSOR_B2, true);

      log(`Loco ${loco}: B2`);

      await horn(loco);

      dcc.setLoco(loco, 25, dir);

      await dcc.waitForSensor(SENSOR_A1, true);

      log(`Loco ${loco}: A1`);

      dcc.setLoco(loco, 0, dir);
    },

    {
      onEmpty: async () => {
        log("C1 -> A1: no locomotive in C1");
      },

      onBlocked: async (loco, dir, conflicts) => {
        log("C1 -> A1: blocked", loco, conflicts);
      }
    }
  );
}

while (isRunning()) {
  startTask("A1_TO_C1", A1toC1);
  startTask("C1_TO_A1", C1toA1);

  await delay(500);
}

setInfo("Finishing - no new dispatcher");
```

This scheduler attempts to start both routes every 500 ms. Because `startTask()` is single-flight by task name, the same route cannot start again while its previous instance is still running. If a Dispatcher attempt quickly finishes with `empty` or `blocked`, a later scheduler cycle can retry it.


---

# 21. SmartDispatcher – rolling block reservation

\`smartDispatcher()\` is a separate implementation next to the stable \`dispatcher()\`. The normal Dispatcher still reserves the full route in advance; SmartDispatcher holds only the **current and next block**.

SmartDispatcher automatically:

- checks the next block's \`actual\`, \`target\`, and occupancy state;
- acquires the next block Web Lock;
- marks the next block with the target locomotive;
- locks and sets only the turnouts required for the current block transition;
- stops the locomotive when clearance is unavailable;
- restores the requested speed when clearance becomes available;
- releases the previous block and transition turnout locks after confirmed arrival;
- automatically stops the locomotive at the destination.

## 21.1 Basic usage

\`\`\`js
await smartDispatcher(
  ["A1", "B1", "C1"],

  async (loco, dir, run) => {
    run.setSpeed(20);

    await run.waitForBlock("B1");

    await horn(loco);

    run.setSpeed(25);

    await run.waitForBlock("C1");
  }
);
\`\`\`

For normal movement inside SmartDispatcher, use \`run.setSpeed()\` instead of direct \`dcc.setLoco()\`. This lets SmartDispatcher remember the desired speed and restore it automatically after clearance returns.

## 21.2 arrivedWhen – confirmed block arrival

Explicit sensor conditions can be assigned to a block:

\`\`\`js
await smartDispatcher(
  [
    "A1",

    {
      block: "B1",
      arrivedWhen: [
        { sensor: 1000, state: true },
        { sensor: 999, state: false }
      ]
    },

    {
      block: "C1",
      arrivedWhen: [
        { sensor: 1010, state: true },
        { sensor: 1000, state: false }
      ]
    }
  ],

  async (loco, dir, run) => {
    run.setSpeed(20);

    await run.waitForBlock("B1");

    await horn(loco);

    await run.waitForBlock("C1");
  }
);
\`\`\`

In this example B1 is considered fully reached when:

\`\`\`text
sensor 1000 == true
sensor  999 == false
\`\`\`

This means the train is detected in B1 and has completely left the previous section. Only then does SmartDispatcher release the previous block.

When no explicit \`arrivedWhen\` is supplied, the default is:

\`\`\`text
current block occupancy sensor  == true
previous block occupancy sensor == false
\`\`\`

If two adjacent blocks use the same occupancy sensor, an explicit \`arrivedWhen\` is required.

## 21.3 Clearance and automatic stopping

SmartDispatcher continuously attempts to reserve the next block.

The next block is usable only when:

\`\`\`text
actual loco == 0
target loco == 0
occupancy   == false
block Web Lock can be acquired
required turnout locks can be acquired
required turnout states can be set
\`\`\`

If clearance is unavailable, physical speed becomes:

\`\`\`text
0
\`\`\`

while the speed requested with \`run.setSpeed()\` is retained.

For example:

\`\`\`js
run.setSpeed(30);
\`\`\`

While the next block is blocked:

\`\`\`text
desired speed  = 30
physical speed = 0
\`\`\`

When the block and turnouts become available:

\`\`\`text
desired speed  = 30
physical speed = 30
\`\`\`

No extra restart logic is required in the script.

## 21.4 waitForBlock and waitForClearance

\`\`\`js
await run.waitForBlock("B1");
\`\`\`

means that B1's \`arrivedWhen\` conditions are satisfied and the train has been confirmed in the block.

\`\`\`js
await run.waitForClearance("C1");
\`\`\`

means that C1 is already reserved for the locomotive and the required turnout section is available.

\`waitForClearance()\` is **not required for SmartDispatcher to operate**. Clearance handling is automatic; this method is useful when script logic explicitly needs to wait for or synchronize with clearance.

## 21.5 Arbitrary trackside sensors

The normal sensor API remains available alongside SmartDispatcher:

\`\`\`js
await run.waitForBlock("B1");

await dcc.waitForSensor(1234, true);

await horn(loco);
\`\`\`

This allows horn, speed, audio, or other actions at any independent trackside sensor.

## 21.6 run API

\`\`\`text
run.setSpeed(speed)
run.stop()
await run.waitForBlock(blockName)
await run.waitForClearance(blockName)
run.getCurrentBlock()
run.getNextBlock()
run.getRoute()
run.getDesiredSpeed()
\`\`\`

Speed range is \`0..126\`.

## 21.7 Options

\`\`\`js
await smartDispatcher(
  ["A1", "B1", "C1"],
  async (loco, dir, run) => {
    run.setSpeed(20);
    await run.waitForBlock("C1");
  },
  {
    setDelayMs: 250,
    blockPollMs: 100,

    onEmpty: async dir => {
      log("A1 is empty", dir);
    },

    onBlocked: async (loco, dir, conflicts) => {
      log("SmartDispatcher waiting", loco, conflicts);
    }
  }
);
\`\`\`

- \`setDelayMs\`: delay between consecutive turnout commands;
- \`blockPollMs\`: polling interval for block and arrival conditions, \`25..5000 ms\`;
- \`onEmpty(dir)\`: empty source block;
- \`onBlocked(loco, dir, conflicts)\`: called the first time SmartDispatcher must wait for a particular next block.

SmartDispatcher automatically commands speed \`0\` after confirmed arrival at the destination.
