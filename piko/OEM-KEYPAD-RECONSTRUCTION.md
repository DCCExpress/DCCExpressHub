# PIKO original keyboard firmware — event-chain reconstruction

**Status:** Verified original **OTA_1 v1.3.0.0** Xtensa addresses and original flash literal pointers; physical keyboard wiring remains unverified. This document supersedes guesses that directly driving GPIO26/14/27 as three rows, then scanning one-hot or one-cold output patterns, could provide a unique key identifier. **Do not infer key names from those scans.**

## Controlled observation

User recorded keys 0, 1, 2, 3 with twelve selectors each (HOT 0..5 and COLD 0..5, both with bit6 HIGH), held for roughly a full 10ms task interval at each state. Measured GPIO input HIGH fraction in the held window was 100% for **every one** of the twelve selection states, with 0% in the idle window:

| Physical key | Physical GPIO input observed | Unique row detected? |
| --- | --- | --- |
| 0 | GPIO34 | No |
| 1 | GPIO32 | No |
| 2 | GPIO33 | No |
| 3 | GPIO34 | No |

Consequently the current *experimental* serial shift patterns exert **no observed gating** on the three columns. The result does not identify the external IC or tell us whether there is a missing enable signal, wrong shift protocol or something else. Repeating the same twelve patterns is not a sound path forward.

## Manufacturer event pipeline, from OTA_1 original flash

OEM initializer around **0x400E3953–0x400E39E0**, and literal references resolved directly from the uploaded original 16 MiB backup:

| Original firmware element | Address | Evidence |
| --- | --- | --- |
| 6-GPIO setup | `0x400E3780` | called with pins `26, 14, 27, 32, 33, 34` |
| Serial output serializer | `0x400E3664` | GPIO14 low, then seven MSB-to-LSB bits with DATA GPIO26 and CLK GPIO27, then GPIO14 high |
| Selection bit update | `0x400E36AC` | modifies serial output shadow byte at address held in literal `0x400D1010` |
| Key selector increment/timeout task | `0x400E3704` | cycles selector index 0..5, then serializes the updated mask |
| Shared GPIO callback | `0x400839D8` | stored in literal `0x400D0FD4`, installed for GPIO32/33/34 |
| Key event processing worker | `0x400E2DA0` | stored in literal `0x400D1034`; receives GPIO event from queue |
| Event consumer / key action task | `0x400E3004` | receives and interprets combined key codes |

**Critical correction:** The binary function named `KeypadInterrupt` at `0x400E2DA0` is a **queue-consuming worker**, not the GPIO callback. The actual shared interrupt callback pointer is `0x400839D8`. This distinction matters because events can be queued while the selector index advances; a handmade IRQ counter labeled with the currently selected output may not reproduce the OEM semantics.

The original program keeps separate global state variables:
- `0x400D0FC8` literal points to selector index storage `0x3FFB61E3`.
- `0x400D1010` literal points to the serialized output shadow byte `0x3FFB61E1`.
- `0x400D0FBC` literal points to the current column/key code storage `0x3FFB61E2`.
- `0x400D0FB4` literal points to keyboard GPIO-event queue handle storage `0x3FFB61EC`.
- `0x400D1034` literal stores `0x400E2DA0` (event worker).
- `0x400D103C` literal stores `0x400E3704` (row-advance task).
- `0x400D0FD4` literal stores `0x400839D8` (shared GPIO callback).

## Key-code math from original event worker

`0x400E2DA0` interprets GPIO32/33/34 as **column values 1/2/3**, and selector index 0..5 as **high nibble 0x10/0x20/…/0x60**. Therefore a composed code is:

```c
uint8_t oem_keycode(unsigned selector, unsigned column) {
    // column 1=GPIO32, 2=GPIO33, 3=GPIO34
    return (uint8_t)(((selector + 1) << 4) | column);
}
```

This is **a code format, not a reliable physical key-to-code map**. Until the physical row timing is understood, assigning "0" to a specific selector would be unjustified.

The OEM serializer uses a **7-bit** mask. Bit6 is initially set to HIGH (`0x40`), and other OEM functions can set/clear it. Because the key-timeout logic manipulates bit6, a backlight/enable function is possible but **not proven**. Do not simply label it "74HC595 OE" or "row 7" based on the binary.

## Different next method — no more HOT/COLD scans

1. Reconstruct the **shared GPIO callback** `0x400839D8`: determine which event/timestamp is enqueued to the worker, and whether event ordering/row snapshot is retained.
2. Decode the **queue and timeout synchronization**: verify selector index at the moment of interrupt versus at the moment the worker receives an event, and exact row stepping semantics.
3. Identify whether bit6 controls key backlight, enable, or another circuit by tracing its OEM callsites and timing; do not infer external chip model from a seven-bit payload.
4. Build a dedicated **OEM event-driven keyboard driver**, with safe logging of raw GPIO event, queue state, selected row index and OEM keycode. Keep the previous experimental `/keymap` method out of this implementation.
5. Only if the OEM software protocol has been faithfully reconstructed but remains physically nonfunctional, investigate the external driver/trace path via electrical measurements or a clear board-side image.

The source-level offline helper is `piko/tools/recover_oem_keypad.py`. It verifies the original flash firmware/version, function entries, and these literal pointers without flashing or driving any GPIO.

**Safety and completeness:** No physical row mapping or functioning key driver is claimed here. The original firmware is not committed to GitHub. No changes outside `piko/` are needed for this investigation.

## Strong synchronization clue in original disassembly

The vendor code uses **the same shared handle** (literal `0x400D0FB8` → `0x3FFB61F4`) in *both* the event worker and the row-advance task:

- `0x400E2DB9..0x400E2DC0`: after receiving a GPIO event, the worker calls `0x4008DAD0` with the shared handle and argument `1`.
- `0x400E3709..0x400E3713`: before updating the row mask, the row task calls `0x4008DA78` with the same handle and argument `0`. If the call returns `1`, it branches past the row-update sequence to `0x400E374C`.
- `0x400E2DC3..0x400E2DC5`: the event worker also passes the received GPIO number to `0x4012209C` immediately afterward.

**Hypothesis (not yet a proven ESP-IDF symbol identification):** this handle synchronizes/suspends row advancement while a GPIO key event is being processed, and the worker temporarily changes the GPIO interrupt enable state. Our homemade scanner never implemented this event/row synchronization. Blindly increasing scan delay cannot substitute for it. The next reverse-engineering step is to resolve the actual functions `0x4008DAD0`, `0x4008DA78`, and `0x4012209C` (using the exact ESP-IDF build/function signatures where possible), before translating this into the replacement keyboard driver.
