# TODO – EXRAIL Signal Output Support

## Goal

Add a third signal output mode:

- DCC
- DCC Extended
- EXRAIL

EXRAIL mode should allow every signal aspect/state to be mapped to a DCC-EX EXRAIL `ROUTE`.

The HUB is only responsible for starting the selected ROUTE. The actual hardware outputs, VPins, blinking, servos, HAL devices, etc. remain fully managed by DCC-EX / EXRAIL.

---

## Example EXRAIL configuration

```cpp
ROUTE(100, "MAV - Stop")
  SET(100)
  RESET(101)
  RESET(102)
  RESET(103)
DONE

ROUTE(101, "MAV - Clear")
  RESET(100)
  RESET(101)
  SET(102)
  RESET(103)
DONE

ROUTE(102, "MAV - Clear 40")
  RESET(100)
  SET(101)
  BLINK(102, 500, 500)
  RESET(103)
DONE
```

From the HUB point of view, these become selectable signal actions.

---

## Signal Config UI

Add a new output type:

```text
Output device

○ DCC
○ DCC Extended
○ EXRAIL
```

When EXRAIL is selected, every signal aspect/state should have an EXRAIL ROUTE dropdown:

```text
Aspect                     EXRAIL Route

Stop                       [ MAV - Stop      ▼ ]
Clear                      [ MAV - Clear     ▼ ]
Clear 40                   [ MAV - Clear 40  ▼ ]
```

---

## EXRAIL route discovery

The HUB should retrieve the available externally startable EXRAIL ROUTEs from DCC-EX.

The dropdown should display the ROUTE name:

```text
MAV - Stop
MAV - Clear
MAV - Clear 40
```

but the layout configuration should store the stable numeric ROUTE ID.

Example:

```json
{
  "id": "signal-state-clear-40",
  "label": "Clear 40",
  "exrailRouteId": 102
}
```

The ROUTE name may optionally be cached for display purposes, but functionality must not depend on the name.

---

## Sending a signal state

When an EXRAIL-backed signal state is selected, the HUB should send:

```text
</ START 102>
```

Conceptually:

```text
Signal aspect
      ↓
EXRAIL Route ID
      ↓
DCC-EX
      ↓
SET / RESET / BLINK / servo / other HAL operation
```

---

## Why EXRAIL instead of direct VPin control?

The HUB should not directly manage the physical signal outputs.

Avoid HUB-side logic such as:

```text
<z -100>
<z 101>
<z 102>
<z -103>
```

This should be handled by EXRAIL instead.

Advantages:

- signal hardware configuration stays inside DCC-EX;
- native `BLINK()` support;
- multiple VPins can be controlled together;
- supports PCA9685, GPIO, PCF8574, MCP23017, etc.;
- supports servos and other DCC-EX HAL devices;
- blinking continues even if the HUB connection is interrupted;
- the HUB does not need to know the physical hardware layout;
- future DIY DCC-EX devices can be used without changing Signal Config.

---

## Data model

Extend the current protocol:

```ts
protocol: "dcc" | "dccext"
```

to:

```ts
protocol: "dcc" | "dccext" | "exrail"
```

EXRAIL signal states should support:

```ts
type SignalOutputState = {
  id: string;
  label: string;
  aspect: number;

  // existing
  lamps: SignalLamp[];
  dccOutputs: DccOutput[];

  // new
  exrailRouteId?: number;
};
```

`aspect` may remain part of the HUB's logical signal-state model, but in EXRAIL mode the actual output operation is defined by `exrailRouteId`.

---

## TrackSignalElement

Extend `sendState()` with an EXRAIL branch:

```ts
if (this.signalOutput.protocol === "exrail") {
  if (state.exrailRouteId != null) {
    wsApi.startExrailRoute(state.exrailRouteId);
  }

  this.setCurrentStateById(state.id);
  return;
}
```

Existing DCC and DCC Extended behavior must remain unchanged.

---

## WebSocket API

Add a HUB API operation such as:

```ts
wsApi.startExrailRoute(routeId)
```

The firmware should translate this into the DCC-EX command:

```text
</ START routeId>
```

---

## EXRAIL route list

Add an API for retrieving available ROUTEs.

Example HUB-side model:

```ts
type ExrailRoute = {
  id: number;
  name: string;
};
```

The route list should be refreshable when Signal Config opens or when a DCC-EX connection is established.

If the layout references a ROUTE ID that is currently unavailable:

- do not delete the configuration;
- display something like:

```text
Missing EXRAIL Route #102
```

- allow the user to select a replacement.

---

## Important design rule

In EXRAIL mode:

**Do not expose VPin configuration in the HUB.**

The HUB should only know:

```text
Signal state -> EXRAIL Route
```

DCC-EX remains responsible for:

```text
EXRAIL Route
  -> VPin
  -> LED
  -> BLINK
  -> servo
  -> GPIO
  -> HAL device
  -> etc.
```

---

## Tests

Add tests for at least:

- EXRAIL protocol serialization/deserialization;
- `exrailRouteId` save/load behavior;
- `sendState()` sends the correct ROUTE ID;
- existing DCC behavior remains unchanged;
- existing DCC Extended behavior remains unchanged;
- missing EXRAIL ROUTEs do not remove stored configuration;
- EXRAIL ROUTE dropdown displays ID/name correctly;
- EXRAIL signal configuration survives layout reload.

---

## Acceptance criteria

The feature is complete when:

1. `EXRAIL` can be selected as a Signal Config output type.
2. The HUB can retrieve available EXRAIL ROUTEs.
3. Each signal aspect/state can be mapped to a different ROUTE.
4. The configuration can be saved and restored.
5. Selecting a signal aspect starts the configured EXRAIL ROUTE.
6. EXRAIL `BLINK()` works without HUB-side timers.
7. Existing DCC and DCC Extended signal behavior is unchanged.
8. Existing automated tests remain green.
9. New automated tests cover EXRAIL signal support.

## Out of scope

Do not implement yet:

- direct DCC-EX VPin signal output mode;
- HUB-side blinking;
- HUB-side servo/PWM signal handling;
- automatic EXRAIL configuration generation.

These are unnecessary for now because EXRAIL ROUTEs provide a generic abstraction for all of them.