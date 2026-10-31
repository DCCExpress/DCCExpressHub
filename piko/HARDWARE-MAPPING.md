# PIKO SmartControl WLAN – hardware mapping log

Known: ESP32-WROOM-32E (ESP32-D0WD-V3), 16 MB SPI flash,
ESP-IDF 4.4.1 factory application; USB UART diagnostics work.
**Firmware-derived GPIO assignments now available for keypad and rotary. LCD/74HC595 still unknown.**

## Evidence first (no flashing)
1. Inspect both PCB sides and photograph silk labels, display flex,
   button matrix traces, encoder A/B/switch and any I/O expanders.
2. Record all visible IC markings (display controller, IO expander,
   power management) and connector pins.
3. Trace board signals with an unpowered device using a multimeter
   continuity setting. Disconnect USB and battery before continuity tests.
4. Read the factory firmware image offline to locate GPIO initializers,
   I2C addresses, SPI pins and display driver references.
5. Only after recording a verified pin map, create real display/input
   drivers in source. Never indiscriminately toggle unknown GPIOs.

## GPIO probe (optional, custom-firmware only)
The read-only candidate monitor is controlled by
`CONFIG_PIKO_HW_INPUT_PROBE` (default **off**).
It currently watches GPIO 2, 12, 13, 15, 32, 33 and 34 via interrupts and prints changes
to the ESP-IDF serial console. It applies no internal pull resistors,
but input-enable still alters pad configuration; it is not a substitute
for schematics or a GPIO map. Floating pins may change spontaneously.

**Do not flash the experimental firmware to the factory handheld
just to use this probe.** First preserve and verify the full factory
flash backup, security configuration and restore process.

| Device part | Chip or connector | ESP32 pins | Verified? |
|---|---|---|---|
| LCD and backlight | Unknown | Unknown | No |
| Rotary A/B and likely switch | Encoder GPIO2/15; likely press GPIO12 | 2,15,12 | Firmware-derived |
| Keypad | Matrix candidate | 26/14/27 outputs; 32/33/34 inputs | Firmware-derived, key map pending |
| Battery / charging | Unknown | Unknown | No |
| USB console | UART0 likely (verify) | Unknown | No |


## Factory handheld firmware inspection (2025-12-11 release)

Source analyzed offline: `2025-12-11_Update_PSCW_1_3_0_0.zip`,
`Firmware-Handheld.bin` (1,354,752 bytes).
ESP32 application image metadata: project `Firmware-Handheld`,
version `1.3.0.0`, compiled Dec 11 2025, ESP-IDF `v5.4.2-dirty`.
This is distinct from the older 1.0.3.0 application boot log observed on
the device. **Do not flash this vendor image based solely on this analysis.**

Firmware string references (file offsets, hexadecimal):
| Offset | Firmware string | Implication |
|---|---|---|
| 0x601c | `./main/src/keypad.c` | Dedicated keypad module |
| 0x6060 | `INTERRUPT KEYPAD` | Keypad interrupt path |
| 0x6074 | `TIMEOUT KEYPAD` | Keypad timeout path |
| 0x62d4 | `RotaryTask` | Rotary FreeRTOS task |
| 0x63dc | `RotaryKnob` | Rotary-related code |
| 0x643c | `RotaryEncoder` | Rotary encoder-related code |
| 0x7260 | `LCD-Task` | LCD task |
| 0x7271 | `LCD first DAh respond is %x` | LCD response / identification path |
| 0x72a5 | `after reset LCD first DAh respond is %x` | LCD reset/retry check |
| 0xde09 | `Failed to spi_bus_initialize` | SPI peripheral initialization path |
| 0x1cf90 | `INTERRUPT_KEYPAD` | Keypad-related identifier |
| 0x1cfa4 | `keypad_BackLight_init` | Keypad backlight init identifier |

