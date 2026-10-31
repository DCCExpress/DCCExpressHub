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
