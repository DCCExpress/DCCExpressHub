# PIKO SmartControl WLAN — OEM numeric keypad candidate (alpha9)

## Scope

The physical handset has **17 push-buttons** as reported by the owner:
0–9 (ten numeric keys), BACK, UP, DOWN, RIGHT, LEFT, OK (six navigation keys),
and STOP (one emergency key). This firmware stage implements **only 0–9**
keycode *candidates*. The six navigation keys and STOP are deliberately
**not implemented or assigned to GPIO numbers**. Z21 control and locomotive
outputs remain disabled.

**Not a hardware-verified final release:** earlier v10 physical tests proved
that the previous HOT/COLD shift patterns could not distinguish row identities;
for keys 0/1/2/3 every one of the 12 output patterns returned the same
GPIO32/33/34 state. The new implementation uses a different OEM-derived
GPIO event queue / row freeze / keycode decoder, and requires a real handset
press test before its logical digits can be considered correct.

## OEM evidence and logic

From original 16MB OTA_1 firmware 1.3.0.0:
- GPIO26 = serial DATA, GPIO27 = CLOCK, GPIO14 = LATCH.
- A seven-bit payload is serialized MSB first; default shadow mask `0x41`.
- Row task rotates selection bit among indices 0..5 once per original
  FreeRTOS tick, unless a shared event-group freeze bit is active.
- GPIO32/33/34 are rising-edge inputs whose event goes into a FreeRTOS queue.
- Worker freezes row advancement, disables the received GPIO interrupt,
  generates the OEM code and waits for release before rearming.
- ReadKeysTask decodes numeric codes using the original dispatch.

| Digit | OEM code | Row index | GPIO input |
| --- | --- | --- | --- |
| 0 | `0x33` | 2 | 34 |
| 1 | `0x41` | 3 | 32 |
| 2 | `0x42` | 3 | 33 |
| 3 | `0x43` | 3 | 34 |
| 4 | `0x51` | 4 | 32 |
| 5 | `0x52` | 4 | 33 |
| 6 | `0x53` | 4 | 34 |
| 7 | `0x61` | 5 | 32 |
| 8 | `0x62` | 5 | 33 |
| 9 | `0x63` | 5 | 34 |

## Runtime components

- `src/hardware_probe.c` — replacement OEM-style keypad handler. No
  previous HOT/COLD scanning or matrix polling remains. ISR only queues
  GPIO event + selected row; row task uses FreeRTOS event-group freeze;
  worker decodes digits, checks stable HIGH and waits for release; counts
  and event history are exposed to the web UI and serial console.
- `src/keymap_page.h` — numeric 0–9 keypad status and press counters.
- `src/web_pages.h` — simplified home and device event console.
- `src/main.c` — prevents speculative LCD SPI/reset GPIOs from being
  driven automatically. `/lcd` still exposes manual, **unverified**
  experiments and should be avoided until the display pinout is known.
- `GET /api/diag` — `mode: "oem-numeric"`, `ready`, `lastDigit`
  (`-1` before any input or on an unmapped event), `lastCode`, `lastRow`,
  `lastGpio`, `counts[10]`, `queued`, `irqOverflows`,
  `switchIgnored`.
- `GET /api/events` — recent event history and numeric candidates.
- `/api/capture/*` retained only for backward compatibility; they no
  longer drive experimental serial selectors.

## Build and OTA (Windows)

```powershell
git switch alpha9
git pull --ff-only
cd piko
pio run -e piko-handheld
.\upload-ota.ps1
```

The build output is `piko/.pio/build/piko-handheld/firmware.bin` relative
to the repository root. `upload-ota.ps1` rebuilds before uploading, so
the explicit `pio run` can be omitted once the toolchain is working.

A dedicated GitHub Actions workflow
`.github/workflows/piko-alpha9-firmware.yml` also builds the project on
`alpha9` and uploads `piko-alpha9-oem-numeric-firmware` as a CI artifact
**if the workflow completes successfully**. A workflow file being committed
does not prove a successful build; check the Actions run before downloading.

## First physical verification (not yet performed)

1. Connect to the PIKO Wi-Fi and open `http://192.168.4.1:8080/keymap`.
2. Confirm the page shows `Connected · OEM numeric`.
3. Press physical **0**, release, then **3**, release. For an electrically
   correct row driver, they must produce distinct OEM codes `0x33` and
   `0x43` despite both being connected to GPIO34.
4. Try 1 and 2 (`0x41`, `0x42`). Check only one press count increments
   on each action and no ghost presses appear.