**Not yet established:** which GPIOs connect to 74HC595 SER/SRCLK/RCLK,
keyboard return lines, rotary A/B or LCD SPI/control lines; also no
confirmed LCD controller ID. Strings are evidence of module existence,
**not a pin map**. In particular, the 0xDA LCD read command is used by
multiple display controllers and does not identify one uniquely.

### Next reverse-engineering steps
- Load the extracted ESP32 application image into Ghidra with an Xtensa
  processor extension / appropriate ESP32 loader.
- Find references to `./main/src/keypad.c`,
  `INTERRUPT KEYPAD`, `RotaryEncoder`, `LCD-Task`.
- Identify callers of `gpio_config`/`gpio_set_direction`,
  `gpio_set_level`, `gpio_isr_handler_add` and
  `spi_bus_initialize`; extract actual pin constants at call sites.
- Cross-check all recovered GPIOs against board routing before allowing
  any output drive.
- Keep the firmware's SPIFFS dependency in mind; the current minimal
  experimental partition table has no SPIFFS partition.


### ESP32 image segment and literal-reference mapping

Parsed original `Firmware-Handheld.bin` as an ESP32 image (magic `0xE9`,
7 loadable segments), without modifying it. Two relevant segments:

- DROM `0x3F400020`, file offset `0x20`, size `0x4BED8`
- IROM `0x400D0020`, file offset `0x50020`, size `0xDE998`

The following four-byte little-endian string-address literals occur in
the program's IROM region (verified by direct byte search):

| Identifier | String virtual address | Pointer literal IROM address |
|---|---|---|
| `keypad_BackLight_init` | `0x3F41CFA4` | `0x400D101C` |
| `ReadKeysTask` | `0x3F406050` | `0x400D1028` |
| `INTERRUPT KEYPAD` | `0x3F406060` | `0x400D1030` |
| `TIMEOUT KEYPAD` | `0x3F406074` | `0x400D1038` |
| `INTERRUPT STOPKEY` | `0x3F406084` | `0x400D1044` |
| `RotaryTask` | `0x3F4062D4` | `0x400D1150` |
| `RotaryKnob` | `0x3F4063DC` | `0x400D1240` |
| `RotaryEncoder` | `0x3F40643C` | `0x400D1258` |
| `LCD-Task` | `0x3F407260` | `0x400D1F5C` |

These are **addresses of pointer literals**, not necessarily function
entry points or GPIO register references. Follow Xtensa `L32R` references
to these locations when disassembling. This supports locating the
hardware-initialization code but does not by itself expose pin constants.


## Keypad GPIO arguments recovered from all three factory images (2026-10-29)

**Strongly confirmed by Xtensa disassembly of the user's reports.** The
factory, ota_0 and ota_1 firmware all load six numeric constants into
Xtensa windowed-ABI argument registers a10..a15, then call a function
within the keypad initialization sequence immediately after
`ReadKeysTask` is created:

| Argument | ESP32 GPIO number |
|---|---:|
| a10 | **26** |
| a11 | **14** |
| a12 | **27** |
| a13 | **32** |
| a14 | **33** |
| a15 | **34** |

**ota_1 / version 1.3.0.0**: `0x400E3953..0x400E395F` calls
`0x400E3780`.

**factory/ota_0**: `0x400D9987..0x400D9993` calls
`0x400D97B0`.

This precisely overlaps the experimentally observed button-press activity
on GPIO 26/27/14, validating that these six pins are keypad-related.

**Now resolved in the peripheral disassembly:** 26/14/27 are configured as outputs, 32/33/34 as inputs; rotary channels are GPIO2/15, with GPIO12 as a likely switch. **Still unresolved:** which matrix position means which key, HC595 function, LCD SPI pins/controller.
**Do not indiscriminately configure these pins as inputs or outputs:** GPIO
34 is input-only on the original ESP32; the other pins may be actively
driven by the original keypad circuit. Extract and analyze the called
functions above before implementing the keypad driver.


### Recovered task/callback entry addresses (ota_1, version 1.3.0.0)

