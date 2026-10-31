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

## Original ReadKeysTask number-pad dispatch — recovered from OEM binary

This data is **not a PIKO test-firmware measurement**. We extracted it from the original `ReadKeysTask` dispatch around `0x400E31EF–0x400E32C9`, and independently verified the exact comparator and handler instruction byte signatures against the original `ota_1` v1.3.0.0 image. It maps the OEM combined row/column codes into logical key actions:

| Physical digit | OEM code (hex) | OEM selector index | GPIO input | OEM action |
| --- | --- | --- | --- | --- |
| 0 | `0x33` | 2 | GPIO34 | 0 |
| 1 | `0x41` | 3 | GPIO32 | 1 |
| 2 | `0x42` | 3 | GPIO33 | 2 |
| 3 | `0x43` | 3 | GPIO34 | 3 |
| 4 | `0x51` | 4 | GPIO32 | 4 |
| 5 | `0x52` | 4 | GPIO33 | 5 |
| 6 | `0x53` | 4 | GPIO34 | 6 |
| 7 | `0x61` | 5 | GPIO32 | 7 |
| 8 | `0x62` | 5 | GPIO33 | 8 |
| 9 | `0x63` | 5 | GPIO34 | 9 |

The GPIO columns agree with the earlier physical observations: key 0 and 3 both connect to GPIO34, key 1 to GPIO32, key 2 to GPIO33. The OEM **row index** is a software selector, and does not by itself prove the row-output electrical route.

The same dispatch also recognizes six non-numeric action codes. Their *physical legends and actions* are not established:

| OEM code | Selector | GPIO | OEM internal action ID |
| --- | --- | --- | --- |
| `0x12` | 0 | GPIO33 | 16 |
| `0x32` | 2 | GPIO33 | 17 |
| `0x21` | 1 | GPIO32 | 18 |
| `0x23` | 1 | GPIO34 | 19 |
| `0x31` | 2 | GPIO32 | 20 |
| `0x22` | 1 | GPIO33 | 21 |

All 16 cases are checked byte-for-byte by `python piko/tools/recover_oem_keypad.py PIKO-Handheld-Original-16MB.bin`. No vendor image is committed to GitHub.

## FreeRTOS event-group synchronization — six call-sites byte-verified

Analyzing the *real* input image and the FreeRTOS API reveals the likely purpose of two previously opaque functions:

| Firmware address | High-confidence FreeRTOS API | Observed call |
| --- | --- | --- |
| `0x4008DAD0` | `xEventGroupSetBits()` | worker: `(handle, 1)` when key event dequeued |
| `0x4008DA78` | `xEventGroupClearBits()` | worker: `(handle, 1)` when key processing finishes |
| `0x4008DA78` | `xEventGroupGetBits()` macro expansion | row task: `(handle, 0)` before advancing |

The documented FreeRTOS macro `xEventGroupGetBits(group)` expands to `xEventGroupClearBits(group, 0)`: this explains why the row task invokes the same binary function with `0` and checks whether the returned bits equal `1`. Its branch at `0x400E3713` bypasses the update at `0x400E3716–0x400E3749` if a key-event-processing flag is set.

The worker explicitly invokes a GPIO interrupt API (likely `gpio_intr_disable`) for the received GPIO number immediately after setting the event bit. After processing, it registers/enables the callback again through the 3-argument `0x40121FB8` call and clears bit 0. The source binary validates these transitions at:
- `0x400E2DB9`: worker sets bit 0 (`xEventGroupSetBits(group,1)`, inferred)
- `0x400E2DC3`: worker handles GPIO interrupt disable
- `0x400E2FAB`: worker restores GPIO callback
- `0x400E2FB6`: worker clears bit 0
- `0x400E3709`: row task reads current bits without changing them
- `0x400E3749`: row task clocks new serial selection data

These six instruction sequences are validated byte-for-byte by the read-only `recover_oem_keypad.py` tool. **Function names remain a high-confidence API inference**, because no ELF symbol table has been recovered. The event ordering and signatures are OEM evidence, while FreeRTOS function names come from API semantics.

Documentation used:
- https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32/api-reference/system/freertos_idf.html
- https://github.com/FreeRTOS/FreeRTOS-Kernel/blob/main/include/event_groups.h

### Consequence for the future implementation

A new driver must use a queued GPIO event and a shared row-freeze flag. The combined row/column code should be created using the OEM active row index **after** the worker takes ownership of the event. If the row timer advances between ISR enqueue and worker acknowledgement, decoding could race; reproducing the original timing/locking policy is necessary. We cannot yet claim that this solves the electrical selection problem, so no new runtime driver has been flashed or integrated.