5. If 0/3 map unpredictably, or any keys produce wrong numbers, **stop**.
   That means the OEM row gating/timing still does not reproduce the
   actual handset hardware, and more offline/peripheral analysis is
   required — not random extra scan profiles.

The software does NOT send any train commands. Do not rely on the unimplemented
STOP button for a railway emergency stop.

## Real handset report — incorrect numeric positions (October 31, 2026)

After the first OEM-style queued keypad firmware, the user supplied these real
device events:

```text
UNMAPPED 0x13 row=0 GPIO34
DIGIT 7 CANDIDATE 0x61 row=5 GPIO32
DIGIT 4 CANDIDATE 0x51 row=4 GPIO32
UNMAPPED 0x12 row=0 GPIO33
DIGIT 3 CANDIDATE 0x43 row=3 GPIO34
DIGIT 7 CANDIDATE 0x61 row=5 GPIO32
UNMAPPED 0x12 row=0 GPIO33
UNMAPPED 0x23 row=1 GPIO34
UNMAPPED 0x31 row=2 GPIO32
UNMAPPED 0x12 row=0 GPIO33
UNMAPPED 0x13 row=0 GPIO34
```

The user reports some buttons not detected and others with the wrong physical
position. The console's digit numbers are only **logical codes generated using
the selected row at the time of the interrupt**, **not** proof of which physical
digit was pressed. From the original factory key table:
- `0x12`, `0x23`, and `0x31` are known **nonnumeric OEM keys**, not necessarily
  electrical errors.
- `0x13` is outside the 16 verified button code cases. Whether it is a
  ghost or a different physical path is unknown.
- The log **does not include the physical pressed-key sequence**, so raw
  codes cannot be unambiguously assigned to physical keys.

### Corrected row/IRQ race (next build)

Before this patch, the scanner checked only a FreeRTOS event-group flag set
**after** a queued GPIO interrupt reached the worker. It could advance the
physical output/row during the queue delay. The updated ISR increments a pending
key counter while holding an ESP32 `portMUX_TYPE` spinlock; the row task checks
this counter under the same lock **before it begins shifting**. The ISR captures
`irqRow` and `irqMask`, and the worker reports the actual `workRow`. A
`rowRaces` counter is included in `GET /api/diag`. The worker clears the
pending count after processing/release. This is a real concurrency correction,
**but it has not been demonstrated to repair the physical row gating**.

Event labels are now differentiated:
- `DIGIT N CANDIDATE`: a number inferred from the OEM logical row/column code
- `OTHER OEM KEY`: one of the six verified original nonnumeric codes
- `UNKNOWN CODE`: something outside the known 16-code table

The `/keymap` Copy log action now selects the visible text and instructs
Ctrl+C on HTTP-hosted pages where navigator.clipboard may be unavailable.

**Do not reassign the digits based on the above log alone.** If a subsequent
physical 0 versus 3 comparison still returns wrong or inconsistent OEM row
codes, the next step is identifying the actual serialized output latch/driver
on the PCB, including any enable line and clock timing, rather than performing
yet another 6×3 scan. No train control or STOP functionality is enabled.

### Follow-up fix: latch-time interrupts must not be discarded

Further inspection of the first real-device log and original serializer at
`0x400E3664` identified a second software defect. The previous driver
discarded all column GPIO edges while the row task was serializing/latching
the next selection mask. In a matrix driven by a serial-output row selector,
**activating the row may itself produce the rising edge** that identifies a
held key. Dropping these events can make some keys appear nonresponsive.

The driver now:
1. Sets the upcoming logical row under a shared ISR/task lock *before*
   serial output begins.
2. Accepts column GPIO interrupts both while the output is shifting/latching
   and during a stable row, instead of discarding transition-time edges.
3. Snapshots row index, serialized mask and `shift` phase at the interrupt.
4. Prevents any further row advance while an event is pending, even before
   the queued worker receives it.
5. Prints candidate key logs as `irq=<row> work=<row> GPIO<n> shift=0/1`.
   The `rowRaces`, `shiftEdges` and `pending` fields appear in
   `/api/diag`.
6. Correctly distinguishes known six **non-numeric OEM keys** from a truly
   unknown code such as `0x13`, instead of labeling all as unmapped.
7. The copy button selects event text for Ctrl+C when `navigator.clipboard`
   is unavailable on the local non-HTTPS PIKO page.

These are source-level bugs and legitimate fixes, but **do not demonstrate a
working physical number-pad** without a new press test. The v10 result
showing no change across all row masks still suggests that the true physical
row-driver electrical path needs investigation if the row codes remain random.
No STOP/power functionality has been added. The source was checked for API/UI
field consistency and browser JS syntax; ESP-IDF build and real hardware
testing are outstanding.