The adjacent 32-bit literal addresses in the `ota1_xrefs.txt` report
identify the task/callback entries passed to ESP-IDF task/timer creation:

| Code path | Code address |
|---|---|
| Six-argument keypad setup | `0x400E3780` |
| ReadKeysTask | `0x400E3004` |
| Keypad interrupt handler task | `0x400E2DA0` |
| Keypad timeout callback | `0x400E3704` |
| STOP key callback | `0x400E351C` |
| RotaryTask | `0x400E4D60` |
| LCD task | `0x40105B60` |

The `piko/tools/trace_peripherals.py` script generates longer
disassembly windows at these locations from the offline flash backup;
do not infer LCD or 74HC595 pins from the task names alone.

## Confirmed firmware-based mappings (PIKO 1.3.0.0)

Keypad initializer at 0x400E3780 receives GPIOs 26,14,27,32,33,34.
Its call pattern configures **26/14/27 as outputs** (ESP-IDF direction
mode 2), and **32/33/34 as inputs** (mode 1). GPIO34 is special-cased
because it has no internal pull resistors. This supports a three-row,
three-column keypad; individual key identities remain unverified.

Rotary task at 0x400E4D60 reads **GPIO2 and GPIO15** as the two
quadrature channels, and GPIO12 has a separately configured interrupt
input, likely the encoder's button. All three are ESP32 boot strapping
pins: never drive them in hardware experiments.

These facts were recovered from the user's peripheral_calls.txt generated
from ota_1 version 1.3.0.0. The mapping of 74HC595 and LCD is still
unknown. The original broad GPIO scanner incorrectly changed the keypad
output pins to inputs and deliberately excluded rotary pins.

The updated trace_peripherals.py rebases objdump on every function entry
to recover disassembly of ReadKeysTask and the LCD task, which were
previously lost to Xtensa decode alignment.

## Display discovery (2026-10-31)
The physical flex cable marking reported by the user is **FP-200H05B JY**. An ST7789-family controller is a candidate, not confirmed. A safe LCD discovery scaffold has been added, but **no LCD signals are driven** until SPI host, MOSI, SCLK, DC, reset, CS, backlight and supply are mapped against the original firmware or board. The fully active 3x3 matrix diagnostic was also corrected to compare each column with its all-rows-released baseline, preventing stuck-low inputs from registering as nine pressed keys.

## Experimental LCD output driver

An **opt-in** ST7789-style SPI RGB565 driver is available in `piko/src/piko_display.c`.
It sends three solid bars (red/green/blue) on a nominal 240x320 panel.
This is a preliminary signal test, **not verified display operation**.
The display controller, interface and SPI/control pinout are still unknown, so
`CONFIG_PIKO_LCD_TEST` defaults to **off** and no LCD outputs are driven.

Before enabling it, extract the LCD SPI initializer and its GPIO assignments
from `piko/PIKO-Handheld-Original-16MB.bin`, or trace the board. The six
required Kconfig GPIO values (MOSI, CLK, CS, DC, RESET) must be verified;
unconfigured, duplicated, flash, UART, keypad, rotary and STOP pins are rejected.
Backlight GPIO is deliberately not touched. Do not interpret a black screen as
proof of a bad LCD: the backlight may be disabled by a separate circuit.

Once the correct bus and pins are known, implement a text renderer for
"DCCExpress PIKO" and enable it through an explicit test profile.

## Direct OTA_1 binary inspection (2026-10-31)

Input: original 16 MiB flash image, firmware `Firmware-Handheld 1.3.0.0` in `ota_1`, ESP-IDF v5.4.2.
Direct string inspection of the binary (not a pinout determination) confirmed:
- Embedded `LGFX` label next to failures for `spi_bus_initialize`, `spi_bus_add_device`, `spi_device_acquire_bus`. This is compelling evidence for a LovyanGFX-style SPI display backend.
- `LCD-Task` and `LCD` labels; errors `LCD first DAh respond is %x` and `after reset LCD first DAh respond is %x`, i.e. the vendor checks an LCD identification/status byte.
- `LCD_TEST` and explicit LCD/backlight on/off messages.

