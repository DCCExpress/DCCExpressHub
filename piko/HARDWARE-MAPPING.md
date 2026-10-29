# PIKO SmartControl WLAN – hardware mapping log

Known: ESP32-WROOM-32E (ESP32-D0WD-V3), 16 MB SPI flash,
ESP-IDF 4.4.1 factory application; USB UART diagnostics work.
**No verified GPIO-to-peripheral assignment yet.**

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
It samples GPIO 32, 33, 34, 35, 36 and 39, prints only changes
to the ESP-IDF serial console. It applies no internal pull resistors,
but input-enable still alters pad configuration; it is not a substitute
for schematics or a GPIO map. Floating pins may change spontaneously.

**Do not flash the experimental firmware to the factory handheld
just to use this probe.** First preserve and verify the full factory
flash backup, security configuration and restore process.

| Device part | Chip or connector | ESP32 pins | Verified? |
|---|---|---|---|
| LCD and backlight | Unknown | Unknown | No |
| Rotary A/B/button | Unknown | Unknown | No |
| Keypad | Unknown (direct or expander) | Unknown | No |
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

**Still unresolved:** meaning of each of these six arguments; whether
74HC595 directly selects keypad rows or other peripherals; which signals
are inputs, which are outputs; rotary A/B; LCD SPI pins/controller.
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