**Do not infer LCD GPIOs or controller from these strings.**
The active LCD driver remains gated by `CONFIG_PIKO_LCD_TEST=n`. Before enabling it, disassemble the functions referencing the LGFX SPI errors and track their bus/device configs to recover MOSI, SCLK, CS, DC, RESET and backlight pins. The image also has a separate keypad scanner on GPIO26/14/27 and inputs GPIO32/33/34.

Binary literal cross-reference results (addresses are firmware virtual addresses):
- `LGFX` tag `0x3F40DE00` referenced by IROM literal `0x4010FEF0`.
- `Failed to spi_bus_initialize` string `0x3F40DE08` referenced at `0x4010FEF4`.
- `Failed to spi_bus_add_device` string `0x3F40DE40` referenced at `0x4010FEFC`.
- `Failed to spi_device_acquire_bus` string `0x3F40DE78` referenced at `0x4010FF28`.
- Display `LCD first DAh respond` error text `0x3F407270` referenced at `0x400D1F88`.
These are **literal reference positions**, not proven function entry points or pin definitions.

## Experimental trial 1: guessed ESP32 VSPI pinout

At user request, trial 1 defaults are **MOSI=23 SCLK=18 CS=5 DC=21 RESET=22**, currently compiled in directly, without `menuconfig`. These are **guesses**, not derived from PIKO wiring! Boot flash/strapping and unrelated peripherals may be affected; stop using the trial if the handheld behaves unexpectedly. The LCD backlight is not driven, so a blank display cannot disprove this pinout. Trial sends an RGB test pattern, not text. The Kconfig entries are historical: the current test driver is compiled unconditionally and does not use them.

## Phased keypad capture (2026-10-31)
Observed from user keymap report: physical digits grouped by column: 0/3/6/9→GPIO34, 1/4/7→GPIO32, 2/5/8→GPIO33; all three rows appeared in each raw sample, and GPIO2/GPIO12 changed even on unrelated key tests. This does NOT prove physical row wiring; the previous report latched any transient in a long interval.

Updated `/keymap` to collect three stages: idle baseline, key-held snapshot (explicit click while holding), then released snapshot. Firmware returns baseline/current row levels, idle columns, special pin levels, counts of 10 ms-sampled edges, and rotary delta. Report warns if no stable held-state difference or no return to baseline. This is diagnostic only: it does not yet assign physical key names into a runtime keymap. Older v2 browser mappings remain in storage but v3 begins a new clean measurement set.

LCD observation: user sees extremely faint flicker / apparent backlight with all three experimental SPI test profiles, no rendered RGB image. This is inconclusive; neither controller nor backlight pin is known. No new arbitrary SPI pin scanning was introduced in this keypad update.

## Corrected factory keypad topology (2026-10-31)

**Previous "R1 GPIO26, R2 GPIO14, R3 GPIO27" assumption is disproved by factory code.** The OEM `ota_1` image, function `0x400E3664`, produces a **7-bit serialized output**:

1. Set GPIO14 LOW.
2. For bits 6 down through 0, set GPIO27 LOW, drive GPIO26 to the next bit, set GPIO27 HIGH.
3. Set GPIO14 HIGH.

Thus GPIO26=serial DATA, GPIO27=shift CLOCK, GPIO14=LATCH (roles inferred from the observed waveform), not three independent matrix rows. The adjacent helper `0x400E36AC` modifies individual bits in a 7-bit selection mask; firmware input initialization `0x400E3780` configures the three output pins with GPIO mode 2 (push-pull output), and GPIO32/33/34 with mode 1 (inputs). This strongly implies an external shift-register or equivalent serial-output decoder driving **six scanned keyboard lines**. The exact chip is **not identified**, and physical key-to-bit mapping needs hardware confirmation. The stock timeout code at `0x400E3704` cycles selection indices **0 through 5**: clear previous bit, set next bit, then shift out the seven-bit word. Bit 6 is not used as a keyboard selection by this routine.

**New experiment:** `hardware_probe.c` reproduces the serialized 7-bit output via the OEM GPIO order (26/27/14), initially applied an all-zero `0x00` reference and then tested each selection bit (`1 << row`); subsequent testing required keeping bit 6 HIGH, yielding reference `0x40` and selection `(0x40 | (1 << row))`. It compares all three sampled input columns with the reference and restores the first one-hot pattern `0x01` afterward. The seventh serialized bit's role is not a keypad row; later testing restored its OEM-default HIGH state (see follow-up below). It records 18 possible shift-row/column intersections. Input GPIO32/33 get pull-down configuration; GPIO34 is input-only and has no internal pull resistors. No guessed matrix-row output drive remains.

Source: ESP32 official datasheet and ESP-IDF GPIO documentation:
- https://documentation.espressif.com/esp32_datasheet_en.html
- https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/peripherals/gpio.html

**Testing:** After OTA flash, use `/keymap`. Scan just physical keys 0, 1, 2, 3 with the three-phase procedure. The expected improvement is a *different shifted row index* for 0 and 3 despite their shared GPIO34 column, rather than all three false rows. If all six rows still appear, investigate the serialized mask polarity / output mapping rather than changing random ESP32 pins. GPIO12 remains unverified/noisy and is not used as a keyboard matrix row.

## 2026-10-31 follow-up: OEM bit 6 restored; shared columns are NOT row identification

After trial with bits 0..5 one-hot and bit 6 held LOW, keypresses 0/1/2/3 still changed the same input column **for all six tested selector states**. The capture UI erroneously labeled the common column change as six `HELD SR bit...` matches. It was not proof that all six row drivers had responded. Most importantly, no row-specific `rawTransitions` were captured, while GPIO12 showed tens to hundreds of edges per test (likely floating/noisy; not yet a verified button).

Direct OEM disassembly contains function `0x400E36DC`: it ORs the 7-bit serial state with `0x40` (bit 6). The stock timeout task `0x400E3704` invokes that helper during normal operation, but the previous 6-row test forced bit 6 LOW. Its **physical role remains unproven**, so the test now uses bit 6 HIGH, matching the normal OEM state, with row selection bits 0..5 one-hot. GPIO26=DATA, GPIO27=CLOCK, GPIO14=LATCH. It does **not** automatically toggle through random GPIO pin combinations.

The key-mapping report now only labels a row as selected when its sampled input differs from the all-rows-inactive input state. Changes visible across *all six row samples* are separately flagged as **unresolved common input changes**, rather than falsely assigning six keys. Warnings about failure to return to baseline no longer use noisy GPIO12; the edge count remains visible for investigation.

**Next validation:** update OTA and scan just physical 0 and 3 via `/keymap`. Both share GPIO34, so a correctly functioning scanner must yield distinct selected shift bits. If the report still says `UNRESOLVED`, then bit 6 HIGH is not sufficient and the next step is to instrument the factory-style ISR/timeout row-index correlation, rather than claim the matrix is solved.

Source-level documentation: ESP-IDF GPIO guidelines https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gpio.html ; GPIO34 is input-only, no internal pull-up or pull-down.

## External shift-register discussion (Arduino Forum, 2024)

User reference: https://forum.arduino.cc/t/esp32-and-10x-74hc595/1211100/17
Discussion: reading a large keyboard by selectively enabling 74HC595 outputs. Participants warn that **74HC595 is serial-in / parallel-output, not an input-reading IC** (74HC165 is input shift register). On a push-pull 595, different rows at opposite levels can be electrically connected if multiple keys are depressed and no series resistors/diodes/isolation exist. Therefore the PIKO's external driver **must not be declared a 74HC595** solely from GPIO26/27/14 serial traffic. Exact part and keyboard isolation topology are unknown. The trial scans should be limited to individual key presses until verified.

Relevant TI data sheet: https://www.ti.com/product/SN74HC595 (8-bit serial-in, 8-bit output latch, independent shift/latch clocks, tri-state outputs with OE). The PIKO OEM code at 0x400E3664 transmits **7 bits**, not 8; that discrepancy is another reason not to assume an ordinary 74HC595 and copy its wiring/protocol uncritically.

Current observation: all six shifted selection states return the same column for any one of keys 0/1/2/3. Competing explanations remain: no electrical connection from serialized output to rows, wrong enable or polarity, shift/latch protocol mismatch, or too-short settling time of the overall keypad circuit. The forum itself does not resolve which applies to PIKO; **the 74HC165 recommendation is for designing a new keyboard, not proof that the PIKO uses a 165**.

## Key capture follow-up: GPIO rising-edge interrupt correlation

User test (6-bit selection + bit6 HIGH) still had no stable row identification. Key 0 and 3 shared GPIO34; key 1 GPIO32; key 2 GPIO33. All six selected rows sampled the same level while each key was held, and even the inactive baseline changed. Consequently, **the previous "HELD SR bit0..5" result never established any six row identities**. GPIO12 produced 241-567 edge changes during unrelated key tests; it remains an unreliable candidate.

The original `KeypadInterrupt` at `0x400E2DA0` maps GPIO32/33/34 to column codes 1/2/3 and uses the current selector index (0..5) to construct a combined key code (selector index in high nibble). The stock selector task `0x400E3704` cycles rows and calls `0x400E3664` to serialize the selection mask.

The new experiment preserves the existing GPIO selection pins but adds a **positive-edge interrupt** handler for GPIO32/33/34. The firmware separately counts edges for each currently selected shift output bit. A diagnostic 600 microsecond stabilization interval is included after each row update; any edges outside a stable selected state are counted as unassigned. `/api/capture` returns `irqEdges[18]` and `irqUnassigned[3]`; the `/keymap` report exposes them. This does NOT implement production key decoding yet, and a row receiving a single IRQ is only a candidate (contact timing could coincide with any row). If no consistent correlation appears over repeated presses, reconsider the serial output's physical role and OEM row timing rather than assuming a 74HC595.

ESP-IDF documented GPIO ISR services and per-pin handlers: https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/peripherals/gpio.html

## Scan trace 4 and IRQ attribution correction

User's rising-edge report with selection bits 0..5, bit 6 HIGH:
- Key **0**: GPIO34; 2 edges classified as selector 0, **32** unassigned.
- Key **1**: GPIO32; 0 classified, **13** unassigned.
- Key **2**: GPIO33; 0 classified, **45** unassigned.
- Key **3**: GPIO34; 23 classified as selector 5, **37** unassigned.

The above does **not** establish physical rows 0/5 for keys 0/3: most events were classified "unassigned", and the held-state columns remained active in all six selections.

Identified software attribution error in `hardware_probe.c`: `irq_selected_row` was set to `0xff` **while serial data was clocked and latched**, so any electrical edges triggered by row changes were misclassified as "outside selected row". It was also set to `0xff` after the scanner restored row 0, even though that row remained selected for the inter-scan interval.

Correction: assign the **next** selector index before shifting/latching, use an `irq_switching` flag to count edges **during the transition** separately from edges when the selection is stable, and retain selector index 0 between scans while its pattern remains latched. Settling delay now ~1ms rather than 600us per row. The report prints `irqSwitchEdges[18]`, `irqEdges[18]` and `irqUnassigned[3]` separately. The source-level GPIO interrupt behavior is per ESP-IDF documented service; no extra physical pins are driven or added.

Expected next discriminating experiment: two key reports (0 and 3) with `/keymap`. For a real row association, the same selector should consistently produce switching/stable events for repeated presses, with few or no unassigned events. If the same shared-column activity remains under every selected row, the serial-output control's electrical role or latch protocol must be reconsidered.

**Limitations:** changes committed without running an ESP-IDF build or a physical PIKO test in this environment.
